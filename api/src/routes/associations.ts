import { Router, Request, Response } from 'express';
import { pool } from '../db/client.js';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';

type RouterType = ReturnType<typeof Router>;
const router: RouterType = Router();

// Validation schemas
const createAssociationSchema = z.object({
  related_id: z.string().uuid(),
  relationship_type: z.enum(['parent', 'project', 'sprint', 'program']),
  metadata: z.record(z.unknown()).optional(),
});

// Check if user can access document
async function canAccessDocument(
  docId: string,
  userId: string,
  workspaceId: string
): Promise<boolean> {
  const result = await pool.query(
    `SELECT id FROM documents
     WHERE id = $1 AND workspace_id = $2
       AND (visibility = 'workspace' OR created_by = $3 OR
            (SELECT role FROM workspace_memberships WHERE workspace_id = $2 AND user_id = $3) = 'admin')`,
    [docId, workspaceId, userId]
  );
  return result.rows.length > 0;
}

// Valid relationship types
const validTypes = ['parent', 'project', 'sprint', 'program'] as const;
type RelationshipType = typeof validTypes[number];

function isValidRelationshipType(value: unknown): value is RelationshipType {
  return typeof value === 'string' && validTypes.includes(value as RelationshipType);
}

// GET /api/documents/:id/associations - List all associations for a document
router.get('/:id/associations', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    // Normalize query param (could be string or string[])
    const typeParam = Array.isArray(req.query.type) ? req.query.type[0] : req.query.type;
    const userId = String(req.userId);
    const workspaceId = String(req.workspaceId);

    // Check access
    if (!(await canAccessDocument(id, userId, workspaceId))) {
      return res.status(404).json({ error: 'Document not found' });
    }

    let query = `
      SELECT
        da.id,
        da.document_id,
        da.related_id,
        da.relationship_type,
        da.created_at,
        da.metadata,
        d.title as related_title,
        d.document_type as related_document_type
      FROM document_associations da
      JOIN documents d ON d.id = da.related_id
      WHERE da.document_id = $1
    `;
    const params: string[] = [id];

    // Filter by relationship type if provided
    if (typeParam) {
      if (!isValidRelationshipType(typeParam)) {
        return res.status(400).json({ error: 'Invalid relationship type' });
      }
      query += ` AND da.relationship_type = $2`;
      params.push(typeParam);
    }

    query += ` ORDER BY da.created_at DESC`;

    const result = await pool.query(query, params);

    return res.json(result.rows);
  } catch (error) {
    console.error('Error fetching associations:', error);
    return res.status(500).json({ error: 'Failed to fetch associations' });
  }
});

// POST /api/documents/:id/associations - Create a new association
router.post('/:id/associations', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const userId = String(req.userId);
    const workspaceId = String(req.workspaceId);

    // Validate input
    const parseResult = createAssociationSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Invalid input', details: parseResult.error.errors });
    }

    const { related_id, relationship_type, metadata } = parseResult.data;

    // Check access to source document
    if (!(await canAccessDocument(id, userId, workspaceId))) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Check related document exists in same workspace
    const relatedDoc = await pool.query(
      'SELECT id FROM documents WHERE id = $1 AND workspace_id = $2',
      [related_id, workspaceId]
    );
    if (relatedDoc.rows.length === 0) {
      return res.status(400).json({ error: 'Related document not found' });
    }

    // Prevent self-reference
    if (id === related_id) {
      return res.status(400).json({ error: 'Cannot create self-referencing association' });
    }

    // Create association (ON CONFLICT handles duplicate check)
    const result = await pool.query(
      `INSERT INTO document_associations (document_id, related_id, relationship_type, metadata)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (document_id, related_id, relationship_type) DO UPDATE SET
         metadata = COALESCE($4, document_associations.metadata),
         created_at = document_associations.created_at
       RETURNING *`,
      [id, related_id, relationship_type, metadata || {}]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating association:', error);
    return res.status(500).json({ error: 'Failed to create association' });
  }
});

// DELETE /api/documents/:id/associations/:relatedId - Delete a specific association
router.delete('/:id/associations/:relatedId', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const relatedId = String(req.params.relatedId);
    // Normalize query param (could be string or string[])
    const typeParam = Array.isArray(req.query.type) ? req.query.type[0] : req.query.type;
    const userId = String(req.userId);
    const workspaceId = String(req.workspaceId);

    // Check access
    if (!(await canAccessDocument(id, userId, workspaceId))) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Build delete query
    let query = `DELETE FROM document_associations WHERE document_id = $1 AND related_id = $2`;
    const params: string[] = [id, relatedId];

    // If type is specified, only delete that specific association type
    if (typeParam) {
      if (!isValidRelationshipType(typeParam)) {
        return res.status(400).json({ error: 'Invalid relationship type' });
      }
      query += ` AND relationship_type = $3`;
      params.push(typeParam);
    }

    query += ` RETURNING *`;

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Association not found' });
    }

    return res.json({ deleted: result.rows.length, associations: result.rows });
  } catch (error) {
    console.error('Error deleting association:', error);
    return res.status(500).json({ error: 'Failed to delete association' });
  }
});

// GET /api/documents/:id/reverse-associations - Find documents that associate with this one
router.get('/:id/reverse-associations', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    // Normalize query param (could be string or string[])
    const typeParam = Array.isArray(req.query.type) ? req.query.type[0] : req.query.type;
    const userId = String(req.userId);
    const workspaceId = String(req.workspaceId);

    // Check access
    if (!(await canAccessDocument(id, userId, workspaceId))) {
      return res.status(404).json({ error: 'Document not found' });
    }

    let query = `
      SELECT
        da.id,
        da.document_id,
        da.related_id,
        da.relationship_type,
        da.created_at,
        da.metadata,
        d.title as document_title,
        d.document_type as document_document_type
      FROM document_associations da
      JOIN documents d ON d.id = da.document_id
      WHERE da.related_id = $1
        AND d.workspace_id = $2
        AND d.archived_at IS NULL
    `;
    const params: string[] = [id, workspaceId];

    if (typeParam) {
      if (!isValidRelationshipType(typeParam)) {
        return res.status(400).json({ error: 'Invalid relationship type' });
      }
      query += ` AND da.relationship_type = $3`;
      params.push(typeParam);
    }

    query += ` ORDER BY da.created_at DESC`;

    const result = await pool.query(query, params);

    return res.json(result.rows);
  } catch (error) {
    console.error('Error fetching reverse associations:', error);
    return res.status(500).json({ error: 'Failed to fetch reverse associations' });
  }
});

export default router;
