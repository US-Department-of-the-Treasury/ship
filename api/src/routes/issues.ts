import { Router, Request, Response } from 'express';
import { pool } from '../db/client.js';
import { z } from 'zod';
import { getVisibilityContext, VISIBILITY_FILTER_SQL } from '../middleware/visibility.js';
import { authMiddleware } from '../middleware/auth.js';

type RouterType = ReturnType<typeof Router>;
const router: RouterType = Router();

// Validation schemas
const createIssueSchema = z.object({
  title: z.string().min(1).max(500),
  state: z.enum(['triage', 'backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled']).optional().default('backlog'),
  priority: z.enum(['urgent', 'high', 'medium', 'low', 'none']).optional().default('medium'),
  assignee_id: z.string().uuid().optional().nullable(),
  program_id: z.string().uuid().optional().nullable(),
  sprint_id: z.string().uuid().optional().nullable(),
});

const updateIssueSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  state: z.enum(['triage', 'backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled']).optional(),
  priority: z.enum(['urgent', 'high', 'medium', 'low', 'none']).optional(),
  assignee_id: z.string().uuid().optional().nullable(),
  program_id: z.string().uuid().optional().nullable(),
  sprint_id: z.string().uuid().optional().nullable(),
  estimate: z.number().positive().nullable().optional(),
  // Claude Code integration metadata
  claude_metadata: z.object({
    updated_by: z.literal('claude'),
    story_id: z.string().optional(),
    prd_name: z.string().optional(),
    session_context: z.string().optional(),
    // Telemetry for completed stories
    telemetry: z.object({
      iterations: z.number().int().min(1).optional(),
      feedback_loops: z.object({
        type_check: z.number().int().min(0).optional(),
        test: z.number().int().min(0).optional(),
        build: z.number().int().min(0).optional(),
      }).optional(),
      time_elapsed_seconds: z.number().int().min(0).optional(),
      files_changed: z.array(z.string()).optional(),
    }).optional(),
  }).optional(),
});

const rejectIssueSchema = z.object({
  reason: z.string().min(1).max(1000),
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
  changedBy: string,
  automatedBy?: string
) {
  await pool.query(
    `INSERT INTO document_history (document_id, field, old_value, new_value, changed_by, automated_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [documentId, field, oldValue, newValue, changedBy, automatedBy ?? null]
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
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { state, priority, assignee_id, program_id, sprint_id, source } = req.query;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

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
        AND ${VISIBILITY_FILTER_SQL('d', '$2', '$3')}
    `;
    const params: (string | boolean | null)[] = [workspaceId, userId, isAdmin];

    // Exclude archived and deleted issues by default
    query += ` AND d.archived_at IS NULL AND d.deleted_at IS NULL`;

    // Filter by source if specified (internal or external)
    if (source) {
      query += ` AND d.properties->>'source' = $${params.length + 1}`;
      params.push(source as string);
    }
    // No default filtering - show all issues regardless of source

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
        display_id: `#${issue.ticket_number}`
      };
    });

    res.json(issues);
  } catch (err) {
    console.error('List issues error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single issue
router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

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
       WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'issue'
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }

    const issue = extractIssueFromRow(result.rows[0]);
    res.json({
      ...issue,
      display_id: `#${issue.ticket_number}`
    });
  } catch (err) {
    console.error('Get issue error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create issue
// Uses advisory lock to prevent race condition in ticket number generation
router.post('/', authMiddleware, async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const parsed = createIssueSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
      return;
    }

    const { title, state, priority, assignee_id, program_id, sprint_id } = parsed.data;

    await client.query('BEGIN');

    // Use advisory lock to serialize ticket number generation per workspace
    // This prevents race conditions where concurrent requests get the same MAX value
    // The lock key is derived from workspace_id (first 15 hex chars as bigint)
    const workspaceIdHex = req.workspaceId!.replace(/-/g, '').substring(0, 15);
    const lockKey = parseInt(workspaceIdHex, 16);
    await client.query('SELECT pg_advisory_xact_lock($1)', [lockKey]);

    // Now safely get next ticket number - we hold the lock until transaction ends
    const ticketResult = await client.query(
      `SELECT COALESCE(MAX(ticket_number), 0) + 1 as next_number
       FROM documents
       WHERE workspace_id = $1 AND document_type = 'issue'`,
      [req.workspaceId]
    );
    const ticketNumber = ticketResult.rows[0].next_number;

    // Build properties JSONB
    const properties = {
      state: state || 'backlog',
      priority: priority || 'medium',
      source: 'internal',
      assignee_id: assignee_id || null,
      rejection_reason: null,
    };

    const result = await client.query(
      `INSERT INTO documents (workspace_id, document_type, title, properties, program_id, sprint_id, ticket_number, created_by)
       VALUES ($1, 'issue', $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [req.workspaceId, title, JSON.stringify(properties), program_id || null, sprint_id || null, ticketNumber, req.userId]
    );

    // Get program prefix if assigned
    let displayId = `#${ticketNumber}`;
    let programPrefix = null;
    if (program_id) {
      const programResult = await client.query(
        `SELECT properties->>'prefix' as prefix FROM documents WHERE id = $1 AND document_type = 'program'`,
        [program_id]
      );
      if (programResult.rows[0]) {
        programPrefix = programResult.rows[0].prefix;
        displayId = `${programPrefix}-${ticketNumber}`;
      }
    }

    await client.query('COMMIT');

    const row = result.rows[0];
    const issue = extractIssueFromRow({ ...row, program_prefix: programPrefix });
    res.status(201).json({ ...issue, display_id: displayId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create issue error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Update issue
router.patch('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    const parsed = updateIssueSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
      return;
    }

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Get full existing issue for history tracking (with visibility check)
    const existing = await pool.query(
      `SELECT id, title, properties, program_id, sprint_id
       FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'issue'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
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

    // Store Claude metadata in properties for attribution tracking
    if (data.claude_metadata) {
      newProps.claude_metadata = {
        ...data.claude_metadata,
        updated_at: new Date().toISOString(),
      };
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

      // Track carryover when moving from a completed sprint while issue is not done
      if (existingIssue.sprint_id && data.sprint_id && currentProps.state !== 'done') {
        // Check if the old sprint is completed (based on end date)
        const oldSprintResult = await pool.query(
          `SELECT properties->>'sprint_number' as sprint_number, w.sprint_start_date
           FROM documents d
           JOIN workspaces w ON d.workspace_id = w.id
           WHERE d.id = $1 AND d.document_type = 'sprint'`,
          [existingIssue.sprint_id]
        );

        if (oldSprintResult.rows[0]) {
          const sprintNumber = parseInt(oldSprintResult.rows[0].sprint_number, 10);
          const rawStartDate = oldSprintResult.rows[0].sprint_start_date;
          const sprintDuration = 14;

          let startDate: Date;
          if (rawStartDate instanceof Date) {
            startDate = new Date(Date.UTC(rawStartDate.getFullYear(), rawStartDate.getMonth(), rawStartDate.getDate()));
          } else if (typeof rawStartDate === 'string') {
            startDate = new Date(rawStartDate + 'T00:00:00Z');
          } else {
            startDate = new Date();
          }

          // Calculate sprint end date
          const sprintEndDate = new Date(startDate);
          sprintEndDate.setUTCDate(sprintEndDate.getUTCDate() + (sprintNumber * sprintDuration) - 1);

          // If the old sprint has ended, mark this as a carryover
          if (new Date() > sprintEndDate) {
            newProps.carryover_from_sprint_id = existingIssue.sprint_id;
            propsChanged = true;
          }
        }
      } else if (data.sprint_id === null) {
        // Removing from sprint clears carryover
        delete newProps.carryover_from_sprint_id;
        propsChanged = true;
      }
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    // Log all changes to history
    const automatedBy = data.claude_metadata?.updated_by;
    for (const change of changes) {
      await logDocumentChange(id!, change.field, change.oldValue, change.newValue, req.userId!, automatedBy);
    }

    updates.push(`updated_at = now()`);

    const result = await pool.query(
      `UPDATE documents SET ${updates.join(', ')} WHERE id = $${paramIndex} AND workspace_id = $${paramIndex + 1} RETURNING *`,
      [...values, id, req.workspaceId]
    );

    const row = result.rows[0];
    const displayId = `#${row.ticket_number}`;

    const issue = extractIssueFromRow(row);
    res.json({ ...issue, display_id: displayId });
  } catch (err) {
    console.error('Update issue error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get issue history
router.get('/:id/history', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify issue exists and user can access it
    const issueCheck = await pool.query(
      `SELECT id FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'issue'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (issueCheck.rows.length === 0) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }

    const result = await pool.query(
      `SELECT h.id, h.field, h.old_value, h.new_value, h.created_at, h.automated_by,
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
      automated_by: row.automated_by,
    })));
  } catch (err) {
    console.error('Get issue history error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Bulk update issues
const bulkUpdateSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
  action: z.enum(['archive', 'delete', 'restore', 'update']),
  updates: z.object({
    state: z.enum(['triage', 'backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled']).optional(),
    sprint_id: z.string().uuid().nullable().optional(),
  }).optional(),
});

router.post('/bulk', authMiddleware, async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const parsed = bulkUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
      return;
    }

    const { ids, action, updates } = parsed.data;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Get visibility context
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    await client.query('BEGIN');

    // Verify all issues exist and user has access
    const accessCheck = await client.query(
      `SELECT id FROM documents
       WHERE id = ANY($1) AND workspace_id = $2 AND document_type = 'issue'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [ids, workspaceId, userId, isAdmin]
    );

    const accessibleIds = new Set(accessCheck.rows.map(r => r.id));
    const failed: { id: string; error: string }[] = [];

    for (const id of ids) {
      if (!accessibleIds.has(id)) {
        failed.push({ id, error: 'Not found or no access' });
      }
    }

    const validIds = ids.filter(id => accessibleIds.has(id));

    if (validIds.length === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'No valid issues found', failed });
      return;
    }

    let result;

    switch (action) {
      case 'archive':
        result = await client.query(
          `UPDATE documents SET archived_at = NOW(), updated_at = NOW()
           WHERE id = ANY($1) AND workspace_id = $2
           RETURNING *`,
          [validIds, workspaceId]
        );
        break;

      case 'delete':
        result = await client.query(
          `UPDATE documents SET deleted_at = NOW(), updated_at = NOW()
           WHERE id = ANY($1) AND workspace_id = $2
           RETURNING *`,
          [validIds, workspaceId]
        );
        break;

      case 'restore':
        result = await client.query(
          `UPDATE documents SET archived_at = NULL, deleted_at = NULL, updated_at = NOW()
           WHERE id = ANY($1) AND workspace_id = $2
           RETURNING *`,
          [validIds, workspaceId]
        );
        break;

      case 'update':
        if (!updates || Object.keys(updates).length === 0) {
          await client.query('ROLLBACK');
          res.status(400).json({ error: 'Updates required for update action' });
          return;
        }

        const setClauses: string[] = ['updated_at = NOW()'];
        const values: any[] = [validIds, workspaceId];
        let paramIdx = 3;

        if (updates.state !== undefined) {
          // Update state in properties JSONB
          setClauses.push(`properties = jsonb_set(COALESCE(properties, '{}'), '{state}', $${paramIdx}::jsonb)`);
          values.push(JSON.stringify(updates.state));
          paramIdx++;
        }

        if (updates.sprint_id !== undefined) {
          setClauses.push(`sprint_id = $${paramIdx}`);
          values.push(updates.sprint_id);
          paramIdx++;
        }

        result = await client.query(
          `UPDATE documents SET ${setClauses.join(', ')}
           WHERE id = ANY($1) AND workspace_id = $2
           RETURNING *`,
          values
        );
        break;

      default:
        await client.query('ROLLBACK');
        res.status(400).json({ error: 'Invalid action' });
        return;
    }

    await client.query('COMMIT');

    // Map results to issue format
    const updated = result.rows.map(row => {
      const issue = extractIssueFromRow(row);
      return {
        ...issue,
        display_id: `#${issue.ticket_number}`,
        archived_at: row.archived_at,
        deleted_at: row.deleted_at,
      };
    });

    res.json({ updated, failed });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Bulk update issues error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Delete issue
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // First verify user can access the issue
    const accessCheck = await pool.query(
      `SELECT id FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'issue'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (accessCheck.rows.length === 0) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }

    // Now delete it
    await pool.query(
      'DELETE FROM documents WHERE id = $1 AND workspace_id = $2 AND document_type = \'issue\'',
      [id, workspaceId]
    );

    res.status(204).send();
  } catch (err) {
    console.error('Delete issue error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Accept issue (move from triage to backlog)
router.post('/:id/accept', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Get visibility context
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Get the issue
    const existing = await pool.query(
      `SELECT id, properties FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'issue'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }

    const props = existing.rows[0].properties || {};

    // Verify the issue is in triage state
    if (props.state !== 'triage') {
      res.status(400).json({ error: 'Issue must be in triage state to be accepted' });
      return;
    }

    // Update state to backlog
    const newProps = { ...props, state: 'backlog' };
    const result = await pool.query(
      `UPDATE documents
       SET properties = $3, updated_at = now()
       WHERE id = $1 AND workspace_id = $2
       RETURNING *`,
      [id, workspaceId, JSON.stringify(newProps)]
    );

    // Log the state change
    await logDocumentChange(id!, 'state', 'triage', 'backlog', req.userId!);

    const issue = extractIssueFromRow(result.rows[0]);
    res.json({ ...issue, display_id: `#${issue.ticket_number}` });
  } catch (err) {
    console.error('Accept issue error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Reject issue (move from triage to cancelled with reason)
router.post('/:id/reject', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    const parsed = rejectIssueSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Rejection reason is required' });
      return;
    }

    const { reason } = parsed.data;

    // Get visibility context
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Get the issue
    const existing = await pool.query(
      `SELECT id, properties FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'issue'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }

    const props = existing.rows[0].properties || {};

    // Verify the issue is in triage state
    if (props.state !== 'triage') {
      res.status(400).json({ error: 'Issue must be in triage state to be rejected' });
      return;
    }

    // Update state to cancelled and store rejection reason
    const newProps = { ...props, state: 'cancelled', rejection_reason: reason };
    const result = await pool.query(
      `UPDATE documents
       SET properties = $3, cancelled_at = NOW(), updated_at = now()
       WHERE id = $1 AND workspace_id = $2
       RETURNING *`,
      [id, workspaceId, JSON.stringify(newProps)]
    );

    // Log the state change
    await logDocumentChange(id!, 'state', 'triage', 'cancelled', req.userId!);

    const issue = extractIssueFromRow(result.rows[0]);
    res.json({ ...issue, display_id: `#${issue.ticket_number}` });
  } catch (err) {
    console.error('Reject issue error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
