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
      `SELECT s.*, u.id as user_id, u.email, u.name, u.workspace_id
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
  project_id: z.string().uuid().optional().nullable(),
  sprint_id: z.string().uuid().optional().nullable(),
});

const updateIssueSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  state: z.enum(['backlog', 'todo', 'in_progress', 'done', 'cancelled']).optional(),
  priority: z.enum(['urgent', 'high', 'medium', 'low', 'none']).optional(),
  assignee_id: z.string().uuid().optional().nullable(),
  project_id: z.string().uuid().optional().nullable(),
  sprint_id: z.string().uuid().optional().nullable(),
});

// List issues with filters
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { state, priority, assignee_id, project_id, sprint_id } = req.query;
    let query = `
      SELECT d.id, d.title, d.state, d.priority, d.assignee_id, d.ticket_number,
             d.project_id, d.sprint_id,
             d.created_at, d.updated_at, d.created_by,
             u.name as assignee_name,
             p.title as project_name, p.prefix as project_prefix, p.color as project_color
      FROM documents d
      LEFT JOIN users u ON d.assignee_id = u.id
      LEFT JOIN documents p ON d.project_id = p.id AND p.document_type = 'project'
      WHERE d.workspace_id = $1 AND d.document_type = 'issue'
    `;
    const params: (string | null)[] = [req.user!.workspaceId];

    if (state) {
      const states = (state as string).split(',');
      query += ` AND d.state = ANY($${params.length + 1})`;
      params.push(states as any);
    }

    if (priority) {
      query += ` AND d.priority = $${params.length + 1}`;
      params.push(priority as string);
    }

    if (assignee_id) {
      if (assignee_id === 'null' || assignee_id === 'unassigned') {
        query += ` AND d.assignee_id IS NULL`;
      } else {
        query += ` AND d.assignee_id = $${params.length + 1}`;
        params.push(assignee_id as string);
      }
    }

    if (project_id) {
      query += ` AND d.project_id = $${params.length + 1}`;
      params.push(project_id as string);
    }

    if (sprint_id) {
      query += ` AND d.sprint_id = $${params.length + 1}`;
      params.push(sprint_id as string);
    }

    query += ` ORDER BY
      CASE d.priority
        WHEN 'urgent' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 4
        ELSE 5
      END,
      d.updated_at DESC`;

    const result = await pool.query(query, params);

    // Add display_id to each issue
    const issues = result.rows.map(issue => ({
      ...issue,
      display_id: issue.project_prefix
        ? `${issue.project_prefix}-${issue.ticket_number}`
        : `#${issue.ticket_number}`
    }));

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
      `SELECT d.*, u.name as assignee_name,
              p.title as project_name, p.prefix as project_prefix, p.color as project_color,
              s.title as sprint_name
       FROM documents d
       LEFT JOIN users u ON d.assignee_id = u.id
       LEFT JOIN documents p ON d.project_id = p.id AND p.document_type = 'project'
       LEFT JOIN documents s ON d.sprint_id = s.id AND s.document_type = 'sprint'
       WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'issue'`,
      [id, req.user!.workspaceId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }

    const issue = result.rows[0];
    res.json({
      ...issue,
      display_id: issue.project_prefix
        ? `${issue.project_prefix}-${issue.ticket_number}`
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

    const { title, state, priority, assignee_id, project_id, sprint_id } = parsed.data;

    // Get next ticket number for workspace
    const ticketResult = await pool.query(
      `SELECT COALESCE(MAX(ticket_number), 0) + 1 as next_number
       FROM documents
       WHERE workspace_id = $1 AND document_type = 'issue'`,
      [req.user!.workspaceId]
    );
    const ticketNumber = ticketResult.rows[0].next_number;

    const result = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, state, priority, assignee_id, project_id, sprint_id, ticket_number, created_by)
       VALUES ($1, 'issue', $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [req.user!.workspaceId, title, state, priority, assignee_id || null, project_id || null, sprint_id || null, ticketNumber, req.user!.id]
    );

    // Get project prefix if assigned
    let displayId = `#${ticketNumber}`;
    if (project_id) {
      const projectResult = await pool.query(
        `SELECT prefix FROM documents WHERE id = $1 AND document_type = 'project'`,
        [project_id]
      );
      if (projectResult.rows[0]) {
        displayId = `${projectResult.rows[0].prefix}-${ticketNumber}`;
      }
    }

    res.status(201).json({ ...result.rows[0], display_id: displayId });
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
      `SELECT id FROM documents WHERE id = $1 AND workspace_id = $2 AND document_type = 'issue'`,
      [id, req.user!.workspaceId]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }

    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    const data = parsed.data;
    if (data.title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      values.push(data.title);
    }
    if (data.state !== undefined) {
      updates.push(`state = $${paramIndex++}`);
      values.push(data.state);
    }
    if (data.priority !== undefined) {
      updates.push(`priority = $${paramIndex++}`);
      values.push(data.priority);
    }
    if (data.assignee_id !== undefined) {
      updates.push(`assignee_id = $${paramIndex++}`);
      values.push(data.assignee_id);
    }
    if (data.project_id !== undefined) {
      updates.push(`project_id = $${paramIndex++}`);
      values.push(data.project_id);
      // Clear sprint if project changes (sprint belongs to project)
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

    // Get project prefix for display_id
    const issue = result.rows[0];
    let displayId = `#${issue.ticket_number}`;
    if (issue.project_id) {
      const projectResult = await pool.query(
        `SELECT prefix FROM documents WHERE id = $1 AND document_type = 'project'`,
        [issue.project_id]
      );
      if (projectResult.rows[0]) {
        displayId = `${projectResult.rows[0].prefix}-${issue.ticket_number}`;
      }
    }

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
