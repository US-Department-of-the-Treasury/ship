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

// Helper to extract sprint from row
function extractSprintFromRow(row: any) {
  const props = row.properties || {};
  return {
    id: row.id,
    name: row.title,
    start_date: props.start_date || null,
    end_date: props.end_date || null,
    status: props.sprint_status || 'planned',
    goal: props.goal || null,
    program_id: row.program_id,
    program_name: row.program_name,
    program_prefix: row.program_prefix,
    issue_count: row.issue_count,
    completed_count: row.completed_count,
  };
}

// Get single sprint
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT d.id, d.title, d.properties, d.program_id,
              p.title as program_name, p.properties->>'prefix' as program_prefix,
              (SELECT COUNT(*) FROM documents i WHERE i.sprint_id = d.id AND i.document_type = 'issue') as issue_count,
              (SELECT COUNT(*) FROM documents i WHERE i.sprint_id = d.id AND i.document_type = 'issue' AND i.properties->>'state' = 'done') as completed_count
       FROM documents d
       JOIN documents p ON d.program_id = p.id
       WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'sprint'`,
      [id, req.user!.workspaceId]
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

    // Build properties JSONB
    const properties = {
      start_date: finalStartDate,
      end_date: finalEndDate,
      sprint_status: 'planned',
      goal: null,
    };

    const result = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, program_id, properties, created_by)
       VALUES ($1, 'sprint', $2, $3, $4, $5)
       RETURNING id, title, properties, program_id`,
      [req.user!.workspaceId, title, program_id, JSON.stringify(properties), req.user!.id]
    );

    const sprint = extractSprintFromRow(result.rows[0]);
    res.status(201).json({ ...sprint, issue_count: 0, completed_count: 0 });
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
      `SELECT id, properties FROM documents WHERE id = $1 AND workspace_id = $2 AND document_type = 'sprint'`,
      [id, req.user!.workspaceId]
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

    // Handle properties updates
    const newProps = { ...currentProps };
    let propsChanged = false;

    let newStartDate = currentProps.start_date;
    let newEndDate = currentProps.end_date;

    if (data.start_date !== undefined) {
      newProps.start_date = data.start_date;
      newStartDate = data.start_date;
      propsChanged = true;
    }
    if (data.end_date !== undefined) {
      newProps.end_date = data.end_date;
      newEndDate = data.end_date;
      propsChanged = true;
    }
    if (data.sprint_status !== undefined) {
      newProps.sprint_status = data.sprint_status;
      propsChanged = true;
    }
    if (data.goal !== undefined) {
      newProps.goal = data.goal;
      propsChanged = true;
    }

    // Validate dates if either changed
    if (newStartDate && newEndDate && new Date(newEndDate) <= new Date(newStartDate)) {
      res.status(400).json({ error: 'End date must be after start date' });
      return;
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

    const result = await pool.query(
      `UPDATE documents SET ${updates.join(', ')}
       WHERE id = $${paramIndex} AND workspace_id = $${paramIndex + 1} AND document_type = 'sprint'
       RETURNING id, title, properties, program_id`,
      [...values, id, req.user!.workspaceId]
    );

    res.json(extractSprintFromRow(result.rows[0]));
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
      `SELECT d.id, p.properties->>'prefix' as prefix FROM documents d
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
      `SELECT d.id, d.title, d.properties, d.ticket_number,
              d.created_at, d.updated_at, d.created_by,
              u.name as assignee_name
       FROM documents d
       LEFT JOIN users u ON (d.properties->>'assignee_id')::uuid = u.id
       WHERE d.sprint_id = $1 AND d.document_type = 'issue'
       ORDER BY
         CASE d.properties->>'priority'
           WHEN 'urgent' THEN 1
           WHEN 'high' THEN 2
           WHEN 'medium' THEN 3
           WHEN 'low' THEN 4
           ELSE 5
         END,
         d.updated_at DESC`,
      [id]
    );

    const issues = result.rows.map(row => {
      const props = row.properties || {};
      return {
        id: row.id,
        title: row.title,
        state: props.state || 'backlog',
        priority: props.priority || 'medium',
        assignee_id: props.assignee_id || null,
        ticket_number: row.ticket_number,
        created_at: row.created_at,
        updated_at: row.updated_at,
        created_by: row.created_by,
        assignee_name: row.assignee_name,
        display_id: `${prefix}-${row.ticket_number}`
      };
    });

    res.json(issues);
  } catch (err) {
    console.error('Get sprint issues error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
