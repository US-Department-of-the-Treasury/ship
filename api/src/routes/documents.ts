import { Router, Request, Response } from 'express';
import { pool } from '../db/client.js';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { handleVisibilityChange } from '../collaboration/index.js';

type RouterType = ReturnType<typeof Router>;
const router: RouterType = Router();

// Check if user is workspace admin
async function isWorkspaceAdmin(userId: string, workspaceId: string): Promise<boolean> {
  const result = await pool.query(
    'SELECT role FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
    [workspaceId, userId]
  );
  return result.rows[0]?.role === 'admin';
}

// Check if user can access a document (visibility check)
async function canAccessDocument(
  docId: string,
  userId: string,
  workspaceId: string
): Promise<{ canAccess: boolean; doc: any | null }> {
  const result = await pool.query(
    `SELECT d.*,
            (d.visibility = 'workspace' OR d.created_by = $2 OR
             (SELECT role FROM workspace_memberships WHERE workspace_id = $3 AND user_id = $2) = 'admin') as can_access
     FROM documents d
     WHERE d.id = $1 AND d.workspace_id = $3`,
    [docId, userId, workspaceId]
  );

  if (result.rows.length === 0) {
    return { canAccess: false, doc: null };
  }

  return { canAccess: result.rows[0].can_access, doc: result.rows[0] };
}

// Validation schemas
const createDocumentSchema = z.object({
  title: z.string().min(1).max(255).optional().default('Untitled'),
  document_type: z.enum(['wiki', 'issue', 'program', 'project', 'sprint', 'person', 'sprint_plan', 'sprint_retro']).optional().default('wiki'),
  parent_id: z.string().uuid().optional().nullable(),
  program_id: z.string().uuid().optional().nullable(),
  sprint_id: z.string().uuid().optional().nullable(),
  properties: z.record(z.unknown()).optional(),
  visibility: z.enum(['private', 'workspace']).optional(),
  content: z.any().optional(),
});

const updateDocumentSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  content: z.any().optional(),
  parent_id: z.string().uuid().optional().nullable(),
  position: z.number().int().min(0).optional(),
  properties: z.record(z.unknown()).optional(),
  visibility: z.enum(['private', 'workspace']).optional(),
});

// List documents
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { type, parent_id } = req.query;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Check if user is admin (admins can see all documents)
    const isAdmin = await isWorkspaceAdmin(userId, workspaceId);

    let query = `
      SELECT id, workspace_id, document_type, title, parent_id, position,
             program_id, project_id, sprint_id, ticket_number, properties,
             created_at, updated_at, created_by, visibility
      FROM documents
      WHERE workspace_id = $1
        AND archived_at IS NULL
        AND (visibility = 'workspace' OR created_by = $2 OR $3 = TRUE)
    `;
    const params: (string | boolean | null)[] = [workspaceId, userId, isAdmin];

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
router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const userId = String(req.userId);
    const workspaceId = String(req.workspaceId);

    const { canAccess, doc } = await canAccessDocument(id, userId, workspaceId);

    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    if (!canAccess) {
      // Return 404 for private docs user can't access (to not reveal existence)
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    const props = doc.properties || {};

    // Return with flattened properties for backwards compatibility
    res.json({
      ...doc,
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
router.post('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const parsed = createDocumentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
      return;
    }

    const { title, document_type, parent_id, program_id, sprint_id, properties, content } = parsed.data;
    let { visibility } = parsed.data;

    // If parent_id is provided and visibility is not specified, inherit from parent
    if (parent_id && !visibility) {
      const parentResult = await pool.query(
        'SELECT visibility FROM documents WHERE id = $1 AND workspace_id = $2',
        [parent_id, req.workspaceId]
      );
      if (parentResult.rows[0]) {
        visibility = parentResult.rows[0].visibility;
      }
    }

    // Default to 'workspace' visibility if not specified
    visibility = visibility || 'workspace';

    const result = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, parent_id, program_id, sprint_id, properties, created_by, visibility, content)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [req.workspaceId, document_type, title, parent_id || null, program_id || null, sprint_id || null, JSON.stringify(properties || {}), req.userId, visibility, content ? JSON.stringify(content) : null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create document error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update document
router.patch('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const userId = String(req.userId);
    const workspaceId = String(req.workspaceId);

    const parsed = updateDocumentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
      return;
    }

    // Verify document exists and user can access it
    const { canAccess, doc: existing } = await canAccessDocument(id, userId, workspaceId);

    if (!existing) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    if (!canAccess) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    const data = parsed.data;

    // Check permission for visibility changes
    if (data.visibility !== undefined && data.visibility !== existing.visibility) {
      const isCreator = existing.created_by === userId;
      const isAdmin = await isWorkspaceAdmin(userId, workspaceId);

      if (!isCreator && !isAdmin) {
        res.status(403).json({ error: 'Only the creator or admin can change document visibility' });
        return;
      }
    }

    // Handle moving private doc to workspace parent (changes visibility to workspace)
    if (data.parent_id !== undefined && data.parent_id !== null && data.visibility === undefined) {
      const parentResult = await pool.query(
        'SELECT visibility FROM documents WHERE id = $1 AND workspace_id = $2',
        [data.parent_id, workspaceId]
      );
      if (parentResult.rows[0]?.visibility === 'workspace' && existing.visibility === 'private') {
        // Moving private doc under workspace parent makes it workspace-visible
        data.visibility = 'workspace';
      }
    }

    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

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
      const currentProps = existing.properties || {};
      const newProps = { ...currentProps, ...data.properties };
      updates.push(`properties = $${paramIndex++}`);
      values.push(JSON.stringify(newProps));
    }
    if (data.visibility !== undefined) {
      updates.push(`visibility = $${paramIndex++}`);
      values.push(data.visibility);
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    updates.push(`updated_at = now()`);

    const result = await pool.query(
      `UPDATE documents SET ${updates.join(', ')} WHERE id = $${paramIndex} AND workspace_id = $${paramIndex + 1} RETURNING *`,
      [...values, id, workspaceId]
    );

    // Cascade visibility changes to child documents
    if (data.visibility !== undefined && data.visibility !== existing.visibility) {
      await pool.query(
        `WITH RECURSIVE descendants AS (
          SELECT id FROM documents WHERE parent_id = $1
          UNION ALL
          SELECT d.id FROM documents d
          INNER JOIN descendants descendant ON d.parent_id = descendant.id
        )
        UPDATE documents SET visibility = $2, updated_at = now()
        WHERE id IN (SELECT id FROM descendants)`,
        [id, data.visibility]
      );

      // Notify WebSocket collaboration server to disconnect users who lost access
      handleVisibilityChange(id, data.visibility, existing.created_by).catch((err) => {
        console.error('Failed to handle visibility change for collaboration:', err);
      });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update document error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete document
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const userId = String(req.userId);
    const workspaceId = String(req.workspaceId);

    // Check if user can access the document
    const { canAccess, doc } = await canAccessDocument(id, userId, workspaceId);

    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    if (!canAccess) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    const result = await pool.query(
      'DELETE FROM documents WHERE id = $1 AND workspace_id = $2 RETURNING id',
      [id, workspaceId]
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
