import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../db/client.js';
import { z } from 'zod';

type RouterType = ReturnType<typeof Router>;
const router: RouterType = Router();

// Auth middleware - check session cookie
async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const sessionId = req.cookies?.session_id;
  if (!sessionId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  try {
    const result = await pool.query(
      `SELECT s.id, s.user_id, s.workspace_id, u.email, u.name
       FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.id = $1 AND s.expires_at > now()`,
      [sessionId]
    );

    if (result.rows.length === 0) {
      res.status(401).json({ error: 'Session expired' });
      return;
    }

    // Extend session on activity
    await pool.query(
      `UPDATE sessions SET last_activity = now(), expires_at = now() + interval '15 minutes' WHERE id = $1`,
      [sessionId]
    );

    req.user = {
      id: result.rows[0].user_id,
      email: result.rows[0].email,
      name: result.rows[0].name,
      workspaceId: result.rows[0].workspace_id,
    };
    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Validation schemas
const createIssueSchema = z.object({
  title: z.string().min(1).max(500),
  state: z.enum(['backlog', 'todo', 'in_progress', 'done', 'cancelled']).optional().default('backlog'),
  priority: z.enum(['urgent', 'high', 'medium', 'low', 'none']).optional().default('medium'),
  assignee_id: z.string().uuid().optional().nullable(),
  program_id: z.string().uuid().optional().nullable(),
  sprint_id: z.string().uuid().optional().nullable(),
});

const updateIssueSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  state: z.enum(['backlog', 'todo', 'in_progress', 'done', 'cancelled']).optional(),
  priority: z.enum(['urgent', 'high', 'medium', 'low', 'none']).optional(),
  assignee_id: z.string().uuid().optional().nullable(),
  program_id: z.string().uuid().optional().nullable(),
  sprint_id: z.string().uuid().optional().nullable(),
  estimate: z.number().positive().nullable().optional(),
});

// Fields to track in document_history
const TRACKED_FIELDS = [
  'title', 'state', 'priority', 'assignee_id',
  'program_id', 'sprint_id', 'estimate'
];

// Log a field change to document_history
async function logDocumentChange(
  documentId: string,
  field: string,
  oldValue: string | null,
  newValue: string | null,
  changedBy: string
) {
  await pool.query(
    `INSERT INTO document_history (document_id, field, old_value, new_value, changed_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [documentId, field, oldValue, newValue, changedBy]
  );
}

// Get timestamp column updates based on status change
function getTimestampUpdates(oldState: string | null, newState: string): Record<string, string> {
  const updates: Record<string, string> = {};

  if (newState === 'in_progress' && oldState !== 'in_progress') {
    if (oldState === 'done' || oldState === 'cancelled') {
      // Reopening from done/cancelled
      updates.reopened_at = 'NOW()';
    } else {
      // First time starting work
      updates.started_at = 'COALESCE(started_at, NOW())';
    }
  }
  if (newState === 'done' && oldState !== 'done') {
    updates.completed_at = 'COALESCE(completed_at, NOW())';
  }
  if (newState === 'cancelled' && oldState !== 'cancelled') {
    updates.cancelled_at = 'NOW()';
  }

  return updates;
}

// Helper to extract issue properties from row
function extractIssueFromRow(row: any) {
  const props = row.properties || {};
  return {
    id: row.id,
    title: row.title,
    state: props.state || 'backlog',
    priority: props.priority || 'medium',
    assignee_id: props.assignee_id || null,
    estimate: props.estimate ?? null,
    source: props.source || 'internal',
    feedback_status: props.feedback_status || null,
    rejection_reason: props.rejection_reason || null,
    ticket_number: row.ticket_number,
    program_id: row.program_id,
    sprint_id: row.sprint_id,
    content: row.content,
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by: row.created_by,
    started_at: row.started_at || null,
    completed_at: row.completed_at || null,
    cancelled_at: row.cancelled_at || null,
    reopened_at: row.reopened_at || null,
    assignee_name: row.assignee_name,
    program_name: row.program_name,
    program_prefix: row.program_prefix,
    program_color: row.program_color,
    sprint_name: row.sprint_name,
    created_by_name: row.created_by_name,
  };
}

// List issues with filters
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { state, priority, assignee_id, program_id, sprint_id, source } = req.query;
    let query = `
      SELECT d.id, d.title, d.properties, d.ticket_number,
             d.program_id, d.sprint_id, d.content,
             d.created_at, d.updated_at, d.created_by,
             d.started_at, d.completed_at, d.cancelled_at, d.reopened_at,
             u.name as assignee_name,
             p.title as program_name,
             p.properties->>'prefix' as program_prefix,
             p.properties->>'color' as program_color
      FROM documents d
      LEFT JOIN users u ON (d.properties->>'assignee_id')::uuid = u.id
      LEFT JOIN documents p ON d.program_id = p.id AND p.document_type = 'program'
      WHERE d.workspace_id = $1 AND d.document_type = 'issue'
    `;
    const params: (string | null)[] = [req.user!.workspaceId];

    // Filter by source - defaults to 'internal' (excludes feedback from regular issues list)
    if (source) {
      query += ` AND d.properties->>'source' = $${params.length + 1}`;
      params.push(source as string);
    } else {
      // By default, only show internal issues (not feedback)
      query += ` AND (d.properties->>'source' = 'internal' OR d.properties->>'source' IS NULL)`;
    }

    if (state) {
      const states = (state as string).split(',');
      query += ` AND d.properties->>'state' = ANY($${params.length + 1})`;
      params.push(states as any);
    }

    if (priority) {
      query += ` AND d.properties->>'priority' = $${params.length + 1}`;
      params.push(priority as string);
    }

    if (assignee_id) {
      if (assignee_id === 'null' || assignee_id === 'unassigned') {
        query += ` AND (d.properties->>'assignee_id' IS NULL OR d.properties->>'assignee_id' = '')`;
      } else {
        query += ` AND d.properties->>'assignee_id' = $${params.length + 1}`;
        params.push(assignee_id as string);
      }
    }

    if (program_id) {
      query += ` AND d.program_id = $${params.length + 1}`;
      params.push(program_id as string);
    }

    if (sprint_id) {
      query += ` AND d.sprint_id = $${params.length + 1}`;
      params.push(sprint_id as string);
    }

    query += ` ORDER BY
      CASE d.properties->>'priority'
        WHEN 'urgent' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 4
        ELSE 5
      END,
      d.updated_at DESC`;

    const result = await pool.query(query, params);

    // Extract and add display_id to each issue
    const issues = result.rows.map(row => {
      const issue = extractIssueFromRow(row);
      return {
        ...issue,
        display_id: issue.program_prefix
          ? `${issue.program_prefix}-${issue.ticket_number}`
          : `#${issue.ticket_number}`
      };
    });

    res.json(issues);
  } catch (err) {
    console.error('List issues error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single issue
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT d.id, d.title, d.properties, d.ticket_number,
              d.program_id, d.sprint_id, d.content,
              d.created_at, d.updated_at, d.created_by,
              d.started_at, d.completed_at, d.cancelled_at, d.reopened_at,
              u.name as assignee_name,
              p.title as program_name,
              p.properties->>'prefix' as program_prefix,
              p.properties->>'color' as program_color,
              s.title as sprint_name,
              creator.name as created_by_name
       FROM documents d
       LEFT JOIN users u ON (d.properties->>'assignee_id')::uuid = u.id
       LEFT JOIN documents p ON d.program_id = p.id AND p.document_type = 'program'
       LEFT JOIN documents s ON d.sprint_id = s.id AND s.document_type = 'sprint'
       LEFT JOIN users creator ON d.created_by = creator.id
       WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'issue'`,
      [id, req.user!.workspaceId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }

    const issue = extractIssueFromRow(result.rows[0]);
    res.json({
      ...issue,
      display_id: issue.program_prefix
        ? `${issue.program_prefix}-${issue.ticket_number}`
        : `#${issue.ticket_number}`
    });
  } catch (err) {
    console.error('Get issue error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create issue
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = createIssueSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
      return;
    }

    const { title, state, priority, assignee_id, program_id, sprint_id } = parsed.data;

    // Get next ticket number for workspace
    const ticketResult = await pool.query(
      `SELECT COALESCE(MAX(ticket_number), 0) + 1 as next_number
       FROM documents
       WHERE workspace_id = $1 AND document_type = 'issue'`,
      [req.user!.workspaceId]
    );
    const ticketNumber = ticketResult.rows[0].next_number;

    // Build properties JSONB
    const properties = {
      state: state || 'backlog',
      priority: priority || 'medium',
      source: 'internal',
      assignee_id: assignee_id || null,
      feedback_status: null,
      rejection_reason: null,
    };

    const result = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, properties, program_id, sprint_id, ticket_number, created_by)
       VALUES ($1, 'issue', $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [req.user!.workspaceId, title, JSON.stringify(properties), program_id || null, sprint_id || null, ticketNumber, req.user!.id]
    );

    // Get program prefix if assigned
    let displayId = `#${ticketNumber}`;
    let programPrefix = null;
    if (program_id) {
      const programResult = await pool.query(
        `SELECT properties->>'prefix' as prefix FROM documents WHERE id = $1 AND document_type = 'program'`,
        [program_id]
      );
      if (programResult.rows[0]) {
        programPrefix = programResult.rows[0].prefix;
        displayId = `${programPrefix}-${ticketNumber}`;
      }
    }

    const row = result.rows[0];
    const issue = extractIssueFromRow({ ...row, program_prefix: programPrefix });
    res.status(201).json({ ...issue, display_id: displayId });
  } catch (err) {
    console.error('Create issue error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update issue
router.patch('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const parsed = updateIssueSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
      return;
    }

    // Get full existing issue for history tracking
    const existing = await pool.query(
      `SELECT id, title, properties, program_id, sprint_id
       FROM documents WHERE id = $1 AND workspace_id = $2 AND document_type = 'issue'`,
      [id, req.user!.workspaceId]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }

    const existingIssue = existing.rows[0];
    const currentProps = existingIssue.properties || {};
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    const data = parsed.data;

    // Validate: estimate required when assigning to sprint
    if (data.sprint_id !== undefined && data.sprint_id !== null) {
      const effectiveEstimate = data.estimate !== undefined ? data.estimate : currentProps.estimate;
      if (!effectiveEstimate) {
        res.status(400).json({ error: 'Estimate is required before assigning to a sprint' });
        return;
      }
    }

    // Track changes for history
    const changes: Array<{ field: string; oldValue: string | null; newValue: string | null }> = [];

    // Handle title update (regular column)
    if (data.title !== undefined && data.title !== existingIssue.title) {
      updates.push(`title = $${paramIndex++}`);
      values.push(data.title);
      changes.push({ field: 'title', oldValue: existingIssue.title, newValue: data.title });
    }

    // Handle properties updates
    const newProps = { ...currentProps };
    let propsChanged = false;

    if (data.state !== undefined && data.state !== currentProps.state) {
      changes.push({ field: 'state', oldValue: currentProps.state || null, newValue: data.state });
      newProps.state = data.state;
      propsChanged = true;

      // Update status timestamps based on state change
      const timestampUpdates = getTimestampUpdates(currentProps.state || null, data.state);
      for (const [col, expr] of Object.entries(timestampUpdates)) {
        updates.push(`${col} = ${expr}`);
      }
    }
    if (data.priority !== undefined && data.priority !== currentProps.priority) {
      changes.push({ field: 'priority', oldValue: currentProps.priority || null, newValue: data.priority });
      newProps.priority = data.priority;
      propsChanged = true;
    }
    if (data.assignee_id !== undefined && data.assignee_id !== currentProps.assignee_id) {
      changes.push({ field: 'assignee_id', oldValue: currentProps.assignee_id || null, newValue: data.assignee_id });
      newProps.assignee_id = data.assignee_id;
      propsChanged = true;
    }
    if (data.estimate !== undefined && data.estimate !== currentProps.estimate) {
      changes.push({ field: 'estimate', oldValue: currentProps.estimate?.toString() || null, newValue: data.estimate?.toString() || null });
      newProps.estimate = data.estimate;
      propsChanged = true;
    }

    if (propsChanged) {
      updates.push(`properties = $${paramIndex++}`);
      values.push(JSON.stringify(newProps));
    }

    // Handle association updates (regular columns)
    if (data.program_id !== undefined && data.program_id !== existingIssue.program_id) {
      changes.push({ field: 'program_id', oldValue: existingIssue.program_id || null, newValue: data.program_id });
      updates.push(`program_id = $${paramIndex++}`);
      values.push(data.program_id);
      // Clear sprint if program changes (sprint belongs to program)
      if (data.sprint_id === undefined) {
        updates.push(`sprint_id = NULL`);
      }
    }
    if (data.sprint_id !== undefined && data.sprint_id !== existingIssue.sprint_id) {
      changes.push({ field: 'sprint_id', oldValue: existingIssue.sprint_id || null, newValue: data.sprint_id });
      updates.push(`sprint_id = $${paramIndex++}`);
      values.push(data.sprint_id);
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    // Log all changes to history
    for (const change of changes) {
      await logDocumentChange(id!, change.field, change.oldValue, change.newValue, req.user!.id!);
    }

    updates.push(`updated_at = now()`);

    const result = await pool.query(
      `UPDATE documents SET ${updates.join(', ')} WHERE id = $${paramIndex} AND workspace_id = $${paramIndex + 1} RETURNING *`,
      [...values, id, req.user!.workspaceId]
    );

    // Get program prefix for display_id
    const row = result.rows[0];
    let displayId = `#${row.ticket_number}`;
    let programPrefix = null;
    if (row.program_id) {
      const programResult = await pool.query(
        `SELECT properties->>'prefix' as prefix FROM documents WHERE id = $1 AND document_type = 'program'`,
        [row.program_id]
      );
      if (programResult.rows[0]) {
        programPrefix = programResult.rows[0].prefix;
        displayId = `${programPrefix}-${row.ticket_number}`;
      }
    }

    const issue = extractIssueFromRow({ ...row, program_prefix: programPrefix });
    res.json({ ...issue, display_id: displayId });
  } catch (err) {
    console.error('Update issue error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get issue history
router.get('/:id/history', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Verify issue exists and belongs to workspace
    const issueCheck = await pool.query(
      `SELECT id FROM documents WHERE id = $1 AND workspace_id = $2 AND document_type = 'issue'`,
      [id, req.user!.workspaceId]
    );

    if (issueCheck.rows.length === 0) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }

    const result = await pool.query(
      `SELECT h.id, h.field, h.old_value, h.new_value, h.created_at,
              u.id as changed_by_id, u.name as changed_by_name
       FROM document_history h
       LEFT JOIN users u ON h.changed_by = u.id
       WHERE h.document_id = $1
       ORDER BY h.created_at DESC`,
      [id]
    );

    res.json(result.rows.map(row => ({
      id: row.id,
      field: row.field,
      old_value: row.old_value,
      new_value: row.new_value,
      created_at: row.created_at,
      changed_by: row.changed_by_id ? {
        id: row.changed_by_id,
        name: row.changed_by_name,
      } : null,
    })));
  } catch (err) {
    console.error('Get issue history error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete issue
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `DELETE FROM documents WHERE id = $1 AND workspace_id = $2 AND document_type = 'issue' RETURNING id`,
      [id, req.user!.workspaceId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }

    res.status(204).send();
  } catch (err) {
    console.error('Delete issue error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
