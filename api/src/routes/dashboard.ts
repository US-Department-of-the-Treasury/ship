import { Router, Request, Response } from 'express';
import { pool } from '../db/client.js';
import { getVisibilityContext, VISIBILITY_FILTER_SQL } from '../middleware/visibility.js';
import { authMiddleware } from '../middleware/auth.js';
import { computeICEScore } from '@ship/shared';

type RouterType = ReturnType<typeof Router>;
const router: RouterType = Router();

// Urgency levels for work items
type Urgency = 'overdue' | 'this_sprint' | 'later';

interface WorkItem {
  id: string;
  title: string;
  type: 'issue' | 'project' | 'sprint';
  urgency: Urgency;
  // Issue-specific
  state?: string;
  priority?: string;
  ticket_number?: number;
  sprint_id?: string | null;
  sprint_name?: string | null;
  // Project-specific
  ice_score?: number | null;
  inferred_status?: string;
  // Sprint-specific
  sprint_number?: number;
  days_remaining?: number;
  // Common
  program_name?: string | null;
}

/**
 * GET /api/dashboard/my-work
 * Returns work items for the current user organized by urgency.
 * - Issues assigned to current user
 * - Projects owned by current user
 * - Sprints owned by current user (active ones only, not action items)
 */
router.get('/my-work', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Get workspace sprint configuration to calculate current sprint number
    const workspaceResult = await pool.query(
      `SELECT sprint_start_date FROM workspaces WHERE id = $1`,
      [workspaceId]
    );

    if (workspaceResult.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const rawStartDate = workspaceResult.rows[0].sprint_start_date;
    const sprintDuration = 7; // 7-day sprints

    // Calculate the current sprint number
    let workspaceStartDate: Date;
    if (rawStartDate instanceof Date) {
      workspaceStartDate = new Date(Date.UTC(rawStartDate.getFullYear(), rawStartDate.getMonth(), rawStartDate.getDate()));
    } else if (typeof rawStartDate === 'string') {
      workspaceStartDate = new Date(rawStartDate + 'T00:00:00Z');
    } else {
      workspaceStartDate = new Date();
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const daysSinceStart = Math.floor((today.getTime() - workspaceStartDate.getTime()) / (1000 * 60 * 60 * 24));
    const currentSprintNumber = Math.floor(daysSinceStart / sprintDuration) + 1;

    // Calculate days remaining in current sprint
    const currentSprintStart = new Date(workspaceStartDate);
    currentSprintStart.setUTCDate(currentSprintStart.getUTCDate() + (currentSprintNumber - 1) * sprintDuration);
    const currentSprintEnd = new Date(currentSprintStart);
    currentSprintEnd.setUTCDate(currentSprintEnd.getUTCDate() + sprintDuration - 1);
    const daysRemaining = Math.max(0, Math.ceil((currentSprintEnd.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)) + 1);

    const workItems: WorkItem[] = [];

    // 1. Get issues assigned to current user (not done/cancelled)
    const issuesResult = await pool.query(
      `SELECT d.id, d.title, d.properties, d.ticket_number,
              d.sprint_id,
              sprint.title as sprint_name,
              (sprint.properties->>'sprint_number')::int as sprint_number,
              p.title as program_name
       FROM documents d
       LEFT JOIN documents sprint ON sprint.id = d.sprint_id AND sprint.document_type = 'sprint'
       LEFT JOIN documents p ON d.program_id = p.id
       WHERE d.workspace_id = $1
         AND d.document_type = 'issue'
         AND (d.properties->>'assignee_id')::uuid = $2
         AND d.properties->>'state' NOT IN ('done', 'cancelled')
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}
       ORDER BY
         CASE d.properties->>'priority'
           WHEN 'urgent' THEN 1
           WHEN 'high' THEN 2
           WHEN 'medium' THEN 3
           WHEN 'low' THEN 4
           ELSE 5
         END,
         d.updated_at DESC`,
      [workspaceId, userId, userId, isAdmin]
    );

    for (const row of issuesResult.rows) {
      const props = row.properties || {};
      const sprintNumber = row.sprint_number;

      // Determine urgency based on sprint status
      let urgency: Urgency = 'later';
      if (sprintNumber) {
        if (sprintNumber < currentSprintNumber) {
          urgency = 'overdue'; // Past sprint, issue not done
        } else if (sprintNumber === currentSprintNumber) {
          urgency = 'this_sprint';
        }
        // Future sprints stay as 'later'
      }
      // No sprint = 'later' (backlog)

      workItems.push({
        id: row.id,
        title: row.title,
        type: 'issue',
        urgency,
        state: props.state || 'backlog',
        priority: props.priority || 'medium',
        ticket_number: row.ticket_number,
        sprint_id: row.sprint_id,
        sprint_name: row.sprint_name,
        program_name: row.program_name,
      });
    }

    // 2. Get projects owned by current user (not archived)
    const projectsResult = await pool.query(
      `SELECT d.id, d.title, d.properties,
              p.title as program_name,
              CASE
                WHEN d.archived_at IS NOT NULL THEN 'archived'
                ELSE COALESCE(
                  (
                    SELECT
                      CASE MAX(
                        CASE
                          WHEN CURRENT_DATE BETWEEN
                            (w.sprint_start_date + ((sprint.properties->>'sprint_number')::int - 1) * 7)
                            AND (w.sprint_start_date + ((sprint.properties->>'sprint_number')::int - 1) * 7 + 6)
                          THEN 3
                          WHEN CURRENT_DATE < (w.sprint_start_date + ((sprint.properties->>'sprint_number')::int - 1) * 7)
                          THEN 2
                          ELSE 1
                        END
                      )
                      WHEN 3 THEN 'active'
                      WHEN 2 THEN 'planned'
                      WHEN 1 THEN 'completed'
                      ELSE NULL
                      END
                    FROM documents issue
                    JOIN documents sprint ON sprint.id = issue.sprint_id AND sprint.document_type = 'sprint'
                    JOIN workspaces w ON w.id = d.workspace_id
                    WHERE issue.project_id = d.id
                      AND issue.document_type = 'issue'
                      AND issue.sprint_id IS NOT NULL
                  ),
                  'backlog'
                )
              END as inferred_status
       FROM documents d
       LEFT JOIN documents p ON d.program_id = p.id
       WHERE d.workspace_id = $1
         AND d.document_type = 'project'
         AND (d.properties->>'owner_id')::uuid = $2
         AND d.archived_at IS NULL
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}
       ORDER BY d.updated_at DESC`,
      [workspaceId, userId, userId, isAdmin]
    );

    for (const row of projectsResult.rows) {
      const props = row.properties || {};
      const impact = props.impact !== undefined ? props.impact : null;
      const confidence = props.confidence !== undefined ? props.confidence : null;
      const ease = props.ease !== undefined ? props.ease : null;

      // Determine urgency based on project status
      let urgency: Urgency = 'later';
      if (row.inferred_status === 'active') {
        urgency = 'this_sprint';
      }
      // 'completed' projects are filtered out or could be shown differently
      // 'planned' and 'backlog' stay as 'later'

      workItems.push({
        id: row.id,
        title: row.title,
        type: 'project',
        urgency,
        ice_score: computeICEScore(impact, confidence, ease),
        inferred_status: row.inferred_status,
        program_name: row.program_name,
      });
    }

    // 3. Get active sprints owned by current user
    const sprintsResult = await pool.query(
      `SELECT d.id, d.title, d.properties,
              p.title as program_name,
              (d.properties->>'sprint_number')::int as sprint_number
       FROM documents d
       JOIN documents p ON d.program_id = p.id
       WHERE d.workspace_id = $1
         AND d.document_type = 'sprint'
         AND (d.properties->>'owner_id')::uuid = $2
         AND (d.properties->>'sprint_number')::int = $3
         AND ${VISIBILITY_FILTER_SQL('d', '$4', '$5')}
       ORDER BY p.title`,
      [workspaceId, userId, currentSprintNumber, userId, isAdmin]
    );

    for (const row of sprintsResult.rows) {
      workItems.push({
        id: row.id,
        title: row.title || `Sprint ${row.sprint_number}`,
        type: 'sprint',
        urgency: 'this_sprint',
        sprint_number: row.sprint_number,
        days_remaining: daysRemaining,
        program_name: row.program_name,
      });
    }

    // Group by urgency for the response
    const grouped = {
      overdue: workItems.filter(item => item.urgency === 'overdue'),
      this_sprint: workItems.filter(item => item.urgency === 'this_sprint'),
      later: workItems.filter(item => item.urgency === 'later'),
    };

    res.json({
      items: workItems,
      grouped,
      current_sprint_number: currentSprintNumber,
      days_remaining: daysRemaining,
    });
  } catch (err) {
    console.error('Get my work error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
