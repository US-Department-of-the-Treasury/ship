import { Router, Request, Response } from 'express';
import { pool } from '../db/client.js';
import { getVisibilityContext, VISIBILITY_FILTER_SQL } from '../middleware/visibility.js';
import { authMiddleware } from '../middleware/auth.js';

type RouterType = ReturnType<typeof Router>;
const router: RouterType = Router();

// GET /api/team/grid - Get team grid data
// Query params:
//   fromSprint: number - start of range (default: current - 7)
//   toSprint: number - end of range (default: current + 7)
router.get('/grid', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Parse includeArchived query param
    const includeArchived = req.query.includeArchived === 'true';

    // Get all people in workspace via person documents (only visible ones)
    // Include pending users so they appear in the grid
    // personId is the document ID (used for allocations), id is the user_id (null for pending users)
    const usersResult = await pool.query(
      `SELECT
         d.id as "personId",
         d.properties->>'user_id' as id,
         d.title as name,
         COALESCE(d.properties->>'email', u.email) as email,
         CASE WHEN d.archived_at IS NOT NULL THEN true ELSE false END as "isArchived",
         CASE WHEN d.properties->>'pending' = 'true' THEN true ELSE false END as "isPending"
       FROM documents d
       LEFT JOIN users u ON u.id = (d.properties->>'user_id')::uuid
       WHERE d.workspace_id = $1
         AND d.document_type = 'person'
         AND ($4 OR d.archived_at IS NULL)
         AND ${VISIBILITY_FILTER_SQL('d', '$2', '$3')}
       ORDER BY d.archived_at NULLS FIRST, d.title`,
      [workspaceId, userId, isAdmin, includeArchived]
    );

    // Get workspace sprint start date
    const workspaceResult = await pool.query(
      `SELECT sprint_start_date FROM workspaces WHERE id = $1`,
      [workspaceId]
    );

    const rawSprintStartDate = workspaceResult.rows[0]?.sprint_start_date;
    const sprintDurationDays = 7; // 1-week sprints

    const today = new Date();

    // Normalize sprint start date to midnight UTC to avoid timezone issues
    // pg driver may return DATE as a Date object with local timezone offset
    let startDate: Date;
    if (rawSprintStartDate instanceof Date) {
      // Extract just the date parts and create a UTC midnight date
      startDate = new Date(Date.UTC(rawSprintStartDate.getFullYear(), rawSprintStartDate.getMonth(), rawSprintStartDate.getDate()));
    } else if (typeof rawSprintStartDate === 'string') {
      // Parse string as UTC midnight
      startDate = new Date(rawSprintStartDate + 'T00:00:00Z');
    } else {
      // Fallback to today
      startDate = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
    }

    // Calculate which sprint number we're in
    const daysSinceStart = Math.floor((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const currentSprintNumber = Math.max(1, Math.floor(daysSinceStart / sprintDurationDays) + 1);

    // Parse query params for sprint range (default: ~quarter each way)
    const defaultBack = 7;
    const defaultForward = 7;
    const fromSprint = req.query.fromSprint
      ? Math.max(1, parseInt(req.query.fromSprint as string, 10))
      : Math.max(1, currentSprintNumber - defaultBack);
    const toSprint = req.query.toSprint
      ? parseInt(req.query.toSprint as string, 10)
      : currentSprintNumber + defaultForward;

    // Generate sprint periods for requested range
    const sprints = [];
    for (let i = fromSprint; i <= toSprint; i++) {
      const sprintStart = new Date(startDate);
      sprintStart.setUTCDate(sprintStart.getUTCDate() + (i - 1) * sprintDurationDays);

      const sprintEnd = new Date(sprintStart);
      sprintEnd.setUTCDate(sprintEnd.getUTCDate() + sprintDurationDays - 1);

      sprints.push({
        number: i,
        name: `Sprint ${i}`,
        startDate: sprintStart.toISOString().split('T')[0],
        endDate: sprintEnd.toISOString().split('T')[0],
        isCurrent: i === currentSprintNumber,
      });
    }

    // Get all sprints from database that fall within our date range
    const minDate = sprints[0]?.startDate || today.toISOString().split('T')[0];
    const maxDate = sprints[sprints.length - 1]?.endDate || today.toISOString().split('T')[0];

    const dbSprintsResult = await pool.query(
      `SELECT d.id, d.title as name, d.properties->>'start_date' as start_date, d.properties->>'end_date' as end_date, d.program_id,
              p.title as program_name, p.properties->>'emoji' as program_emoji, p.properties->>'color' as program_color
       FROM documents d
       JOIN documents p ON d.program_id = p.id
       WHERE d.workspace_id = $1 AND d.document_type = 'sprint'
         AND (d.properties->>'start_date')::date >= $2 AND (d.properties->>'end_date')::date <= $3
         AND ${VISIBILITY_FILTER_SQL('d', '$4', '$5')}`,
      [workspaceId, minDate, maxDate, userId, isAdmin]
    );

    // Get issues with sprint and assignee info (only visible issues)
    const issuesResult = await pool.query(
      `SELECT i.id, i.title, i.sprint_id, i.properties->>'assignee_id' as assignee_id, i.properties->>'state' as state, i.ticket_number,
              s.properties->>'start_date' as sprint_start, s.properties->>'end_date' as sprint_end,
              p.id as program_id, p.title as program_name, p.properties->>'emoji' as program_emoji, p.properties->>'color' as program_color
       FROM documents i
       JOIN documents s ON i.sprint_id = s.id
       JOIN documents p ON i.program_id = p.id
       WHERE i.workspace_id = $1 AND i.document_type = 'issue' AND i.sprint_id IS NOT NULL AND i.properties->>'assignee_id' IS NOT NULL
         AND ${VISIBILITY_FILTER_SQL('i', '$2', '$3')}`,
      [workspaceId, userId, isAdmin]
    );

    // Build associations: user_id -> sprint_number -> { programs: [...], issues: [...] }
    const associations: Record<string, Record<number, {
      programs: Array<{ id: string; name: string; emoji?: string | null; color: string; issueCount: number }>;
      issues: Array<{ id: string; title: string; displayId: string; state: string }>;
    }>> = {};

    for (const issue of issuesResult.rows) {
      const userId = issue.assignee_id;
      // Parse issue's sprint start date as UTC midnight to match startDate
      const sprintStart = new Date(issue.sprint_start + 'T00:00:00Z');

      // Calculate which sprint number this issue belongs to
      const daysSinceStart = Math.floor((sprintStart.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      const sprintNumber = Math.max(1, Math.floor(daysSinceStart / sprintDurationDays) + 1);

      // Skip if outside our range
      if (!sprints.find(s => s.number === sprintNumber)) continue;

      if (!associations[userId]) {
        associations[userId] = {};
      }
      if (!associations[userId][sprintNumber]) {
        associations[userId][sprintNumber] = { programs: [], issues: [] };
      }

      const cell = associations[userId][sprintNumber];

      // Add issue
      cell.issues.push({
        id: issue.id,
        title: issue.title,
        displayId: `#${issue.ticket_number}`,
        state: issue.state,
      });

      // Add program if not already there
      const existingProgram = cell.programs.find(p => p.id === issue.program_id);
      if (existingProgram) {
        existingProgram.issueCount++;
      } else {
        cell.programs.push({
          id: issue.program_id,
          name: issue.program_name,
          emoji: issue.program_emoji,
          color: issue.program_color,
          issueCount: 1,
        });
      }
    }

    res.json({
      users: usersResult.rows,
      sprints,
      associations,
      currentSprintNumber,
    });
  } catch (err) {
    console.error('Get team grid error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/team/programs - Get all programs
router.get('/programs', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    const result = await pool.query(
      `SELECT id, title as name, properties->>'emoji' as emoji, properties->>'color' as color
       FROM documents
       WHERE workspace_id = $1 AND document_type = 'program'
         AND ${VISIBILITY_FILTER_SQL('documents', '$2', '$3')}
       ORDER BY title`,
      [workspaceId, userId, isAdmin]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Get programs error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/team/assignments - Get user->sprint->program assignments based on sprint owner_id
router.get('/assignments', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

// Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Get all sprints with their owners (only visible sprints)
    // Sprint assignment is based on owner_id (explicit assignment), not issue assignees
    const sprintsResult = await pool.query(
      `SELECT s.id as sprint_id, s.properties->>'sprint_number' as sprint_number,
              s.properties->>'owner_id' as owner_id,
              p.id as program_id, p.title as program_name,
              p.properties->>'emoji' as emoji, p.properties->>'color' as color
       FROM documents s
       JOIN documents p ON s.program_id = p.id
       WHERE s.workspace_id = $1 AND s.document_type = 'sprint'
         AND s.properties->>'owner_id' IS NOT NULL
         AND ${VISIBILITY_FILTER_SQL('s', '$2', '$3')}`,
      [workspaceId, userId, isAdmin]
    );

    // Build assignments map: userId -> sprintNumber -> assignment
    const assignments: Record<string, Record<number, {
      programId: string;
      programName: string;
      emoji?: string | null;
      color: string;
      sprintDocId: string;
    }>> = {};

    for (const sprint of sprintsResult.rows) {
      const userId = sprint.owner_id;
      const sprintNumber = parseInt(sprint.sprint_number, 10);

      if (!userId || isNaN(sprintNumber)) continue;

      if (!assignments[userId]) {
        assignments[userId] = {};
      }

      // One owner per sprint window - this should be enforced at write time
      assignments[userId][sprintNumber] = {
        programId: sprint.program_id,
        programName: sprint.program_name,
        emoji: sprint.emoji,
        color: sprint.color,
        sprintDocId: sprint.sprint_id,
      };
    }

    res.json(assignments);
  } catch (err) {
    console.error('Get assignments error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/team/assign - Assign user as sprint owner for a program
// Accepts personId (person document ID) - preferred for pending users
// Falls back to userId for backward compatibility
router.post('/assign', authMiddleware, async (req: Request, res: Response) => {
  try {
    const workspaceId = req.workspaceId!;
    const { personId, userId, programId, sprintNumber } = req.body;

    // personId is preferred (works for both pending and active users)
    // userId is for backward compatibility
    const ownerId = personId || userId;

    if (!ownerId || !programId || !sprintNumber) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    // Validate personId belongs to current workspace (SECURITY: prevent cross-workspace injection)
    let personDocId = personId;
    if (personId) {
      const personCheck = await pool.query(
        `SELECT id FROM documents
         WHERE id = $1 AND workspace_id = $2 AND document_type = 'person'`,
        [personId, workspaceId]
      );
      if (!personCheck.rows[0]) {
        res.status(400).json({ error: 'Invalid personId for this workspace' });
        return;
      }
    } else if (userId) {
      // If userId was provided instead of personId, look up the person doc ID
      const personResult = await pool.query(
        `SELECT id FROM documents
         WHERE workspace_id = $1 AND document_type = 'person'
           AND properties->>'user_id' = $2 AND archived_at IS NULL`,
        [workspaceId, userId]
      );
      if (personResult.rows[0]) {
        personDocId = personResult.rows[0].id;
      } else {
        res.status(400).json({ error: 'Invalid userId for this workspace' });
        return;
      }
    }

    // Validate programId belongs to current workspace (SECURITY: prevent cross-workspace injection)
    const programCheck = await pool.query(
      `SELECT id FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'program'`,
      [programId, workspaceId]
    );
    if (!programCheck.rows[0]) {
      res.status(400).json({ error: 'Invalid programId for this workspace' });
      return;
    }

    // Check if person is already assigned to another program for this sprint window
    // owner_id now stores person document ID (works for both pending and active users)
    const existingAssignment = await pool.query(
      `SELECT s.id, p.id as program_id, p.title as program_name
       FROM documents s
       JOIN documents p ON s.program_id = p.id
       WHERE s.workspace_id = $1 AND s.document_type = 'sprint'
         AND s.properties->>'owner_id' = $2
         AND (s.properties->>'sprint_number')::int = $3
         AND p.id != $4`,
      [workspaceId, personDocId, sprintNumber, programId]
    );

    if (existingAssignment.rows[0]) {
      res.status(409).json({
        error: 'User already assigned to another program',
        existingProgramId: existingAssignment.rows[0].program_id,
        existingProgramName: existingAssignment.rows[0].program_name,
      });
      return;
    }

    // Find existing sprint for this program and sprint number
    let sprintResult = await pool.query(
      `SELECT id, properties FROM documents
       WHERE workspace_id = $1 AND document_type = 'sprint'
         AND program_id = $2 AND (properties->>'sprint_number')::int = $3`,
      [workspaceId, programId, sprintNumber]
    );

    let sprintId: string;
    if (sprintResult.rows[0]) {
      // Update existing sprint's owner_id (now stores person doc ID)
      sprintId = sprintResult.rows[0].id;
      const currentProps = sprintResult.rows[0].properties || {};
      const updatedProps = { ...currentProps, owner_id: personDocId };

      await pool.query(
        `UPDATE documents SET properties = $1, updated_at = now() WHERE id = $2`,
        [JSON.stringify(updatedProps), sprintId]
      );
    } else {
      // Create new sprint with owner_id (person doc ID)
      const newSprintResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, program_id, properties)
         VALUES ($1, 'sprint', $2, $3, $4)
         RETURNING id`,
        [workspaceId, `Sprint ${sprintNumber}`, programId, JSON.stringify({ sprint_number: sprintNumber, owner_id: personDocId })]
      );
      sprintId = newSprintResult.rows[0].id;
    }

    res.json({ success: true, sprintId });
  } catch (err) {
    console.error('Assign error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/team/assign - Remove user as sprint owner
// Accepts personId (person document ID) - preferred
// Falls back to userId for backward compatibility
router.delete('/assign', authMiddleware, async (req: Request, res: Response) => {
  try {
    const currentUserId = req.userId!;
    const workspaceId = req.workspaceId!;
    const { personId, userId, sprintNumber } = req.body;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(currentUserId, workspaceId);

    const ownerId = personId || userId;
    if (!ownerId || !sprintNumber) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    // Validate personId belongs to current workspace (SECURITY: prevent cross-workspace injection)
    let personDocId = personId;
    if (personId) {
      const personCheck = await pool.query(
        `SELECT id FROM documents
         WHERE id = $1 AND workspace_id = $2 AND document_type = 'person'`,
        [personId, workspaceId]
      );
      if (!personCheck.rows[0]) {
        res.status(400).json({ error: 'Invalid personId for this workspace' });
        return;
      }
    } else if (userId) {
      // If userId was provided instead of personId, look up the person doc ID
      const personResult = await pool.query(
        `SELECT id FROM documents
         WHERE workspace_id = $1 AND document_type = 'person'
           AND properties->>'user_id' = $2 AND archived_at IS NULL`,
        [workspaceId, userId]
      );
      if (personResult.rows[0]) {
        personDocId = personResult.rows[0].id;
      } else {
        res.status(400).json({ error: 'Invalid userId for this workspace' });
        return;
      }
    }

    // Find the sprint this person owns for this sprint number (only visible sprints)
    // owner_id now stores person document ID
    const sprintResult = await pool.query(
      `SELECT id, properties FROM documents
       WHERE workspace_id = $1 AND document_type = 'sprint'
         AND properties->>'owner_id' = $2
         AND (properties->>'sprint_number')::int = $3
         AND ${VISIBILITY_FILTER_SQL('documents', '$4', '$5')}`,
      [workspaceId, personDocId, sprintNumber, currentUserId, isAdmin]
    );

    if (!sprintResult.rows[0]) {
      res.status(404).json({ error: 'No assignment found' });
      return;
    }

    const sprintId = sprintResult.rows[0].id;
    const currentProps = sprintResult.rows[0].properties || {};

    // Remove owner_id from sprint properties
    const { owner_id: _, ...updatedProps } = currentProps;

    await pool.query(
      `UPDATE documents SET properties = $1, updated_at = now() WHERE id = $2`,
      [JSON.stringify(updatedProps), sprintId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Unassign error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/team/people - Get all people (person documents)
router.get('/people', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Parse includeArchived query param
    const includeArchived = req.query.includeArchived === 'true';

    // Get person documents - return document id for navigation to person editor
    // Also include user_id for grid consistency
    // Email comes from properties or joined user
    // Include pending users so they appear in team lists (but can't be assigned)
    const result = await pool.query(
      `SELECT d.id, d.properties->>'user_id' as user_id, d.title as name,
              COALESCE(d.properties->>'email', u.email) as email,
              CASE WHEN d.archived_at IS NOT NULL THEN true ELSE false END as "isArchived",
              CASE WHEN d.properties->>'pending' = 'true' THEN true ELSE false END as "isPending"
       FROM documents d
       LEFT JOIN users u ON u.id = (d.properties->>'user_id')::uuid
       WHERE d.workspace_id = $1
         AND d.document_type = 'person'
         AND ($4 OR d.archived_at IS NULL)
         AND ${VISIBILITY_FILTER_SQL('d', '$2', '$3')}
       ORDER BY d.archived_at NULLS FIRST, d.title`,
      [workspaceId, userId, isAdmin, includeArchived]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Get people error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/team/accountability - Get sprint completion metrics per person (admin only)
// Returns: { people, sprints, metrics } where metrics[userId][sprintNumber] = { committed, completed }
router.get('/accountability', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Check if user is admin
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);
    if (!isAdmin) {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }

    // Get workspace sprint start date
    const workspaceResult = await pool.query(
      `SELECT sprint_start_date FROM workspaces WHERE id = $1`,
      [workspaceId]
    );

    const rawSprintStartDate = workspaceResult.rows[0]?.sprint_start_date;
    const sprintDurationDays = 7; // 1-week sprints
    const today = new Date();

    let startDate: Date;
    if (rawSprintStartDate instanceof Date) {
      startDate = new Date(Date.UTC(rawSprintStartDate.getFullYear(), rawSprintStartDate.getMonth(), rawSprintStartDate.getDate()));
    } else if (typeof rawSprintStartDate === 'string') {
      startDate = new Date(rawSprintStartDate + 'T00:00:00Z');
    } else {
      startDate = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
    }

    // Calculate current sprint number
    const daysSinceStart = Math.floor((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const currentSprintNumber = Math.max(1, Math.floor(daysSinceStart / sprintDurationDays) + 1);

    // Get last 6 sprints (including current)
    const fromSprint = Math.max(1, currentSprintNumber - 5);
    const toSprint = currentSprintNumber;

    // Generate sprint info
    const sprints = [];
    for (let i = fromSprint; i <= toSprint; i++) {
      const sprintStart = new Date(startDate);
      sprintStart.setUTCDate(sprintStart.getUTCDate() + (i - 1) * sprintDurationDays);
      const sprintEnd = new Date(sprintStart);
      sprintEnd.setUTCDate(sprintEnd.getUTCDate() + sprintDurationDays - 1);

      sprints.push({
        number: i,
        name: `Sprint ${i}`,
        startDate: sprintStart.toISOString().split('T')[0],
        endDate: sprintEnd.toISOString().split('T')[0],
        isCurrent: i === currentSprintNumber,
      });
    }

    // Get all people in workspace (exclude pending - they can't have assignments)
    const peopleResult = await pool.query(
      `SELECT
         d.properties->>'user_id' as id,
         d.title as name
       FROM documents d
       WHERE d.workspace_id = $1
         AND d.document_type = 'person'
         AND d.archived_at IS NULL
         AND (d.properties->>'pending' IS NULL OR d.properties->>'pending' != 'true')
       ORDER BY d.title`,
      [workspaceId]
    );

    // Get all issues with estimates, assignees, sprint info, and completion state
    const issuesResult = await pool.query(
      `SELECT
         i.properties->>'assignee_id' as assignee_id,
         i.sprint_id,
         COALESCE((i.properties->>'estimate')::numeric, 0) as estimate,
         i.properties->>'state' as state,
         s.properties->>'sprint_number' as sprint_number
       FROM documents i
       JOIN documents s ON i.sprint_id = s.id
       WHERE i.workspace_id = $1
         AND i.document_type = 'issue'
         AND i.sprint_id IS NOT NULL
         AND i.properties->>'assignee_id' IS NOT NULL`,
      [workspaceId]
    );

    // Calculate metrics: userId -> sprintNumber -> { committed, completed }
    const metrics: Record<string, Record<number, { committed: number; completed: number }>> = {};

    for (const issue of issuesResult.rows) {
      const assigneeId = issue.assignee_id;
      const sprintNumber = parseInt(issue.sprint_number, 10);
      const estimate = parseFloat(issue.estimate) || 0;
      const isDone = issue.state === 'done';

      // Skip if outside our range
      if (sprintNumber < fromSprint || sprintNumber > toSprint) continue;

      if (!metrics[assigneeId]) {
        metrics[assigneeId] = {};
      }
      if (!metrics[assigneeId][sprintNumber]) {
        metrics[assigneeId][sprintNumber] = { committed: 0, completed: 0 };
      }

      metrics[assigneeId][sprintNumber].committed += estimate;
      if (isDone) {
        metrics[assigneeId][sprintNumber].completed += estimate;
      }
    }

    // Detect pattern alerts: 2+ consecutive sprints below 60% completion
    const patternAlerts: Record<string, {
      hasAlert: boolean;
      consecutiveCount: number;
      trend: number[]; // completion percentages for last N sprints
    }> = {};

    for (const person of peopleResult.rows) {
      const personMetrics = metrics[person.id];
      if (!personMetrics) {
        patternAlerts[person.id] = { hasAlert: false, consecutiveCount: 0, trend: [] };
        continue;
      }

      // Build trend array (completion percentages in sprint order)
      const trend: number[] = [];
      let consecutiveLow = 0;
      let maxConsecutiveLow = 0;

      for (let i = fromSprint; i <= toSprint; i++) {
        const sprintMetrics = personMetrics[i];
        if (sprintMetrics && sprintMetrics.committed > 0) {
          const rate = Math.round((sprintMetrics.completed / sprintMetrics.committed) * 100);
          trend.push(rate);

          if (rate < 60) {
            consecutiveLow++;
            maxConsecutiveLow = Math.max(maxConsecutiveLow, consecutiveLow);
          } else {
            consecutiveLow = 0;
          }
        } else {
          trend.push(-1); // -1 indicates no data
          consecutiveLow = 0; // Reset streak on no data
        }
      }

      patternAlerts[person.id] = {
        hasAlert: maxConsecutiveLow >= 2,
        consecutiveCount: maxConsecutiveLow,
        trend,
      };
    }

    res.json({
      people: peopleResult.rows,
      sprints,
      metrics,
      patternAlerts,
    });
  } catch (err) {
    console.error('Get accountability error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/team/people/:personId/sprint-metrics - Get sprint completion metrics for a specific person
// Only visible to the person themselves or workspace admins
router.get('/people/:personId/sprint-metrics', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;
    const { personId } = req.params;

    // Get the person document to find the user_id
    const personResult = await pool.query(
      `SELECT properties->>'user_id' as user_id
       FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'person'`,
      [personId, workspaceId]
    );

    if (!personResult.rows[0]) {
      res.status(404).json({ error: 'Person not found' });
      return;
    }

    const targetUserId = personResult.rows[0].user_id;

    // Check if user can view this person's metrics (self or admin)
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);
    const isSelf = userId === targetUserId;

    if (!isAdmin && !isSelf) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    // Get workspace sprint start date
    const workspaceResult = await pool.query(
      `SELECT sprint_start_date FROM workspaces WHERE id = $1`,
      [workspaceId]
    );

    const rawSprintStartDate = workspaceResult.rows[0]?.sprint_start_date;
    const sprintDurationDays = 7; // 1-week sprints
    const today = new Date();

    let startDate: Date;
    if (rawSprintStartDate instanceof Date) {
      startDate = new Date(Date.UTC(rawSprintStartDate.getFullYear(), rawSprintStartDate.getMonth(), rawSprintStartDate.getDate()));
    } else if (typeof rawSprintStartDate === 'string') {
      startDate = new Date(rawSprintStartDate + 'T00:00:00Z');
    } else {
      startDate = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
    }

    // Calculate current sprint number
    const daysSinceStart = Math.floor((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const currentSprintNumber = Math.max(1, Math.floor(daysSinceStart / sprintDurationDays) + 1);

    // Get last 6 sprints (including current)
    const fromSprint = Math.max(1, currentSprintNumber - 5);
    const toSprint = currentSprintNumber;

    // Generate sprint info
    const sprints = [];
    for (let i = fromSprint; i <= toSprint; i++) {
      const sprintStart = new Date(startDate);
      sprintStart.setUTCDate(sprintStart.getUTCDate() + (i - 1) * sprintDurationDays);
      const sprintEnd = new Date(sprintStart);
      sprintEnd.setUTCDate(sprintEnd.getUTCDate() + sprintDurationDays - 1);

      sprints.push({
        number: i,
        name: `Sprint ${i}`,
        startDate: sprintStart.toISOString().split('T')[0],
        endDate: sprintEnd.toISOString().split('T')[0],
        isCurrent: i === currentSprintNumber,
      });
    }

    // Get all issues for this person with estimates, sprint info, and completion state
    const issuesResult = await pool.query(
      `SELECT
         COALESCE((i.properties->>'estimate')::numeric, 0) as estimate,
         i.properties->>'state' as state,
         s.properties->>'sprint_number' as sprint_number
       FROM documents i
       JOIN documents s ON i.sprint_id = s.id
       WHERE i.workspace_id = $1
         AND i.document_type = 'issue'
         AND i.sprint_id IS NOT NULL
         AND i.properties->>'assignee_id' = $2`,
      [workspaceId, targetUserId]
    );

    // Calculate metrics: sprintNumber -> { committed, completed }
    const metrics: Record<number, { committed: number; completed: number }> = {};

    for (const issue of issuesResult.rows) {
      const sprintNumber = parseInt(issue.sprint_number, 10);
      const estimate = parseFloat(issue.estimate) || 0;
      const isDone = issue.state === 'done';

      // Skip if outside our range
      if (sprintNumber < fromSprint || sprintNumber > toSprint) continue;

      if (!metrics[sprintNumber]) {
        metrics[sprintNumber] = { committed: 0, completed: 0 };
      }

      metrics[sprintNumber].committed += estimate;
      if (isDone) {
        metrics[sprintNumber].completed += estimate;
      }
    }

    // Calculate average completion rate
    let totalCommitted = 0;
    let totalCompleted = 0;
    for (const data of Object.values(metrics)) {
      totalCommitted += data.committed;
      totalCompleted += data.completed;
    }
    const averageRate = totalCommitted > 0 ? Math.round((totalCompleted / totalCommitted) * 100) : 0;

    res.json({
      sprints,
      metrics,
      averageRate,
    });
  } catch (err) {
    console.error('Get person sprint metrics error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
