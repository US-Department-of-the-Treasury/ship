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
const createDocumentSchema = z.object({
  title: z.string().min(1).max(255).optional().default('Untitled'),
  document_type: z.enum(['wiki', 'issue', 'program', 'project', 'sprint', 'person', 'sprint_plan', 'sprint_retro']).optional().default('wiki'),
  parent_id: z.string().uuid().optional().nullable(),
  sprint_id: z.string().uuid().optional().nullable(),
  properties: z.record(z.unknown()).optional(),
});

const updateDocumentSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  content: z.any().optional(),
  parent_id: z.string().uuid().optional().nullable(),
  position: z.number().int().min(0).optional(),
  properties: z.record(z.unknown()).optional(),
});

// List documents
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { type, parent_id } = req.query;
    let query = `
      SELECT id, workspace_id, document_type, title, parent_id, position,
             program_id, project_id, sprint_id, ticket_number, properties,
             created_at, updated_at, created_by
      FROM documents
      WHERE workspace_id = $1
    `;
    const params: (string | null)[] = [req.user!.workspaceId];

    if (type) {
      query += ` AND document_type = $${params.length + 1}`;
      params.push(type as string);
    }

    if (parent_id !== undefined) {
      if (parent_id === 'null' || parent_id === '') {
        query += ` AND parent_id IS NULL`;
      } else {
        query += ` AND parent_id = $${params.length + 1}`;
        params.push(parent_id as string);
      }
    }

    query += ` ORDER BY position ASC, created_at DESC`;

    const result = await pool.query(query, params);

    // Extract properties into flat fields for backwards compatibility
    const documents = result.rows.map(row => {
      const props = row.properties || {};
      return {
        ...row,
        // Flatten common properties for backwards compatibility
        state: props.state,
        priority: props.priority,
        assignee_id: props.assignee_id,
        source: props.source,
        prefix: props.prefix,
        color: props.color,
      };
    });

    res.json(documents);
  } catch (err) {
    console.error('List documents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single document
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT * FROM documents WHERE id = $1 AND workspace_id = $2`,
      [id, req.user!.workspaceId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    const row = result.rows[0];
    const props = row.properties || {};

    // Return with flattened properties for backwards compatibility
    res.json({
      ...row,
      state: props.state,
      priority: props.priority,
      assignee_id: props.assignee_id,
      source: props.source,
      prefix: props.prefix,
      color: props.color,
      start_date: props.start_date,
      end_date: props.end_date,
      sprint_status: props.sprint_status,
      goal: props.goal,
    });
  } catch (err) {
    console.error('Get document error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create document
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = createDocumentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
      return;
    }

    const { title, document_type, parent_id, sprint_id, properties } = parsed.data;

    const result = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, parent_id, sprint_id, properties, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [req.user!.workspaceId, document_type, title, parent_id || null, sprint_id || null, JSON.stringify(properties || {}), req.user!.id]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create document error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update document
router.patch('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const parsed = updateDocumentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
      return;
    }

    // Verify document exists and belongs to workspace
    const existing = await pool.query(
      'SELECT id, properties FROM documents WHERE id = $1 AND workspace_id = $2',
      [id, req.user!.workspaceId]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Document not found' });
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
    if (data.content !== undefined) {
      updates.push(`content = $${paramIndex++}`);
      values.push(JSON.stringify(data.content));
    }
    if (data.parent_id !== undefined) {
      updates.push(`parent_id = $${paramIndex++}`);
      values.push(data.parent_id);
    }
    if (data.position !== undefined) {
      updates.push(`position = $${paramIndex++}`);
      values.push(data.position);
    }
    if (data.properties !== undefined) {
      // Merge with existing properties
      const currentProps = existing.rows[0].properties || {};
      const newProps = { ...currentProps, ...data.properties };
      updates.push(`properties = $${paramIndex++}`);
      values.push(JSON.stringify(newProps));
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

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update document error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete document
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM documents WHERE id = $1 AND workspace_id = $2 RETURNING id',
      [id, req.user!.workspaceId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    res.status(204).send();
  } catch (err) {
    console.error('Delete document error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

// Type augmentation for Express Request
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        name: string;
        workspaceId: string;
      };
    }
  }
}
