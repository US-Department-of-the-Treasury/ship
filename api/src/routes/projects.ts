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
  // ICE values can be null (not yet set) - don't default to 3
  const impact = props.impact !== undefined ? props.impact : null;
  const confidence = props.confidence !== undefined ? props.confidence : null;
  const ease = props.ease !== undefined ? props.ease : null;

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
    // Conversion tracking
    converted_from_id: row.converted_from_id || null,
  };
}

// Validation schemas
const iceScoreSchema = z.number().int().min(1).max(5);

const createProjectSchema = z.object({
  title: z.string().min(1).max(200).optional().default('Untitled'),
  impact: iceScoreSchema.optional().nullable().default(null),
  confidence: iceScoreSchema.optional().nullable().default(null),
  ease: iceScoreSchema.optional().nullable().default(null),
  owner_id: z.string().uuid().optional().nullable().default(null), // Optional - can be unassigned
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().default('#6366f1'),
  emoji: z.string().max(10).optional().nullable(),
  program_id: z.string().uuid().optional().nullable(),
  hypothesis: z.string().max(2000).optional().nullable(),
  target_date: z.string().datetime().optional().nullable(),
});

const updateProjectSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  impact: iceScoreSchema.optional().nullable(),
  confidence: iceScoreSchema.optional().nullable(),
  ease: iceScoreSchema.optional().nullable(),
  owner_id: z.string().uuid().optional().nullable(), // Can be cleared (set to null)
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  emoji: z.string().max(10).optional().nullable(),
  program_id: z.string().uuid().optional().nullable(),
  archived_at: z.string().datetime().optional().nullable(),
  hypothesis: z.string().max(2000).optional().nullable(),
  target_date: z.string().datetime().optional().nullable(),
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
  const impact = props.impact;
  const confidence = props.confidence;
  const ease = props.ease;
  const iceScore = (impact !== null && confidence !== null && ease !== null)
    ? impact * confidence * ease
    : null;

  const formatIceValue = (val: number | null) => val !== null ? `${val}/5` : 'Not set';
  const formatIceScore = (val: number | null) => val !== null ? String(val) : 'Not set';

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
        content: [{ type: 'paragraph', content: [{ type: 'text', text: `Impact: ${formatIceValue(impact)}` }] }],
      },
      {
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: `Confidence: ${formatIceValue(confidence)}` }] }],
      },
      {
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: `Ease: ${formatIceValue(ease)}` }] }],
      },
      {
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: `ICE Score: ${formatIceScore(iceScore)}` }] }],
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
             d.converted_from_id,
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
              d.converted_to_id, d.converted_from_id,
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

    const row = result.rows[0];

    // Check if project was converted - redirect to new document
    if (row.converted_to_id) {
      // Fetch the new document to determine its type for proper routing
      const newDocResult = await pool.query(
        'SELECT id, document_type FROM documents WHERE id = $1 AND workspace_id = $2',
        [row.converted_to_id, workspaceId]
      );

      if (newDocResult.rows.length > 0) {
        const newDoc = newDocResult.rows[0];
        // Return 301 with Location header to the new document's API endpoint
        // Include X-Converted-Type header so frontend knows the target type for routing
        res.set('X-Converted-Type', newDoc.document_type);
        res.set('X-Converted-To', newDoc.id);
        res.redirect(301, `/api/${newDoc.document_type}s/${newDoc.id}`);
        return;
      }
    }

    res.json(extractProjectFromRow(row));
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

    const { title, impact, confidence, ease, owner_id, color, emoji, program_id, hypothesis, target_date } = parsed.data;

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
    if (hypothesis) {
      properties.hypothesis = hypothesis;
    }
    if (target_date) {
      properties.target_date = target_date;
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

    // Get user info for owner response (only if owner_id is set)
    let owner = null;
    if (owner_id) {
      const userResult = await pool.query(
        'SELECT id, name, email FROM users WHERE id = $1',
        [owner_id]
      );
      const user = userResult.rows[0];
      if (user) {
        owner = {
          id: user.id,
          name: user.name,
          email: user.email,
        };
      }
    }

    res.status(201).json({
      ...extractProjectFromRow({ ...result.rows[0], inferred_status: 'backlog' }),
      sprint_count: 0,
      issue_count: 0,
      owner,
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

    if (data.hypothesis !== undefined) {
      newProps.hypothesis = data.hypothesis;
      propsChanged = true;
    }

    if (data.target_date !== undefined) {
      newProps.target_date = data.target_date;
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
              d.converted_from_id,
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

// ============================================
// Sprint Endpoints - Sprints under projects
// ============================================

// Schema for creating a sprint under a project
const createProjectSprintSchema = z.object({
  title: z.string().min(1).max(200).optional().default('Untitled'),
  sprint_number: z.number().int().positive().optional(), // Auto-incremented if not provided
  owner_id: z.string().uuid().optional(),
  goal: z.string().max(500).optional(),
  hypothesis: z.string().max(2000).optional(),
  success_criteria: z.array(z.string().max(500)).max(20).optional(),
  confidence: z.number().int().min(0).max(100).optional(),
});

// Helper to extract sprint from row (matches sprints.ts pattern)
function extractSprintFromRow(row: any) {
  const props = row.properties || {};
  return {
    id: row.id,
    name: row.title,
    sprint_number: props.sprint_number || 1,
    owner: row.owner_id ? {
      id: row.owner_id,
      name: row.owner_name,
      email: row.owner_email,
    } : null,
    project_id: row.project_id || null,
    project_name: row.project_name || null,
    program_id: row.program_id,
    program_name: row.program_name,
    program_prefix: row.program_prefix,
    workspace_sprint_start_date: row.workspace_sprint_start_date,
    issue_count: parseInt(row.issue_count) || 0,
    completed_count: parseInt(row.completed_count) || 0,
    started_count: parseInt(row.started_count) || 0,
    goal: props.goal || null,
    hypothesis: props.hypothesis || null,
    success_criteria: props.success_criteria || null,
    confidence: typeof props.confidence === 'number' ? props.confidence : null,
  };
}

// GET /api/projects/:id/issues - List issues for a project
router.get('/:id/issues', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify project exists and user can access it
    const projectCheck = await pool.query(
      `SELECT id FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'project'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (projectCheck.rows.length === 0) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Get issues associated with this project via junction table
    const result = await pool.query(
      `SELECT d.id, d.title, d.properties, d.ticket_number,
              d.created_at, d.updated_at,
              d.started_at, d.completed_at, d.cancelled_at,
              u.name as assignee_name
       FROM documents d
       JOIN document_associations da ON da.document_id = d.id
         AND da.related_id = $1 AND da.relationship_type = 'project'
       LEFT JOIN users u ON (d.properties->>'assignee_id')::uuid = u.id
       WHERE d.workspace_id = $2 AND d.document_type = 'issue'
         AND d.archived_at IS NULL AND d.deleted_at IS NULL
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}
       ORDER BY
         CASE d.properties->>'priority'
           WHEN 'urgent' THEN 1
           WHEN 'high' THEN 2
           WHEN 'medium' THEN 3
           WHEN 'low' THEN 4
           ELSE 5
         END,
         d.updated_at DESC`,
      [id, workspaceId, userId, isAdmin]
    );

    // Transform rows to issue objects
    const issues = result.rows.map(row => {
      const props = row.properties || {};
      return {
        id: row.id,
        title: row.title,
        ticket_number: row.ticket_number,
        state: props.state || 'backlog',
        priority: props.priority || 'medium',
        assignee_id: props.assignee_id || null,
        assignee_name: row.assignee_name,
        created_at: row.created_at,
        updated_at: row.updated_at,
        started_at: row.started_at,
        completed_at: row.completed_at,
        cancelled_at: row.cancelled_at,
      };
    });

    res.json(issues);
  } catch (err) {
    console.error('Get project issues error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/projects/:id/sprints - List sprints for a project
router.get('/:id/sprints', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify project exists and user can access it
    const projectCheck = await pool.query(
      `SELECT id FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'project'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (projectCheck.rows.length === 0) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Get sprints associated with this project via junction table
    const result = await pool.query(
      `SELECT d.id, d.title, d.properties, d.program_id,
              p.title as program_name, p.properties->>'prefix' as program_prefix,
              w.sprint_start_date as workspace_sprint_start_date,
              proj.id as project_id, proj.title as project_name,
              u.id as owner_id, u.name as owner_name, u.email as owner_email,
              (SELECT COUNT(*) FROM documents i WHERE i.sprint_id = d.id AND i.document_type = 'issue') as issue_count,
              (SELECT COUNT(*) FROM documents i WHERE i.sprint_id = d.id AND i.document_type = 'issue' AND i.properties->>'state' = 'done') as completed_count,
              (SELECT COUNT(*) FROM documents i WHERE i.sprint_id = d.id AND i.document_type = 'issue' AND i.properties->>'state' IN ('in_progress', 'in_review')) as started_count
       FROM documents d
       JOIN document_associations da ON da.document_id = d.id AND da.related_id = $1 AND da.relationship_type = 'project'
       LEFT JOIN documents p ON d.program_id = p.id
       LEFT JOIN documents proj ON proj.id = $1
       JOIN workspaces w ON d.workspace_id = w.id
       LEFT JOIN users u ON (d.properties->>'owner_id')::uuid = u.id
       WHERE d.workspace_id = $2 AND d.document_type = 'sprint'
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}
       ORDER BY (d.properties->>'sprint_number')::int DESC`,
      [id, workspaceId, userId, isAdmin]
    );

    res.json(result.rows.map(extractSprintFromRow));
  } catch (err) {
    console.error('Get project sprints error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/projects/:id/sprints - Create a sprint associated with a project
router.post('/:id/sprints', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    const parsed = createProjectSprintSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
      return;
    }

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify project exists, user can access it, and get workspace info
    const projectCheck = await pool.query(
      `SELECT d.id, d.program_id, w.sprint_start_date
       FROM documents d
       JOIN workspaces w ON d.workspace_id = w.id
       WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'project'
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (projectCheck.rows.length === 0) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const project = projectCheck.rows[0];
    const { title, owner_id, goal, hypothesis, success_criteria, confidence } = parsed.data;
    let { sprint_number } = parsed.data;

    // If sprint_number not provided, auto-increment based on project's existing sprints
    if (!sprint_number) {
      const maxSprintResult = await pool.query(
        `SELECT MAX((d.properties->>'sprint_number')::int) as max_sprint
         FROM documents d
         JOIN document_associations da ON da.document_id = d.id AND da.related_id = $1 AND da.relationship_type = 'project'
         WHERE d.document_type = 'sprint'`,
        [id]
      );
      sprint_number = (maxSprintResult.rows[0]?.max_sprint || 0) + 1;
    }

    // Check if sprint number already exists for this project
    const existingCheck = await pool.query(
      `SELECT d.id FROM documents d
       JOIN document_associations da ON da.document_id = d.id AND da.related_id = $1 AND da.relationship_type = 'project'
       WHERE d.document_type = 'sprint' AND (d.properties->>'sprint_number')::int = $2`,
      [id, sprint_number]
    );

    if (existingCheck.rows.length > 0) {
      res.status(400).json({ error: `Sprint ${sprint_number} already exists for this project` });
      return;
    }

    // Verify owner exists in workspace (if provided)
    let ownerData = null;
    if (owner_id) {
      const ownerCheck = await pool.query(
        `SELECT u.id, u.name, u.email FROM users u
         JOIN workspace_memberships wm ON wm.user_id = u.id
         WHERE u.id = $1 AND wm.workspace_id = $2`,
        [owner_id, workspaceId]
      );

      if (ownerCheck.rows.length === 0) {
        res.status(400).json({ error: 'Owner not found in workspace' });
        return;
      }
      ownerData = ownerCheck.rows[0];
    }

    // Build properties JSONB
    const properties: Record<string, unknown> = { sprint_number };
    if (owner_id) properties.owner_id = owner_id;
    if (goal) properties.goal = goal;
    if (hypothesis) {
      properties.hypothesis = hypothesis;
      properties.hypothesis_history = [{
        hypothesis,
        timestamp: new Date().toISOString(),
        author_id: userId,
      }];
    }
    if (success_criteria) properties.success_criteria = success_criteria;
    if (confidence !== undefined) properties.confidence = confidence;

    // Create the sprint document
    // Use project's program_id for backward compatibility
    const result = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, program_id, properties, created_by)
       VALUES ($1, 'sprint', $2, $3, $4, $5)
       RETURNING id, title, properties, program_id`,
      [workspaceId, title, project.program_id, JSON.stringify(properties), userId]
    );

    const sprint = result.rows[0];

    // Create association in junction table
    await pool.query(
      `INSERT INTO document_associations (document_id, related_id, relationship_type, metadata)
       VALUES ($1, $2, 'project', $3)
       ON CONFLICT (document_id, related_id, relationship_type) DO NOTHING`,
      [sprint.id, id, JSON.stringify({ created_via: 'POST /api/projects/:id/sprints' })]
    );

    res.status(201).json({
      id: sprint.id,
      name: sprint.title,
      sprint_number,
      owner: ownerData ? {
        id: ownerData.id,
        name: ownerData.name,
        email: ownerData.email,
      } : null,
      project_id: id,
      program_id: project.program_id,
      workspace_sprint_start_date: project.sprint_start_date,
      issue_count: 0,
      completed_count: 0,
      started_count: 0,
      goal: properties.goal || null,
      hypothesis: properties.hypothesis || null,
      success_criteria: properties.success_criteria || null,
      confidence: properties.confidence ?? null,
    });
  } catch (err) {
    console.error('Create project sprint error:', err);
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
