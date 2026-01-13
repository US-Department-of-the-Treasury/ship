import { Router, Request, Response } from 'express';
import { pool } from '../db/client.js';
import { z } from 'zod';
import { getVisibilityContext, VISIBILITY_FILTER_SQL } from '../middleware/visibility.js';
import { authMiddleware } from '../middleware/auth.js';
import { DEFAULT_PROJECT_PROPERTIES, computeICEScore } from '@ship/shared';

type RouterType = ReturnType<typeof Router>;
const router: RouterType = Router();

// Helper to extract project from row with computed ice_score
function extractProjectFromRow(row: any) {
  const props = row.properties || {};
  const impact = props.impact ?? 3;
  const confidence = props.confidence ?? 3;
  const ease = props.ease ?? 3;

  return {
    id: row.id,
    title: row.title,
    // ICE properties
    impact,
    confidence,
    ease,
    ice_score: computeICEScore(impact, confidence, ease),
    // Visual properties
    color: props.color || DEFAULT_PROJECT_PROPERTIES.color,
    emoji: props.emoji || null,
    // Associations
    program_id: row.program_id || null,
    // Timestamps
    archived_at: row.archived_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    // Owner info
    owner: row.owner_name ? {
      id: row.owner_id,
      name: row.owner_name,
      email: row.owner_email,
    } : null,
    // Counts
    sprint_count: parseInt(row.sprint_count) || 0,
    issue_count: parseInt(row.issue_count) || 0,
  };
}

// Validation schemas
const iceScoreSchema = z.number().int().min(1).max(5);

const createProjectSchema = z.object({
  title: z.string().min(1).max(200).optional().default('Untitled'),
  impact: iceScoreSchema.optional().default(3),
  confidence: iceScoreSchema.optional().default(3),
  ease: iceScoreSchema.optional().default(3),
  owner_id: z.string().uuid(), // REQUIRED
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().default('#6366f1'),
  emoji: z.string().max(10).optional().nullable(),
  program_id: z.string().uuid().optional().nullable(),
});

const updateProjectSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  impact: iceScoreSchema.optional(),
  confidence: iceScoreSchema.optional(),
  ease: iceScoreSchema.optional(),
  owner_id: z.string().uuid().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  emoji: z.string().max(10).optional().nullable(),
  program_id: z.string().uuid().optional().nullable(),
  archived_at: z.string().datetime().optional().nullable(),
});

// Valid sort fields for projects
const VALID_SORT_FIELDS = ['ice_score', 'impact', 'confidence', 'ease', 'title', 'updated_at', 'created_at'];

// List projects (documents with document_type = 'project')
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const includeArchived = req.query.archived === 'true';
    const sortField = (req.query.sort as string) || 'ice_score';
    const sortDir = (req.query.dir as string) === 'asc' ? 'ASC' : 'DESC';
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Validate sort field to prevent SQL injection
    if (!VALID_SORT_FIELDS.includes(sortField)) {
      res.status(400).json({ error: `Invalid sort field. Valid fields: ${VALID_SORT_FIELDS.join(', ')}` });
      return;
    }

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Build ORDER BY clause - ice_score is computed, others are from properties or columns
    let orderByClause: string;
    if (sortField === 'ice_score') {
      // Compute ICE score: impact * confidence * ease
      orderByClause = `((COALESCE((d.properties->>'impact')::int, 3) * COALESCE((d.properties->>'confidence')::int, 3) * COALESCE((d.properties->>'ease')::int, 3))) ${sortDir}`;
    } else if (['impact', 'confidence', 'ease'].includes(sortField)) {
      orderByClause = `COALESCE((d.properties->>'${sortField}')::int, 3) ${sortDir}`;
    } else if (sortField === 'title') {
      orderByClause = `d.title ${sortDir}`;
    } else {
      orderByClause = `d.${sortField} ${sortDir}`;
    }

    let query = `
      SELECT d.id, d.title, d.properties, d.program_id, d.archived_at, d.created_at, d.updated_at,
             (d.properties->>'owner_id')::uuid as owner_id,
             u.name as owner_name, u.email as owner_email,
             (SELECT COUNT(*) FROM documents s WHERE s.project_id = d.id AND s.document_type = 'sprint') as sprint_count,
             (SELECT COUNT(*) FROM documents i WHERE i.project_id = d.id AND i.document_type = 'issue') as issue_count
      FROM documents d
      LEFT JOIN users u ON u.id = (d.properties->>'owner_id')::uuid
      WHERE d.workspace_id = $1 AND d.document_type = 'project'
        AND ${VISIBILITY_FILTER_SQL('d', '$2', '$3')}
    `;
    const params: (string | boolean)[] = [workspaceId, userId, isAdmin];

    if (!includeArchived) {
      query += ` AND d.archived_at IS NULL`;
    }

    query += ` ORDER BY ${orderByClause}`;

    const result = await pool.query(query, params);
    res.json(result.rows.map(extractProjectFromRow));
  } catch (err) {
    console.error('List projects error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single project
router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    const result = await pool.query(
      `SELECT d.id, d.title, d.properties, d.program_id, d.archived_at, d.created_at, d.updated_at,
              (d.properties->>'owner_id')::uuid as owner_id,
              u.name as owner_name, u.email as owner_email,
              (SELECT COUNT(*) FROM documents s WHERE s.project_id = d.id AND s.document_type = 'sprint') as sprint_count,
              (SELECT COUNT(*) FROM documents i WHERE i.project_id = d.id AND i.document_type = 'issue') as issue_count
       FROM documents d
       LEFT JOIN users u ON u.id = (d.properties->>'owner_id')::uuid
       WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'project'
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    res.json(extractProjectFromRow(result.rows[0]));
  } catch (err) {
    console.error('Get project error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create project (creates a document with document_type = 'project')
router.post('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const parsed = createProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
      return;
    }

    const { title, impact, confidence, ease, owner_id, color, emoji, program_id } = parsed.data;

    // Build properties JSONB
    const properties: Record<string, unknown> = {
      impact,
      confidence,
      ease,
      owner_id,
      color,
    };
    if (emoji) {
      properties.emoji = emoji;
    }

    const result = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, properties, program_id, created_by)
       VALUES ($1, 'project', $2, $3, $4, $5)
       RETURNING id, title, properties, program_id, archived_at, created_at, updated_at`,
      [req.workspaceId, title, JSON.stringify(properties), program_id || null, req.userId]
    );

    // Get user info for owner response
    const userResult = await pool.query(
      'SELECT id, name, email FROM users WHERE id = $1',
      [owner_id]
    );
    const user = userResult.rows[0];

    res.status(201).json({
      ...extractProjectFromRow(result.rows[0]),
      sprint_count: 0,
      issue_count: 0,
      owner: user ? {
        id: user.id,
        name: user.name,
        email: user.email,
      } : null
    });
  } catch (err) {
    console.error('Create project error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update project
router.patch('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    const parsed = updateProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
      return;
    }

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify project exists and user can access it
    const existing = await pool.query(
      `SELECT id, properties FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'project'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Project not found' });
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

    // Handle program_id update (regular column)
    if (data.program_id !== undefined) {
      updates.push(`program_id = $${paramIndex++}`);
      values.push(data.program_id);
    }

    // Handle properties updates
    const newProps = { ...currentProps };
    let propsChanged = false;

    if (data.impact !== undefined) {
      newProps.impact = data.impact;
      propsChanged = true;
    }

    if (data.confidence !== undefined) {
      newProps.confidence = data.confidence;
      propsChanged = true;
    }

    if (data.ease !== undefined) {
      newProps.ease = data.ease;
      propsChanged = true;
    }

    if (data.owner_id !== undefined) {
      newProps.owner_id = data.owner_id;
      propsChanged = true;
    }

    if (data.color !== undefined) {
      newProps.color = data.color;
      propsChanged = true;
    }

    if (data.emoji !== undefined) {
      newProps.emoji = data.emoji;
      propsChanged = true;
    }

    if (propsChanged) {
      updates.push(`properties = $${paramIndex++}`);
      values.push(JSON.stringify(newProps));
    }

    // Handle archived_at (regular column)
    if (data.archived_at !== undefined) {
      updates.push(`archived_at = $${paramIndex++}`);
      values.push(data.archived_at);
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    updates.push(`updated_at = now()`);

    await pool.query(
      `UPDATE documents SET ${updates.join(', ')}
       WHERE id = $${paramIndex} AND workspace_id = $${paramIndex + 1} AND document_type = 'project'`,
      [...values, id, req.workspaceId]
    );

    // Re-query to get full project with owner info
    const result = await pool.query(
      `SELECT d.id, d.title, d.properties, d.program_id, d.archived_at, d.created_at, d.updated_at,
              (d.properties->>'owner_id')::uuid as owner_id,
              u.name as owner_name, u.email as owner_email,
              (SELECT COUNT(*) FROM documents s WHERE s.project_id = d.id AND s.document_type = 'sprint') as sprint_count,
              (SELECT COUNT(*) FROM documents i WHERE i.project_id = d.id AND i.document_type = 'issue') as issue_count
       FROM documents d
       LEFT JOIN users u ON u.id = (d.properties->>'owner_id')::uuid
       WHERE d.id = $1 AND d.document_type = 'project'`,
      [id]
    );

    res.json(extractProjectFromRow(result.rows[0]));
  } catch (err) {
    console.error('Update project error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete project
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // First verify user can access the project
    const accessCheck = await pool.query(
      `SELECT id FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'project'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (accessCheck.rows.length === 0) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Remove project_id from child documents first
    await pool.query(
      `UPDATE documents SET project_id = NULL WHERE project_id = $1`,
      [id]
    );

    // Now delete it
    await pool.query(
      `DELETE FROM documents WHERE id = $1 AND workspace_id = $2 AND document_type = 'project'`,
      [id, workspaceId]
    );

    res.status(204).send();
  } catch (err) {
    console.error('Delete project error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
