import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../db/client.js';
import { z } from 'zod';
import { getVisibilityContext, VISIBILITY_FILTER_SQL } from '../middleware/visibility.js';

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

// Helper to extract program from row
function extractProgramFromRow(row: any) {
  const props = row.properties || {};
  return {
    id: row.id,
    name: row.title,
    color: props.color || '#6366f1',
    emoji: props.emoji || null,
    archived_at: row.archived_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    issue_count: row.issue_count,
    sprint_count: row.sprint_count,
    // owner_id in properties takes precedence over created_by
    owner: row.owner_name ? {
      id: row.owner_id,
      name: row.owner_name,
      email: row.owner_email,
    } : null,
  };
}

// Validation schemas
const createProgramSchema = z.object({
  title: z.string().min(1).max(200).optional().default('Untitled'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().default('#6366f1'),
  emoji: z.string().max(10).optional().nullable(),
});

const updateProgramSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  emoji: z.string().max(10).optional().nullable(),
  owner_id: z.string().uuid().optional().nullable(),
  archived_at: z.string().datetime().optional().nullable(),
});

// List programs (documents with document_type = 'program')
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const includeArchived = req.query.archived === 'true';
    const userId = req.user!.id;
    const workspaceId = req.user!.workspaceId;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // owner_id in properties takes precedence over created_by
    let query = `
      SELECT d.id, d.title, d.properties, d.archived_at, d.created_at, d.updated_at,
             COALESCE((d.properties->>'owner_id')::uuid, d.created_by) as owner_id,
             u.name as owner_name, u.email as owner_email,
             (SELECT COUNT(*) FROM documents i WHERE i.program_id = d.id AND i.document_type = 'issue') as issue_count,
             (SELECT COUNT(*) FROM documents s WHERE s.program_id = d.id AND s.document_type = 'sprint') as sprint_count
      FROM documents d
      LEFT JOIN users u ON u.id = COALESCE((d.properties->>'owner_id')::uuid, d.created_by)
      WHERE d.workspace_id = $1 AND d.document_type = 'program'
        AND ${VISIBILITY_FILTER_SQL('d', '$2', '$3')}
    `;
    const params: (string | boolean)[] = [workspaceId, userId, isAdmin];

    if (!includeArchived) {
      query += ` AND d.archived_at IS NULL`;
    }

    query += ` ORDER BY d.created_at DESC`;

    const result = await pool.query(query, params);
    res.json(result.rows.map(extractProgramFromRow));
  } catch (err) {
    console.error('List programs error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single program
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const workspaceId = req.user!.workspaceId;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // owner_id in properties takes precedence over created_by
    const result = await pool.query(
      `SELECT d.id, d.title, d.properties, d.archived_at, d.created_at, d.updated_at,
              COALESCE((d.properties->>'owner_id')::uuid, d.created_by) as owner_id,
              u.name as owner_name, u.email as owner_email,
              (SELECT COUNT(*) FROM documents i WHERE i.program_id = d.id AND i.document_type = 'issue') as issue_count,
              (SELECT COUNT(*) FROM documents s WHERE s.program_id = d.id AND s.document_type = 'sprint') as sprint_count
       FROM documents d
       LEFT JOIN users u ON u.id = COALESCE((d.properties->>'owner_id')::uuid, d.created_by)
       WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'program'
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Program not found' });
      return;
    }

    res.json(extractProgramFromRow(result.rows[0]));
  } catch (err) {
    console.error('Get program error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create program (creates a document with document_type = 'program')
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = createProgramSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
      return;
    }

    const { title, color, emoji } = parsed.data;

    // Build properties JSONB
    const properties: Record<string, unknown> = {
      color: color || '#6366f1',
    };
    if (emoji) {
      properties.emoji = emoji;
    }

    const result = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, properties, created_by)
       VALUES ($1, 'program', $2, $3, $4)
       RETURNING id, title, properties, archived_at, created_at, updated_at`,
      [req.user!.workspaceId, title, JSON.stringify(properties), req.user!.id]
    );

    res.status(201).json({
      ...extractProgramFromRow(result.rows[0]),
      issue_count: 0,
      sprint_count: 0,
      owner: {
        id: req.user!.id,
        name: req.user!.name,
        email: req.user!.email,
      }
    });
  } catch (err) {
    console.error('Create program error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update program
router.patch('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const workspaceId = req.user!.workspaceId;

    const parsed = updateProgramSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
      return;
    }

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify program exists and user can access it
    const existing = await pool.query(
      `SELECT id, properties FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'program'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Program not found' });
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

    if (data.color !== undefined) {
      newProps.color = data.color;
      propsChanged = true;
    }

    if (data.emoji !== undefined) {
      newProps.emoji = data.emoji;
      propsChanged = true;
    }

    if (data.owner_id !== undefined) {
      newProps.owner_id = data.owner_id;
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
       WHERE id = $${paramIndex} AND workspace_id = $${paramIndex + 1} AND document_type = 'program'`,
      [...values, id, req.user!.workspaceId]
    );

    // Re-query to get full program with owner info
    const result = await pool.query(
      `SELECT d.id, d.title, d.properties, d.archived_at, d.created_at, d.updated_at,
              COALESCE((d.properties->>'owner_id')::uuid, d.created_by) as owner_id,
              u.name as owner_name, u.email as owner_email
       FROM documents d
       LEFT JOIN users u ON u.id = COALESCE((d.properties->>'owner_id')::uuid, d.created_by)
       WHERE d.id = $1 AND d.document_type = 'program'`,
      [id]
    );

    res.json(extractProgramFromRow(result.rows[0]));
  } catch (err) {
    console.error('Update program error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete program
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const workspaceId = req.user!.workspaceId;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // First verify user can access the program
    const accessCheck = await pool.query(
      `SELECT id FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'program'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (accessCheck.rows.length === 0) {
      res.status(404).json({ error: 'Program not found' });
      return;
    }

    // Remove program_id from child documents first
    await pool.query(
      `UPDATE documents SET program_id = NULL WHERE program_id = $1`,
      [id]
    );

    // Now delete it
    await pool.query(
      `DELETE FROM documents WHERE id = $1 AND workspace_id = $2 AND document_type = 'program'`,
      [id, workspaceId]
    );

    res.status(204).send();
  } catch (err) {
    console.error('Delete program error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get program issues
router.get('/:id/issues', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const workspaceId = req.user!.workspaceId;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify program exists and user can access it
    const programExists = await pool.query(
      `SELECT id FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'program'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (programExists.rows.length === 0) {
      res.status(404).json({ error: 'Program not found' });
      return;
    }

    // Also filter the issues by visibility
    const result = await pool.query(
      `SELECT d.id, d.title, d.properties, d.ticket_number,
              d.sprint_id, d.created_at, d.updated_at, d.created_by,
              u.name as assignee_name
       FROM documents d
       LEFT JOIN users u ON (d.properties->>'assignee_id')::uuid = u.id
       WHERE d.program_id = $1 AND d.document_type = 'issue'
         AND ${VISIBILITY_FILTER_SQL('d', '$2', '$3')}
       ORDER BY
         CASE d.properties->>'priority'
           WHEN 'urgent' THEN 1
           WHEN 'high' THEN 2
           WHEN 'medium' THEN 3
           WHEN 'low' THEN 4
           ELSE 5
         END,
         d.updated_at DESC`,
      [id, userId, isAdmin]
    );

    // Add display_id to each issue and extract properties
    const issues = result.rows.map(row => {
      const props = row.properties || {};
      return {
        id: row.id,
        title: row.title,
        state: props.state || 'backlog',
        priority: props.priority || 'medium',
        assignee_id: props.assignee_id || null,
        ticket_number: row.ticket_number,
        sprint_id: row.sprint_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
        created_by: row.created_by,
        assignee_name: row.assignee_name,
        display_id: `#${row.ticket_number}`
      };
    });

    res.json(issues);
  } catch (err) {
    console.error('Get program issues error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get program sprints (documents with document_type = 'sprint' that belong to this program)
// Returns sprints with sprint_number and owner_id - dates/status computed on frontend
router.get('/:id/sprints', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const workspaceId = req.user!.workspaceId;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify program exists and user can access it
    const programCheck = await pool.query(
      `SELECT d.id, w.sprint_start_date
       FROM documents d
       JOIN workspaces w ON d.workspace_id = w.id
       WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'program'
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (programCheck.rows.length === 0) {
      res.status(404).json({ error: 'Program not found' });
      return;
    }

    const sprintStartDate = programCheck.rows[0].sprint_start_date;

    // Also filter sprints by visibility
    const result = await pool.query(
      `SELECT d.id, d.title as name, d.properties,
              u.id as owner_id, u.name as owner_name, u.email as owner_email,
              (SELECT COUNT(*) FROM documents i WHERE i.sprint_id = d.id AND i.document_type = 'issue') as issue_count,
              (SELECT COUNT(*) FROM documents i WHERE i.sprint_id = d.id AND i.document_type = 'issue' AND i.properties->>'state' = 'done') as completed_count,
              (SELECT COUNT(*) FROM documents i WHERE i.sprint_id = d.id AND i.document_type = 'issue' AND i.properties->>'state' IN ('in_progress', 'in_review')) as started_count,
              (SELECT COALESCE(SUM((i.properties->>'estimate')::numeric), 0) FROM documents i WHERE i.sprint_id = d.id AND i.document_type = 'issue') as total_estimate_hours
       FROM documents d
       LEFT JOIN users u ON (d.properties->>'owner_id')::uuid = u.id
       WHERE d.program_id = $1 AND d.document_type = 'sprint'
         AND ${VISIBILITY_FILTER_SQL('d', '$2', '$3')}
       ORDER BY (d.properties->>'sprint_number')::int ASC`,
      [id, userId, isAdmin]
    );

    // Extract sprint properties - dates/status computed by frontend
    const sprints = result.rows.map(row => {
      const props = row.properties || {};
      return {
        id: row.id,
        name: row.name,
        sprint_number: props.sprint_number || 1,
        owner: row.owner_id ? {
          id: row.owner_id,
          name: row.owner_name,
          email: row.owner_email,
        } : null,
        issue_count: parseInt(row.issue_count) || 0,
        completed_count: parseInt(row.completed_count) || 0,
        started_count: parseInt(row.started_count) || 0,
        total_estimate_hours: parseFloat(row.total_estimate_hours) || 0,
      };
    });

    res.json({
      workspace_sprint_start_date: sprintStartDate,
      sprints,
    });
  } catch (err) {
    console.error('Get program sprints error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
