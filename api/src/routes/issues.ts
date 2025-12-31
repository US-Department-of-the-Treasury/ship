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
});

// Helper to extract issue properties from row
function extractIssueFromRow(row: any) {
  const props = row.properties || {};
  return {
    id: row.id,
    title: row.title,
    state: props.state || 'backlog',
    priority: props.priority || 'medium',
    assignee_id: props.assignee_id || null,
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

    // Verify issue exists and belongs to workspace
    const existing = await pool.query(
      `SELECT id, properties FROM documents WHERE id = $1 AND workspace_id = $2 AND document_type = 'issue'`,
      [id, req.user!.workspaceId]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Issue not found' });
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

    // Handle properties updates
    const newProps = { ...currentProps };
    let propsChanged = false;

    if (data.state !== undefined) {
      newProps.state = data.state;
      propsChanged = true;
    }
    if (data.priority !== undefined) {
      newProps.priority = data.priority;
      propsChanged = true;
    }
    if (data.assignee_id !== undefined) {
      newProps.assignee_id = data.assignee_id;
      propsChanged = true;
    }

    if (propsChanged) {
      updates.push(`properties = $${paramIndex++}`);
      values.push(JSON.stringify(newProps));
    }

    // Handle association updates (regular columns)
    if (data.program_id !== undefined) {
      updates.push(`program_id = $${paramIndex++}`);
      values.push(data.program_id);
      // Clear sprint if program changes (sprint belongs to program)
      if (data.sprint_id === undefined) {
        updates.push(`sprint_id = NULL`);
      }
    }
    if (data.sprint_id !== undefined) {
      updates.push(`sprint_id = $${paramIndex++}`);
      values.push(data.sprint_id);
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
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
