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

// Validation schema for updating links
const updateLinksSchema = z.object({
  target_ids: z.array(z.string().uuid()),
});

// GET /api/documents/:id/backlinks - Get documents that link to this one
router.get('/:id/backlinks', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Verify the document exists and belongs to workspace
    const docResult = await pool.query(
      'SELECT id FROM documents WHERE id = $1 AND workspace_id = $2',
      [id, req.user!.workspaceId]
    );

    if (docResult.rows.length === 0) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    // Get all documents that link to this document
    const result = await pool.query(
      `SELECT d.id, d.document_type, d.title, d.ticket_number, d.program_id, d.properties,
              p.properties->>'prefix' as program_prefix
       FROM document_links dl
       JOIN documents d ON dl.source_id = d.id
       LEFT JOIN documents p ON d.program_id = p.id AND p.document_type = 'program'
       WHERE dl.target_id = $1 AND d.workspace_id = $2
       ORDER BY dl.created_at DESC`,
      [id, req.user!.workspaceId]
    );

    // Format the response with display_id for issues
    const backlinks = result.rows.map(row => ({
      id: row.id,
      document_type: row.document_type,
      title: row.title,
      display_id: row.ticket_number && row.document_type === 'issue'
        ? (row.program_prefix ? `${row.program_prefix}-${row.ticket_number}` : `#${row.ticket_number}`)
        : undefined,
    }));

    res.json(backlinks);
  } catch (err) {
    console.error('Get backlinks error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/documents/:id/links - Update links for a document
router.post('/:id/links', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const parsed = updateLinksSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
      return;
    }

    const { target_ids } = parsed.data;

    // Verify the source document exists and belongs to workspace
    const docResult = await pool.query(
      'SELECT id FROM documents WHERE id = $1 AND workspace_id = $2',
      [id, req.user!.workspaceId]
    );

    if (docResult.rows.length === 0) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    // Verify all target documents exist and belong to workspace
    if (target_ids.length > 0) {
      const targetResult = await pool.query(
        'SELECT id FROM documents WHERE id = ANY($1) AND workspace_id = $2',
        [target_ids, req.user!.workspaceId]
      );

      if (targetResult.rows.length !== target_ids.length) {
        res.status(400).json({ error: 'One or more target documents not found' });
        return;
      }
    }

    // Start transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Delete existing links for this source document
      await client.query(
        'DELETE FROM document_links WHERE source_id = $1',
        [id]
      );

      // Insert new links (if any)
      if (target_ids.length > 0) {
        const values = target_ids.map((targetId, idx) =>
          `($1, $${idx + 2})`
        ).join(', ');

        await client.query(
          `INSERT INTO document_links (source_id, target_id)
           VALUES ${values}
           ON CONFLICT (source_id, target_id) DO NOTHING`,
          [id, ...target_ids]
        );
      }

      await client.query('COMMIT');
      res.json({ success: true });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Update links error:', err);
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
