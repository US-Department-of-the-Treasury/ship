import { Router, Request, Response } from 'express';
import { pool } from '../db/client.js';
import { z } from 'zod';
import { getVisibilityContext, VISIBILITY_FILTER_SQL } from '../middleware/visibility.js';
import { authMiddleware } from '../middleware/auth.js';
import { DEFAULT_PROJECT_PROPERTIES, computeICEScore } from '@ship/shared';
import { checkDocumentCompleteness } from '../utils/extractHypothesis.js';

type RouterType = ReturnType<typeof Router>;
const router: RouterType = Router();

// Inferred project status type
type InferredProjectStatus = 'active' | 'planned' | 'completed' | 'backlog' | 'archived';

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
    // Completeness flags
    is_complete: props.is_complete ?? null,
    missing_fields: props.missing_fields ?? [],
    // Inferred status (computed from sprint relationships)
    inferred_status: row.inferred_status as InferredProjectStatus || 'backlog',
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

// Schema for project retro
const projectRetroSchema = z.object({
  hypothesis_validated: z.boolean().nullable().optional(),
  monetary_impact_actual: z.string().max(500).nullable().optional(),
  success_criteria: z.array(z.string().max(500)).nullable().optional(),
  next_steps: z.string().max(2000).nullable().optional(),
  content: z.record(z.unknown()).optional(), // TipTap content for narrative
});

// Helper to generate pre-filled retro content for a project
async function generatePrefilledRetroContent(projectData: any, sprints: any[], issues: any[]) {
  const props = projectData.properties || {};

  // Categorize issues by state
  const completedIssues = issues.filter(i => i.state === 'done');
  const cancelledIssues = issues.filter(i => i.state === 'cancelled');
  const activeIssues = issues.filter(i => !['done', 'cancelled'].includes(i.state));

  // Build TipTap content
  const content: any = {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Project Summary' }],
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: `Project: ${projectData.title}` },
        ],
      },
    ],
  };

  // Add ICE Score section
  const impact = props.impact ?? 3;
  const confidence = props.confidence ?? 3;
  const ease = props.ease ?? 3;
  const iceScore = impact * confidence * ease;

  content.content.push({
    type: 'heading',
    attrs: { level: 3 },
    content: [{ type: 'text', text: 'ICE Scores' }],
  });
  content.content.push({
    type: 'bulletList',
    content: [
      {
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: `Impact: ${impact}/5` }] }],
      },
      {
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: `Confidence: ${confidence}/5` }] }],
      },
      {
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: `Ease: ${ease}/5` }] }],
      },
      {
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: `ICE Score: ${iceScore}` }] }],
      },
    ],
  });

  // Add monetary impact expected if set
  if (props.monetary_impact_expected) {
    content.content.push({
      type: 'paragraph',
      content: [{ type: 'text', text: `Expected Impact: ${props.monetary_impact_expected}` }],
    });
  }

  // Add sprints section
  if (sprints.length > 0) {
    content.content.push({
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: `Sprints (${sprints.length})` }],
    });
    content.content.push({
      type: 'bulletList',
      content: sprints.map(s => ({
        type: 'listItem',
        content: [{
          type: 'paragraph',
          content: [{ type: 'text', text: `Sprint ${s.sprint_number}: ${s.title}` }],
        }],
      })),
    });
  }

  // Add completed issues section
  if (completedIssues.length > 0) {
    content.content.push({
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: `Completed Issues (${completedIssues.length})` }],
    });
    content.content.push({
      type: 'bulletList',
      content: completedIssues.map(i => ({
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: i.title }] }],
      })),
    });
  }

  // Add active issues section if any remain
  if (activeIssues.length > 0) {
    content.content.push({
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: `Outstanding Issues (${activeIssues.length})` }],
    });
    content.content.push({
      type: 'bulletList',
      content: activeIssues.map(i => ({
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: `${i.title} (${i.state})` }] }],
      })),
    });
  }

  // Add cancelled issues section if any
  if (cancelledIssues.length > 0) {
    content.content.push({
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: `Cancelled Issues (${cancelledIssues.length})` }],
    });
    content.content.push({
      type: 'bulletList',
      content: cancelledIssues.map(i => ({
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: i.title }] }],
      })),
    });
  }

  // Add hypothesis validation section
  content.content.push({
    type: 'heading',
    attrs: { level: 3 },
    content: [{ type: 'text', text: 'Hypothesis Validation' }],
  });
  content.content.push({
    type: 'paragraph',
    content: [{ type: 'text', text: 'Was the hypothesis validated? (Set in properties)' }],
  });

  // Add monetary impact actual section
  content.content.push({
    type: 'heading',
    attrs: { level: 3 },
    content: [{ type: 'text', text: 'Actual Monetary Impact' }],
  });
  content.content.push({
    type: 'paragraph',
    content: [{ type: 'text', text: 'Document the actual monetary impact here.' }],
  });

  // Add key learnings section
  content.content.push({
    type: 'heading',
    attrs: { level: 3 },
    content: [{ type: 'text', text: 'Key Learnings' }],
  });
  content.content.push({
    type: 'paragraph',
    content: [{ type: 'text', text: 'What did we learn from this project?' }],
  });

  // Add next steps section
  content.content.push({
    type: 'heading',
    attrs: { level: 3 },
    content: [{ type: 'text', text: 'Next Steps' }],
  });
  content.content.push({
    type: 'paragraph',
    content: [{ type: 'text', text: 'What follow-up actions are recommended?' }],
  });

  return content;
}

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

    // Subquery to compute inferred status based on sprint relationships
    // Priority: archived (if archived_at set) > active (issues in active sprint) > planned (upcoming) > completed > backlog
    // Sprint status is computed from sprint_number + workspace.sprint_start_date:
    //   - active: today is within the sprint's 7-day window
    //   - upcoming: sprint hasn't started yet
    //   - completed: sprint window has passed
    const inferredStatusSubquery = `
      CASE
        WHEN d.archived_at IS NOT NULL THEN 'archived'
        ELSE COALESCE(
          (
            SELECT
              CASE MAX(
                CASE
                  -- Compute sprint status: active=3, upcoming=2, completed=1
                  WHEN CURRENT_DATE BETWEEN
                    (w.sprint_start_date + ((sprint.properties->>'sprint_number')::int - 1) * 7)
                    AND (w.sprint_start_date + ((sprint.properties->>'sprint_number')::int - 1) * 7 + 6)
                  THEN 3  -- active
                  WHEN CURRENT_DATE < (w.sprint_start_date + ((sprint.properties->>'sprint_number')::int - 1) * 7)
                  THEN 2  -- upcoming
                  ELSE 1  -- completed
                END
              )
              WHEN 3 THEN 'active'
              WHEN 2 THEN 'planned'
              WHEN 1 THEN 'completed'
              ELSE NULL
              END
            FROM documents issue
            JOIN documents sprint ON sprint.id = issue.sprint_id AND sprint.document_type = 'sprint'
            JOIN workspaces w ON w.id = d.workspace_id
            WHERE issue.project_id = d.id
              AND issue.document_type = 'issue'
              AND issue.sprint_id IS NOT NULL
          ),
          'backlog'
        )
      END
    `;

    let query = `
      SELECT d.id, d.title, d.properties, d.program_id, d.archived_at, d.created_at, d.updated_at,
             (d.properties->>'owner_id')::uuid as owner_id,
             u.name as owner_name, u.email as owner_email,
             (SELECT COUNT(*) FROM documents s WHERE s.project_id = d.id AND s.document_type = 'sprint') as sprint_count,
             (SELECT COUNT(*) FROM documents i WHERE i.project_id = d.id AND i.document_type = 'issue') as issue_count,
             (${inferredStatusSubquery}) as inferred_status
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

    // Same inferred status subquery as list endpoint
    const inferredStatusSubquery = `
      CASE
        WHEN d.archived_at IS NOT NULL THEN 'archived'
        ELSE COALESCE(
          (
            SELECT
              CASE MAX(
                CASE
                  WHEN CURRENT_DATE BETWEEN
                    (w.sprint_start_date + ((sprint.properties->>'sprint_number')::int - 1) * 7)
                    AND (w.sprint_start_date + ((sprint.properties->>'sprint_number')::int - 1) * 7 + 6)
                  THEN 3
                  WHEN CURRENT_DATE < (w.sprint_start_date + ((sprint.properties->>'sprint_number')::int - 1) * 7)
                  THEN 2
                  ELSE 1
                END
              )
              WHEN 3 THEN 'active'
              WHEN 2 THEN 'planned'
              WHEN 1 THEN 'completed'
              ELSE NULL
              END
            FROM documents issue
            JOIN documents sprint ON sprint.id = issue.sprint_id AND sprint.document_type = 'sprint'
            JOIN workspaces w ON w.id = d.workspace_id
            WHERE issue.project_id = d.id
              AND issue.document_type = 'issue'
              AND issue.sprint_id IS NOT NULL
          ),
          'backlog'
        )
      END
    `;

    const result = await pool.query(
      `SELECT d.id, d.title, d.properties, d.program_id, d.archived_at, d.created_at, d.updated_at,
              (d.properties->>'owner_id')::uuid as owner_id,
              u.name as owner_name, u.email as owner_email,
              (SELECT COUNT(*) FROM documents s WHERE s.project_id = d.id AND s.document_type = 'sprint') as sprint_count,
              (SELECT COUNT(*) FROM documents i WHERE i.project_id = d.id AND i.document_type = 'issue') as issue_count,
              (${inferredStatusSubquery}) as inferred_status
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

    // Calculate completeness for new project (no linked issues yet)
    const completeness = checkDocumentCompleteness('project', properties, 0);
    properties.is_complete = completeness.isComplete;
    properties.missing_fields = completeness.missingFields;

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
      ...extractProjectFromRow({ ...result.rows[0], inferred_status: 'backlog' }),
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
      // Recalculate completeness when properties change
      const completeness = checkDocumentCompleteness('project', newProps, 0);
      newProps.is_complete = completeness.isComplete;
      newProps.missing_fields = completeness.missingFields;

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

    // Re-query to get full project with owner info and inferred status
    const updateInferredStatusSubquery = `
      CASE
        WHEN d.archived_at IS NOT NULL THEN 'archived'
        ELSE COALESCE(
          (
            SELECT
              CASE MAX(
                CASE
                  WHEN CURRENT_DATE BETWEEN
                    (w.sprint_start_date + ((sprint.properties->>'sprint_number')::int - 1) * 7)
                    AND (w.sprint_start_date + ((sprint.properties->>'sprint_number')::int - 1) * 7 + 6)
                  THEN 3
                  WHEN CURRENT_DATE < (w.sprint_start_date + ((sprint.properties->>'sprint_number')::int - 1) * 7)
                  THEN 2
                  ELSE 1
                END
              )
              WHEN 3 THEN 'active'
              WHEN 2 THEN 'planned'
              WHEN 1 THEN 'completed'
              ELSE NULL
              END
            FROM documents issue
            JOIN documents sprint ON sprint.id = issue.sprint_id AND sprint.document_type = 'sprint'
            JOIN workspaces w ON w.id = d.workspace_id
            WHERE issue.project_id = d.id
              AND issue.document_type = 'issue'
              AND issue.sprint_id IS NOT NULL
          ),
          'backlog'
        )
      END
    `;

    const result = await pool.query(
      `SELECT d.id, d.title, d.properties, d.program_id, d.archived_at, d.created_at, d.updated_at,
              (d.properties->>'owner_id')::uuid as owner_id,
              u.name as owner_name, u.email as owner_email,
              (SELECT COUNT(*) FROM documents s WHERE s.project_id = d.id AND s.document_type = 'sprint') as sprint_count,
              (SELECT COUNT(*) FROM documents i WHERE i.project_id = d.id AND i.document_type = 'issue') as issue_count,
              (${updateInferredStatusSubquery}) as inferred_status
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

// GET /api/projects/:id/retro - Returns pre-filled draft or existing retro
router.get('/:id/retro', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Get project
    const projectResult = await pool.query(
      `SELECT id, title, content, properties FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'project'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (projectResult.rows.length === 0) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const projectData = projectResult.rows[0];
    const props = projectData.properties || {};

    // Check if retro has been filled (has hypothesis_validated set)
    const hasRetro = props.hypothesis_validated !== undefined && props.hypothesis_validated !== null;

    // Get sprints for this project
    const sprintsResult = await pool.query(
      `SELECT id, title, properties->>'sprint_number' as sprint_number
       FROM documents
       WHERE project_id = $1 AND document_type = 'sprint'
       ORDER BY (properties->>'sprint_number')::int ASC`,
      [id]
    );

    // Get issues for this project
    const issuesResult = await pool.query(
      `SELECT id, title, properties->>'state' as state
       FROM documents
       WHERE project_id = $1 AND document_type = 'issue'`,
      [id]
    );

    if (hasRetro) {
      // Return existing retro data
      res.json({
        is_draft: false,
        hypothesis_validated: props.hypothesis_validated,
        monetary_impact_expected: props.monetary_impact_expected || null,
        monetary_impact_actual: props.monetary_impact_actual || null,
        success_criteria: props.success_criteria || [],
        next_steps: props.next_steps || null,
        content: projectData.content || {},
        sprints: sprintsResult.rows,
        issues_summary: {
          total: issuesResult.rows.length,
          completed: issuesResult.rows.filter((i: any) => i.state === 'done').length,
          cancelled: issuesResult.rows.filter((i: any) => i.state === 'cancelled').length,
          active: issuesResult.rows.filter((i: any) => !['done', 'cancelled'].includes(i.state)).length,
        },
      });
    } else {
      // Generate pre-filled draft
      const prefilledContent = await generatePrefilledRetroContent(
        projectData,
        sprintsResult.rows,
        issuesResult.rows
      );

      res.json({
        is_draft: true,
        hypothesis_validated: null,
        monetary_impact_expected: props.monetary_impact_expected || null,
        monetary_impact_actual: null,
        success_criteria: [],
        next_steps: null,
        content: prefilledContent,
        sprints: sprintsResult.rows,
        issues_summary: {
          total: issuesResult.rows.length,
          completed: issuesResult.rows.filter((i: any) => i.state === 'done').length,
          cancelled: issuesResult.rows.filter((i: any) => i.state === 'cancelled').length,
          active: issuesResult.rows.filter((i: any) => !['done', 'cancelled'].includes(i.state)).length,
        },
      });
    }
  } catch (err) {
    console.error('Get project retro error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/projects/:id/retro - Creates finalized project retro
router.post('/:id/retro', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    const parsed = projectRetroSchema.safeParse(req.body);
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
    const { hypothesis_validated, monetary_impact_actual, success_criteria, next_steps, content } = parsed.data;

    // Update properties with retro data
    const newProps = {
      ...currentProps,
      hypothesis_validated: hypothesis_validated ?? currentProps.hypothesis_validated,
      monetary_impact_actual: monetary_impact_actual ?? currentProps.monetary_impact_actual,
      success_criteria: success_criteria ?? currentProps.success_criteria,
      next_steps: next_steps ?? currentProps.next_steps,
    };

    // Update project with retro properties and optional content
    const updates: string[] = ['properties = $1', 'updated_at = now()'];
    const values: any[] = [JSON.stringify(newProps)];

    if (content) {
      updates.push('content = $2');
      values.push(JSON.stringify(content));
    }

    await pool.query(
      `UPDATE documents SET ${updates.join(', ')}
       WHERE id = $${values.length + 1} AND workspace_id = $${values.length + 2} AND document_type = 'project'`,
      [...values, id, workspaceId]
    );

    // Re-query to get updated data
    const result = await pool.query(
      `SELECT id, title, content, properties FROM documents WHERE id = $1`,
      [id]
    );

    const updatedProps = result.rows[0].properties || {};
    res.status(201).json({
      is_draft: false,
      hypothesis_validated: updatedProps.hypothesis_validated,
      monetary_impact_expected: updatedProps.monetary_impact_expected || null,
      monetary_impact_actual: updatedProps.monetary_impact_actual || null,
      success_criteria: updatedProps.success_criteria || [],
      next_steps: updatedProps.next_steps || null,
      content: result.rows[0].content || {},
    });
  } catch (err) {
    console.error('Create project retro error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/projects/:id/retro - Updates existing project retro
router.patch('/:id/retro', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    const parsed = projectRetroSchema.safeParse(req.body);
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
    const { hypothesis_validated, monetary_impact_actual, success_criteria, next_steps, content } = parsed.data;

    // Update properties with retro data (only update fields that are provided)
    const newProps = { ...currentProps };
    if (hypothesis_validated !== undefined) {
      newProps.hypothesis_validated = hypothesis_validated;
    }
    if (monetary_impact_actual !== undefined) {
      newProps.monetary_impact_actual = monetary_impact_actual;
    }
    if (success_criteria !== undefined) {
      newProps.success_criteria = success_criteria;
    }
    if (next_steps !== undefined) {
      newProps.next_steps = next_steps;
    }

    // Update project with retro properties and optional content
    const updates: string[] = ['properties = $1', 'updated_at = now()'];
    const values: any[] = [JSON.stringify(newProps)];

    if (content !== undefined) {
      updates.push('content = $2');
      values.push(JSON.stringify(content));
    }

    await pool.query(
      `UPDATE documents SET ${updates.join(', ')}
       WHERE id = $${values.length + 1} AND workspace_id = $${values.length + 2} AND document_type = 'project'`,
      [...values, id, workspaceId]
    );

    // Re-query to get updated data
    const result = await pool.query(
      `SELECT id, title, content, properties FROM documents WHERE id = $1`,
      [id]
    );

    const updatedProps = result.rows[0].properties || {};
    res.json({
      is_draft: false,
      hypothesis_validated: updatedProps.hypothesis_validated,
      monetary_impact_expected: updatedProps.monetary_impact_expected || null,
      monetary_impact_actual: updatedProps.monetary_impact_actual || null,
      success_criteria: updatedProps.success_criteria || [],
      next_steps: updatedProps.next_steps || null,
      content: result.rows[0].content || {},
    });
  } catch (err) {
    console.error('Update project retro error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
