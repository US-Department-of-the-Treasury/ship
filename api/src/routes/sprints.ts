import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../db/client.js';
import { z } from 'zod';

type RouterType = ReturnType<typeof Router>;
const router: RouterType = Router();

// Auth middleware
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
const createSprintSchema = z.object({
  program_id: z.string().uuid(),
  title: z.string().min(1).max(200).optional().default('Untitled'),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const updateSprintSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sprint_status: z.enum(['planned', 'active', 'completed']).optional(),
  goal: z.string().optional().nullable(),
});

// Get single sprint
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT d.id, d.title as name, d.start_date, d.end_date, d.sprint_status as status,
              d.program_id, d.goal, p.title as program_name, p.prefix as program_prefix,
              (SELECT COUNT(*) FROM documents i WHERE i.sprint_id = d.id AND i.document_type = 'issue') as issue_count,
              (SELECT COUNT(*) FROM documents i WHERE i.sprint_id = d.id AND i.document_type = 'issue' AND i.state = 'done') as completed_count
       FROM documents d
       JOIN documents p ON d.program_id = p.id
       WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'sprint'`,
      [id, req.user!.workspaceId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Sprint not found' });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get sprint error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create sprint (creates a document with document_type = 'sprint')
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = createSprintSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
      return;
    }

    const { program_id, title, start_date, end_date } = parsed.data;

    // Verify program belongs to workspace
    const programExists = await pool.query(
      `SELECT id FROM documents WHERE id = $1 AND workspace_id = $2 AND document_type = 'program'`,
      [program_id, req.user!.workspaceId]
    );

    if (programExists.rows.length === 0) {
      res.status(404).json({ error: 'Program not found' });
      return;
    }

    // Default dates if not provided
    const today = new Date().toISOString().split('T')[0]!;
    const twoWeeksLater = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]!;
    const finalStartDate = start_date ?? today;
    const finalEndDate = end_date ?? twoWeeksLater;

    // Validate dates
    if (new Date(finalEndDate) <= new Date(finalStartDate)) {
      res.status(400).json({ error: 'End date must be after start date' });
      return;
    }

    const result = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, program_id, start_date, end_date, sprint_status, created_by)
       VALUES ($1, 'sprint', $2, $3, $4, $5, 'planned', $6)
       RETURNING id, title as name, start_date, end_date, sprint_status as status, program_id`,
      [req.user!.workspaceId, title, program_id, finalStartDate, finalEndDate, req.user!.id]
    );

    res.status(201).json({ ...result.rows[0], issue_count: 0, completed_count: 0 });
  } catch (err) {
    console.error('Create sprint error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update sprint
router.patch('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const parsed = updateSprintSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
      return;
    }

    // Verify sprint exists and belongs to workspace
    const existing = await pool.query(
      `SELECT id, start_date, end_date FROM documents WHERE id = $1 AND workspace_id = $2 AND document_type = 'sprint'`,
      [id, req.user!.workspaceId]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Sprint not found' });
      return;
    }

    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    const data = parsed.data;
    let newStartDate = existing.rows[0].start_date;
    let newEndDate = existing.rows[0].end_date;

    if (data.title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      values.push(data.title);
    }
    if (data.start_date !== undefined) {
      updates.push(`start_date = $${paramIndex++}`);
      values.push(data.start_date);
      newStartDate = data.start_date;
    }
    if (data.end_date !== undefined) {
      updates.push(`end_date = $${paramIndex++}`);
      values.push(data.end_date);
      newEndDate = data.end_date;
    }
    if (data.sprint_status !== undefined) {
      updates.push(`sprint_status = $${paramIndex++}`);
      values.push(data.sprint_status);
    }
    if (data.goal !== undefined) {
      updates.push(`goal = $${paramIndex++}`);
      values.push(data.goal);
    }

    // Validate dates if either changed
    if (new Date(newEndDate) <= new Date(newStartDate)) {
      res.status(400).json({ error: 'End date must be after start date' });
      return;
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    updates.push(`updated_at = now()`);

    const result = await pool.query(
      `UPDATE documents SET ${updates.join(', ')}
       WHERE id = $${paramIndex} AND workspace_id = $${paramIndex + 1} AND document_type = 'sprint'
       RETURNING id, title as name, start_date, end_date, sprint_status as status, program_id, goal`,
      [...values, id, req.user!.workspaceId]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update sprint error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete sprint
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Verify sprint exists and belongs to workspace
    const existing = await pool.query(
      `SELECT id FROM documents WHERE id = $1 AND workspace_id = $2 AND document_type = 'sprint'`,
      [id, req.user!.workspaceId]
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
router.get('/:id/issues', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Verify sprint exists and get program info
    const sprintResult = await pool.query(
      `SELECT d.id, p.prefix FROM documents d
       JOIN documents p ON d.program_id = p.id
       WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'sprint'`,
      [id, req.user!.workspaceId]
    );

    if (sprintResult.rows.length === 0) {
      res.status(404).json({ error: 'Sprint not found' });
      return;
    }

    const prefix = sprintResult.rows[0].prefix;

    const result = await pool.query(
      `SELECT d.id, d.title, d.state, d.priority, d.assignee_id, d.ticket_number,
              d.created_at, d.updated_at, d.created_by,
              u.name as assignee_name
       FROM documents d
       LEFT JOIN users u ON d.assignee_id = u.id
       WHERE d.sprint_id = $1 AND d.document_type = 'issue'
       ORDER BY
         CASE d.priority
           WHEN 'urgent' THEN 1
           WHEN 'high' THEN 2
           WHEN 'medium' THEN 3
           WHEN 'low' THEN 4
           ELSE 5
         END,
         d.updated_at DESC`,
      [id]
    );

    const issues = result.rows.map(issue => ({
      ...issue,
      display_id: `${prefix}-${issue.ticket_number}`
    }));

    res.json(issues);
  } catch (err) {
    console.error('Get sprint issues error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
