import { Router, Request, Response } from 'express';
import { pool } from '../db/client.js';
import { z } from 'zod';
import { getVisibilityContext, VISIBILITY_FILTER_SQL } from '../middleware/visibility.js';
import { authMiddleware } from '../middleware/auth.js';

type RouterType = ReturnType<typeof Router>;
const router: RouterType = Router();

// Validation schemas
// Sprint properties: only sprint_number and owner_id are stored
// Dates and status are computed from sprint_number + workspace.sprint_start_date
const createSprintSchema = z.object({
  program_id: z.string().uuid(),
  title: z.string().min(1).max(200).optional().default('Untitled'),
  sprint_number: z.number().int().positive(),
  owner_id: z.string().uuid(),
});

const updateSprintSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  owner_id: z.string().uuid().optional(),
});

// Helper to extract sprint from row
// Dates and status are computed on frontend from sprint_number + workspace.sprint_start_date
function extractSprintFromRow(row: any) {
  const props = row.properties || {};
  return {
    id: row.id,
    name: row.title,
    sprint_number: props.sprint_number || 1,
    owner: row.owner_id ? {
      id: row.owner_id,
      name: row.owner_name,
      email: row.owner_email,
    } : null,
    program_id: row.program_id,
    program_name: row.program_name,
    program_prefix: row.program_prefix,
    workspace_sprint_start_date: row.workspace_sprint_start_date,
    issue_count: parseInt(row.issue_count) || 0,
    completed_count: parseInt(row.completed_count) || 0,
    started_count: parseInt(row.started_count) || 0,
    has_plan: row.has_plan === true || row.has_plan === 't',
    has_retro: row.has_retro === true || row.has_retro === 't',
  };
}

// Get single sprint
router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    const result = await pool.query(
      `SELECT d.id, d.title, d.properties, d.program_id,
              p.title as program_name, p.properties->>'prefix' as program_prefix,
              w.sprint_start_date as workspace_sprint_start_date,
              u.id as owner_id, u.name as owner_name, u.email as owner_email,
              (SELECT COUNT(*) FROM documents i WHERE i.sprint_id = d.id AND i.document_type = 'issue') as issue_count,
              (SELECT COUNT(*) FROM documents i WHERE i.sprint_id = d.id AND i.document_type = 'issue' AND i.properties->>'state' = 'done') as completed_count,
              (SELECT COUNT(*) FROM documents i WHERE i.sprint_id = d.id AND i.document_type = 'issue' AND i.properties->>'state' IN ('in_progress', 'in_review')) as started_count,
              (SELECT COUNT(*) > 0 FROM documents pl WHERE pl.parent_id = d.id AND pl.document_type = 'sprint_plan') as has_plan,
              (SELECT COUNT(*) > 0 FROM documents rt WHERE rt.parent_id = d.id AND rt.document_type = 'sprint_retro') as has_retro
       FROM documents d
       JOIN documents p ON d.program_id = p.id
       JOIN workspaces w ON d.workspace_id = w.id
       LEFT JOIN users u ON (d.properties->>'owner_id')::uuid = u.id
       WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'sprint'
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Sprint not found' });
      return;
    }

    res.json(extractSprintFromRow(result.rows[0]));
  } catch (err) {
    console.error('Get sprint error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create sprint (creates a document with document_type = 'sprint')
// Only stores sprint_number and owner_id - dates/status computed from sprint_number
router.post('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    const parsed = createSprintSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
      return;
    }

    const { program_id, title, sprint_number, owner_id } = parsed.data;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify program belongs to workspace, user can access it, and get workspace info
    const programCheck = await pool.query(
      `SELECT d.id, w.sprint_start_date
       FROM documents d
       JOIN workspaces w ON d.workspace_id = w.id
       WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'program'
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
      [program_id, workspaceId, userId, isAdmin]
    );

    if (programCheck.rows.length === 0) {
      res.status(404).json({ error: 'Program not found' });
      return;
    }

    // Verify owner exists in workspace
    const ownerCheck = await pool.query(
      `SELECT u.id, u.name, u.email FROM users u
       JOIN workspace_memberships wm ON wm.user_id = u.id
       WHERE u.id = $1 AND wm.workspace_id = $2`,
      [owner_id, req.workspaceId]
    );

    if (ownerCheck.rows.length === 0) {
      res.status(400).json({ error: 'Owner not found in workspace' });
      return;
    }

    // Check if sprint already exists for this program + sprint_number
    const existingCheck = await pool.query(
      `SELECT id FROM documents
       WHERE program_id = $1 AND document_type = 'sprint' AND (properties->>'sprint_number')::int = $2`,
      [program_id, sprint_number]
    );

    if (existingCheck.rows.length > 0) {
      res.status(400).json({ error: `Sprint ${sprint_number} already exists for this program` });
      return;
    }

    // Build properties JSONB - only sprint_number and owner_id
    const properties = {
      sprint_number,
      owner_id,
    };

    const result = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, program_id, properties, created_by)
       VALUES ($1, 'sprint', $2, $3, $4, $5)
       RETURNING id, title, properties, program_id`,
      [req.workspaceId, title, program_id, JSON.stringify(properties), req.userId]
    );

    const owner = ownerCheck.rows[0];
    const sprintStartDate = programCheck.rows[0].sprint_start_date;

    res.status(201).json({
      id: result.rows[0].id,
      name: result.rows[0].title,
      sprint_number,
      owner: {
        id: owner.id,
        name: owner.name,
        email: owner.email,
      },
      program_id,
      workspace_sprint_start_date: sprintStartDate,
      issue_count: 0,
      completed_count: 0,
      started_count: 0,
    });
  } catch (err) {
    console.error('Create sprint error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update sprint - only title and owner_id can be updated
// sprint_number cannot be changed (determines window), dates/status are computed
router.patch('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    const parsed = updateSprintSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
      return;
    }

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify sprint exists and user can access it
    const existing = await pool.query(
      `SELECT id, properties FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'sprint'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Sprint not found' });
      return;
    }

    const currentProps = existing.rows[0].properties || {};
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    const data = parsed.data;

    // Handle title update (regular column)
    if (data.title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      values.push(data.title);
    }

    // Handle owner_id update (in properties)
    const newProps = { ...currentProps };
    let propsChanged = false;

    if (data.owner_id !== undefined) {
      // Verify owner exists in workspace
      const ownerCheck = await pool.query(
        `SELECT u.id FROM users u
         JOIN workspace_memberships wm ON wm.user_id = u.id
         WHERE u.id = $1 AND wm.workspace_id = $2`,
        [data.owner_id, req.workspaceId]
      );

      if (ownerCheck.rows.length === 0) {
        res.status(400).json({ error: 'Owner not found in workspace' });
        return;
      }

      newProps.owner_id = data.owner_id;
      propsChanged = true;
    }

    if (propsChanged) {
      updates.push(`properties = $${paramIndex++}`);
      values.push(JSON.stringify(newProps));
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    updates.push(`updated_at = now()`);

    await pool.query(
      `UPDATE documents SET ${updates.join(', ')}
       WHERE id = $${paramIndex} AND workspace_id = $${paramIndex + 1} AND document_type = 'sprint'`,
      [...values, id, req.workspaceId]
    );

    // Re-query to get full sprint with owner info
    const result = await pool.query(
      `SELECT d.id, d.title, d.properties, d.program_id,
              p.title as program_name, p.properties->>'prefix' as program_prefix,
              w.sprint_start_date as workspace_sprint_start_date,
              u.id as owner_id, u.name as owner_name, u.email as owner_email,
              (SELECT COUNT(*) FROM documents i WHERE i.sprint_id = d.id AND i.document_type = 'issue') as issue_count,
              (SELECT COUNT(*) FROM documents i WHERE i.sprint_id = d.id AND i.document_type = 'issue' AND i.properties->>'state' = 'done') as completed_count,
              (SELECT COUNT(*) FROM documents i WHERE i.sprint_id = d.id AND i.document_type = 'issue' AND i.properties->>'state' IN ('in_progress', 'in_review')) as started_count
       FROM documents d
       JOIN documents p ON d.program_id = p.id
       JOIN workspaces w ON d.workspace_id = w.id
       LEFT JOIN users u ON (d.properties->>'owner_id')::uuid = u.id
       WHERE d.id = $1 AND d.document_type = 'sprint'`,
      [id]
    );

    res.json(extractSprintFromRow(result.rows[0]));
  } catch (err) {
    console.error('Update sprint error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete sprint
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify sprint exists and user can access it
    const existing = await pool.query(
      `SELECT id FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'sprint'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Sprint not found' });
      return;
    }

    // Remove sprint_id from issues
    await pool.query(
      `UPDATE documents SET sprint_id = NULL WHERE sprint_id = $1`,
      [id]
    );

    await pool.query(
      `DELETE FROM documents WHERE id = $1 AND document_type = 'sprint'`,
      [id]
    );

    res.status(204).send();
  } catch (err) {
    console.error('Delete sprint error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get sprint issues
router.get('/:id/issues', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify sprint exists, user can access it, and get program info
    const sprintResult = await pool.query(
      `SELECT d.id, p.properties->>'prefix' as prefix FROM documents d
       JOIN documents p ON d.program_id = p.id
       WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'sprint'
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (sprintResult.rows.length === 0) {
      res.status(404).json({ error: 'Sprint not found' });
      return;
    }

    const prefix = sprintResult.rows[0].prefix;

    const result = await pool.query(
      `SELECT d.id, d.title, d.properties, d.ticket_number,
              d.created_at, d.updated_at, d.created_by,
              u.name as assignee_name,
              CASE WHEN person_doc.archived_at IS NOT NULL THEN true ELSE false END as assignee_archived
       FROM documents d
       LEFT JOIN users u ON (d.properties->>'assignee_id')::uuid = u.id
       LEFT JOIN documents person_doc ON person_doc.workspace_id = d.workspace_id
         AND person_doc.document_type = 'person'
         AND person_doc.properties->>'user_id' = d.properties->>'assignee_id'
       WHERE d.sprint_id = $1 AND d.document_type = 'issue'
         AND ${VISIBILITY_FILTER_SQL('d', '$2', '$3')}
       ORDER BY
         CASE d.properties->>'priority'
           WHEN 'urgent' THEN 1
           WHEN 'high' THEN 2
           WHEN 'medium' THEN 3
           WHEN 'low' THEN 4
           ELSE 5
         END,
         d.updated_at DESC`,
      [id, userId, isAdmin]
    );

    // Get carryover sprint names for issues that have carryover_from_sprint_id
    const carryoverSprintIds = result.rows
      .map(row => row.properties?.carryover_from_sprint_id)
      .filter(Boolean);

    let carryoverSprintNames: Record<string, string> = {};
    if (carryoverSprintIds.length > 0) {
      const uniqueIds = [...new Set(carryoverSprintIds)];
      const sprintNamesResult = await pool.query(
        `SELECT id, title FROM documents WHERE id = ANY($1) AND document_type = 'sprint'`,
        [uniqueIds]
      );
      carryoverSprintNames = Object.fromEntries(
        sprintNamesResult.rows.map(r => [r.id, r.title])
      );
    }

    const issues = result.rows.map(row => {
      const props = row.properties || {};
      const carryoverFromSprintId = props.carryover_from_sprint_id || null;
      return {
        id: row.id,
        title: row.title,
        state: props.state || 'backlog',
        priority: props.priority || 'medium',
        assignee_id: props.assignee_id || null,
        estimate: props.estimate ?? null,
        ticket_number: row.ticket_number,
        created_at: row.created_at,
        updated_at: row.updated_at,
        created_by: row.created_by,
        assignee_name: row.assignee_name,
        assignee_archived: row.assignee_archived || false,
        display_id: `#${row.ticket_number}`,
        carryover_from_sprint_id: carryoverFromSprintId,
        carryover_from_sprint_name: carryoverFromSprintId
          ? carryoverSprintNames[carryoverFromSprintId] || null
          : null,
      };
    });

    res.json(issues);
  } catch (err) {
    console.error('Get sprint issues error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get sprint scope changes
// Returns: { originalScope, currentScope, scopeChangePercent, scopeChanges }
router.get('/:id/scope-changes', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Get sprint info including sprint_number and workspace start date
    const sprintResult = await pool.query(
      `SELECT d.id, d.properties->>'sprint_number' as sprint_number,
              w.sprint_start_date as workspace_sprint_start_date
       FROM documents d
       JOIN workspaces w ON d.workspace_id = w.id
       WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'sprint'
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (sprintResult.rows.length === 0) {
      res.status(404).json({ error: 'Sprint not found' });
      return;
    }

    const sprintNumber = parseInt(sprintResult.rows[0].sprint_number, 10);
    const rawStartDate = sprintResult.rows[0].workspace_sprint_start_date;
    const sprintDuration = 14;

    // Calculate sprint start date
    let workspaceStartDate: Date;
    if (rawStartDate instanceof Date) {
      workspaceStartDate = new Date(Date.UTC(rawStartDate.getFullYear(), rawStartDate.getMonth(), rawStartDate.getDate()));
    } else if (typeof rawStartDate === 'string') {
      workspaceStartDate = new Date(rawStartDate + 'T00:00:00Z');
    } else {
      workspaceStartDate = new Date();
    }

    const sprintStartDate = new Date(workspaceStartDate);
    sprintStartDate.setUTCDate(sprintStartDate.getUTCDate() + (sprintNumber - 1) * sprintDuration);

    // Get all issues currently in the sprint with their estimates
    const issuesResult = await pool.query(
      `SELECT d.id, COALESCE((d.properties->>'estimate')::numeric, 0) as estimate
       FROM documents d
       WHERE d.sprint_id = $1 AND d.document_type = 'issue'`,
      [id]
    );

    // Get when each issue was added to this sprint from document_history
    // field = 'sprint_id' and new_value = sprint_id means issue was added to sprint
    const historyResult = await pool.query(
      `SELECT document_id, created_at, old_value, new_value
       FROM document_history
       WHERE field = 'sprint_id' AND new_value = $1
       ORDER BY created_at ASC`,
      [id]
    );

    // Build a map of issue_id -> first_added_at (when issue was added to this sprint)
    const issueAddedAtMap: Record<string, Date> = {};
    for (const row of historyResult.rows) {
      if (!issueAddedAtMap[row.document_id]) {
        issueAddedAtMap[row.document_id] = new Date(row.created_at);
      }
    }

    // Calculate original scope (issues added before or at sprint start)
    // and current scope (all issues)
    let originalScope = 0;
    let currentScope = 0;

    for (const issue of issuesResult.rows) {
      const estimate = parseFloat(issue.estimate) || 0;
      currentScope += estimate;

      const addedAt = issueAddedAtMap[issue.id];
      // If no history record, assume it was always there (original)
      // If added before or at sprint start, it's original scope
      if (!addedAt || addedAt <= sprintStartDate) {
        originalScope += estimate;
      }
    }

    // Build scope changes timeline for the graph
    // Each entry: { timestamp, newScope, changeType, estimateChange }
    const scopeChanges: Array<{
      timestamp: string;
      scopeAfter: number;
      changeType: 'added' | 'removed';
      estimateChange: number;
    }> = [];

    // Get estimates for issues when they were added
    const issueEstimateMap: Record<string, number> = {};
    for (const issue of issuesResult.rows) {
      issueEstimateMap[issue.id] = parseFloat(issue.estimate) || 0;
    }

    // Only track changes after sprint starts
    let runningScope = originalScope;
    for (const row of historyResult.rows) {
      const createdAt = new Date(row.created_at);
      if (createdAt > sprintStartDate) {
        const estimate = issueEstimateMap[row.document_id] || 0;
        runningScope += estimate;
        scopeChanges.push({
          timestamp: createdAt.toISOString(),
          scopeAfter: runningScope,
          changeType: 'added',
          estimateChange: estimate,
        });
      }
    }

    // Also check for issues removed from sprint (sprint_id changed away from this sprint)
    const removedResult = await pool.query(
      `SELECT document_id, created_at, old_value, new_value
       FROM document_history
       WHERE field = 'sprint_id' AND old_value = $1 AND created_at > $2
       ORDER BY created_at ASC`,
      [id, sprintStartDate.toISOString()]
    );

    for (const row of removedResult.rows) {
      // We need the estimate of the issue at time of removal
      // For simplicity, we'll use the current estimate (or 0 if issue no longer in sprint)
      // In a real system, you might want to track historical estimates
      const issueResult = await pool.query(
        `SELECT COALESCE((properties->>'estimate')::numeric, 0) as estimate
         FROM documents WHERE id = $1`,
        [row.document_id]
      );
      const estimate = issueResult.rows[0] ? parseFloat(issueResult.rows[0].estimate) : 0;

      scopeChanges.push({
        timestamp: new Date(row.created_at).toISOString(),
        scopeAfter: -1, // Will be recalculated when sorting
        changeType: 'removed',
        estimateChange: -estimate,
      });
    }

    // Sort scope changes by timestamp and recalculate running scope
    scopeChanges.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    runningScope = originalScope;
    for (const change of scopeChanges) {
      runningScope += change.estimateChange;
      change.scopeAfter = runningScope;
    }

    // Calculate scope change percentage
    const scopeChangePercent = originalScope > 0
      ? Math.round(((currentScope - originalScope) / originalScope) * 100)
      : 0;

    res.json({
      originalScope,
      currentScope,
      scopeChangePercent,
      sprintStartDate: sprintStartDate.toISOString(),
      scopeChanges,
    });
  } catch (err) {
    console.error('Get sprint scope changes error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
