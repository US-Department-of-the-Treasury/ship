import { Router, Request, Response } from 'express';
import { pool } from '../db/client.js';
import { z } from 'zod';
import { getVisibilityContext, VISIBILITY_FILTER_SQL } from '../middleware/visibility.js';
import { authMiddleware } from '../middleware/auth.js';

type RouterType = ReturnType<typeof Router>;
const router: RouterType = Router();

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
  owner_id: z.string().uuid().optional().nullable().default(null), // R - Responsible (does the work)
  accountable_id: z.string().uuid().optional().nullable().default(null), // A - Accountable (approver)
  consulted_ids: z.array(z.string().uuid()).optional().default([]), // C - Consulted (provide input)
  informed_ids: z.array(z.string().uuid()).optional().default([]), // I - Informed (kept in loop)
});

const updateProgramSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  emoji: z.string().max(10).optional().nullable(),
  owner_id: z.string().uuid().optional().nullable(), // R - Responsible (can be cleared)
  accountable_id: z.string().uuid().optional().nullable(), // A - Accountable (can be cleared)
  consulted_ids: z.array(z.string().uuid()).optional(), // C - Consulted
  informed_ids: z.array(z.string().uuid()).optional(), // I - Informed
  archived_at: z.string().datetime().optional().nullable(),
});

// List programs (documents with document_type = 'program')
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const includeArchived = req.query.archived === 'true';
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // owner_id in properties takes precedence over created_by
    let query = `
      SELECT d.id, d.title, d.properties, d.archived_at, d.created_at, d.updated_at,
             COALESCE((d.properties->>'owner_id')::uuid, d.created_by) as owner_id,
             u.name as owner_name, u.email as owner_email,
             (SELECT COUNT(*) FROM documents i
              JOIN document_associations da ON da.document_id = i.id AND da.related_id = d.id AND da.relationship_type = 'program'
              WHERE i.document_type = 'issue') as issue_count,
             (SELECT COUNT(*) FROM documents s
              JOIN document_associations da ON da.document_id = s.id AND da.related_id = d.id AND da.relationship_type = 'program'
              WHERE s.document_type = 'sprint') as sprint_count
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
router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // owner_id in properties takes precedence over created_by
    const result = await pool.query(
      `SELECT d.id, d.title, d.properties, d.archived_at, d.created_at, d.updated_at,
              COALESCE((d.properties->>'owner_id')::uuid, d.created_by) as owner_id,
              u.name as owner_name, u.email as owner_email,
              (SELECT COUNT(*) FROM documents i
               JOIN document_associations da ON da.document_id = i.id AND da.related_id = d.id AND da.relationship_type = 'program'
               WHERE i.document_type = 'issue') as issue_count,
              (SELECT COUNT(*) FROM documents s
               JOIN document_associations da ON da.document_id = s.id AND da.related_id = d.id AND da.relationship_type = 'program'
               WHERE s.document_type = 'sprint') as sprint_count
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
router.post('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const parsed = createProgramSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
      return;
    }

    const { title, color, emoji, owner_id, accountable_id, consulted_ids, informed_ids } = parsed.data;

    // Build properties JSONB with RACI fields
    const properties: Record<string, unknown> = {
      color: color || '#6366f1',
      owner_id, // R - Responsible
      accountable_id, // A - Accountable
      consulted_ids, // C - Consulted
      informed_ids, // I - Informed
    };
    if (emoji) {
      properties.emoji = emoji;
    }

    const result = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, properties, created_by)
       VALUES ($1, 'program', $2, $3, $4)
       RETURNING id, title, properties, archived_at, created_at, updated_at`,
      [req.workspaceId, title, JSON.stringify(properties), req.userId]
    );

    // Get user info for owner response
    const userResult = await pool.query(
      'SELECT id, name, email FROM users WHERE id = $1',
      [req.userId]
    );
    const user = userResult.rows[0];

    res.status(201).json({
      ...extractProgramFromRow(result.rows[0]),
      issue_count: 0,
      sprint_count: 0,
      owner: user ? {
        id: user.id,
        name: user.name,
        email: user.email,
      } : null
    });
  } catch (err) {
    console.error('Create program error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update program
router.patch('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

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

    if (data.accountable_id !== undefined) {
      newProps.accountable_id = data.accountable_id;
      propsChanged = true;
    }

    if (data.consulted_ids !== undefined) {
      newProps.consulted_ids = data.consulted_ids;
      propsChanged = true;
    }

    if (data.informed_ids !== undefined) {
      newProps.informed_ids = data.informed_ids;
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
      [...values, id, req.workspaceId]
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
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

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

    // Remove associations to this program
    await pool.query(
      `DELETE FROM document_associations WHERE related_id = $1 AND relationship_type = 'program'`,
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
router.get('/:id/issues', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

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

    // Also filter the issues by visibility - join via document_associations
    const result = await pool.query(
      `SELECT d.id, d.title, d.properties, d.ticket_number,
              d.created_at, d.updated_at, d.created_by,
              u.name as assignee_name,
              CASE WHEN person_doc.archived_at IS NOT NULL THEN true ELSE false END as assignee_archived,
              sprint_da.related_id as sprint_id
       FROM documents d
       JOIN document_associations da ON da.document_id = d.id AND da.related_id = $1 AND da.relationship_type = 'program'
       LEFT JOIN document_associations sprint_da ON sprint_da.document_id = d.id AND sprint_da.relationship_type = 'sprint'
       LEFT JOIN users u ON (d.properties->>'assignee_id')::uuid = u.id
       LEFT JOIN documents person_doc ON person_doc.workspace_id = d.workspace_id
         AND person_doc.document_type = 'person'
         AND person_doc.properties->>'user_id' = d.properties->>'assignee_id'
       WHERE d.document_type = 'issue'
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
        estimate: props.estimate ?? null,
        ticket_number: row.ticket_number,
        sprint_id: row.sprint_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
        created_by: row.created_by,
        assignee_name: row.assignee_name,
        assignee_archived: row.assignee_archived || false,
        display_id: `#${row.ticket_number}`
      };
    });

    res.json(issues);
  } catch (err) {
    console.error('Get program issues error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get program projects (documents with document_type = 'project' that belong to this program)
router.get('/:id/projects', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

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

    // Fetch projects belonging to this program via document_associations
    const result = await pool.query(
      `SELECT d.id, d.title, d.properties, $1::uuid as program_id, d.archived_at, d.created_at, d.updated_at,
              (d.properties->>'owner_id')::uuid as owner_id,
              u.name as owner_name, u.email as owner_email,
              (SELECT COUNT(*) FROM documents s
               JOIN document_associations sda ON sda.document_id = s.id AND sda.related_id = d.id AND sda.relationship_type = 'project'
               WHERE s.document_type = 'sprint') as sprint_count,
              (SELECT COUNT(*) FROM documents i
               JOIN document_associations ida ON ida.document_id = i.id AND ida.related_id = d.id AND ida.relationship_type = 'project'
               WHERE i.document_type = 'issue') as issue_count
       FROM documents d
       JOIN document_associations da ON da.document_id = d.id AND da.related_id = $1 AND da.relationship_type = 'program'
       LEFT JOIN users u ON u.id = (d.properties->>'owner_id')::uuid
       WHERE d.document_type = 'project'
         AND ${VISIBILITY_FILTER_SQL('d', '$2', '$3')}
         AND d.archived_at IS NULL
       ORDER BY
         ((COALESCE((d.properties->>'impact')::int, 3) * COALESCE((d.properties->>'confidence')::int, 3) * COALESCE((d.properties->>'ease')::int, 3))) DESC`,
      [id, userId, isAdmin]
    );

    // Transform rows to project format
    const projects = result.rows.map(row => {
      const props = row.properties || {};
      const impact = props.impact ?? 3;
      const confidence = props.confidence ?? 3;
      const ease = props.ease ?? 3;

      return {
        id: row.id,
        title: row.title,
        impact,
        confidence,
        ease,
        ice_score: impact * confidence * ease,
        color: props.color || '#6366f1',
        emoji: props.emoji || null,
        program_id: row.program_id,
        archived_at: row.archived_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
        owner: row.owner_name ? {
          id: row.owner_id,
          name: row.owner_name,
          email: row.owner_email,
        } : null,
        sprint_count: parseInt(row.sprint_count) || 0,
        issue_count: parseInt(row.issue_count) || 0,
      };
    });

    res.json(projects);
  } catch (err) {
    console.error('Get program projects error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get program sprints (documents with document_type = 'sprint' that belong to this program)
// Returns sprints with sprint_number and owner_id - dates/status computed on frontend
router.get('/:id/sprints', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

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

    // Also filter sprints by visibility - join via document_associations
    // Include subqueries for sprint_plan and sprint_retro existence
    const result = await pool.query(
      `SELECT d.id, d.title as name, d.properties,
              u.id as owner_id, u.name as owner_name, u.email as owner_email,
              (SELECT COUNT(*) FROM documents i
               JOIN document_associations ida ON ida.document_id = i.id AND ida.related_id = d.id AND ida.relationship_type = 'sprint'
               WHERE i.document_type = 'issue') as issue_count,
              (SELECT COUNT(*) FROM documents i
               JOIN document_associations ida ON ida.document_id = i.id AND ida.related_id = d.id AND ida.relationship_type = 'sprint'
               WHERE i.document_type = 'issue' AND i.properties->>'state' = 'done') as completed_count,
              (SELECT COUNT(*) FROM documents i
               JOIN document_associations ida ON ida.document_id = i.id AND ida.related_id = d.id AND ida.relationship_type = 'sprint'
               WHERE i.document_type = 'issue' AND i.properties->>'state' IN ('in_progress', 'in_review')) as started_count,
              (SELECT COALESCE(SUM((i.properties->>'estimate')::numeric), 0) FROM documents i
               JOIN document_associations ida ON ida.document_id = i.id AND ida.related_id = d.id AND ida.relationship_type = 'sprint'
               WHERE i.document_type = 'issue') as total_estimate_hours,
              (SELECT COUNT(*) > 0 FROM documents p WHERE p.parent_id = d.id AND p.document_type = 'sprint_plan') as has_plan,
              (SELECT COUNT(*) > 0 FROM documents r WHERE r.parent_id = d.id AND r.document_type = 'sprint_retro') as has_retro,
              (SELECT created_at FROM documents p WHERE p.parent_id = d.id AND p.document_type = 'sprint_plan' LIMIT 1) as plan_created_at,
              (SELECT created_at FROM documents r WHERE r.parent_id = d.id AND r.document_type = 'sprint_retro' LIMIT 1) as retro_created_at
       FROM documents d
       JOIN document_associations da ON da.document_id = d.id AND da.related_id = $1 AND da.relationship_type = 'program'
       LEFT JOIN users u ON (d.properties->>'owner_id')::uuid = u.id
       WHERE d.document_type = 'sprint'
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
        status: props.status || 'planning',  // Default to 'planning' for sprints without status
        owner: row.owner_id ? {
          id: row.owner_id,
          name: row.owner_name,
          email: row.owner_email,
        } : null,
        issue_count: parseInt(row.issue_count) || 0,
        completed_count: parseInt(row.completed_count) || 0,
        started_count: parseInt(row.started_count) || 0,
        total_estimate_hours: parseFloat(row.total_estimate_hours) || 0,
        has_plan: row.has_plan === true || row.has_plan === 't',
        has_retro: row.has_retro === true || row.has_retro === 't',
        plan_created_at: row.plan_created_at || null,
        retro_created_at: row.retro_created_at || null,
        // Sprint goal (concise objective, separate from hypothesis)
        goal: props.goal || null,
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
