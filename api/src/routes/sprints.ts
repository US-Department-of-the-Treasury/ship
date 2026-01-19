import { Router, Request, Response } from 'express';
import { pool } from '../db/client.js';
import { z } from 'zod';
import { getVisibilityContext, VISIBILITY_FILTER_SQL } from '../middleware/visibility.js';
import { authMiddleware } from '../middleware/auth.js';
import { transformIssueLinks } from '../utils/transformIssueLinks.js';

type RouterType = ReturnType<typeof Router>;
const router: RouterType = Router();

// Validation schemas
// Sprint properties: sprint_number, owner_id, and hypothesis fields
// Dates and status are computed from sprint_number + workspace.sprint_start_date
const createSprintSchema = z.object({
  program_id: z.string().uuid(),
  title: z.string().min(1).max(200).optional().default('Untitled'),
  sprint_number: z.number().int().positive(),
  owner_id: z.string().uuid(),
  // Sprint goal (concise objective, separate from hypothesis)
  goal: z.string().max(500).optional(),
  // Hypothesis tracking (optional at creation)
  hypothesis: z.string().max(2000).optional(),
  success_criteria: z.array(z.string().max(500)).max(20).optional(),
  confidence: z.number().int().min(0).max(100).optional(),
});

const updateSprintSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  owner_id: z.string().uuid().optional(),
});

// Separate schema for hypothesis updates (append mode)
const updateHypothesisSchema = z.object({
  hypothesis: z.string().max(2000).optional(),
  success_criteria: z.array(z.string().max(500)).max(20).optional(),
  confidence: z.number().int().min(0).max(100).optional(),
});

// Helper to extract sprint from row
// Dates and status are computed on frontend from sprint_number + workspace.sprint_start_date
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
    program_id: row.program_id,
    program_name: row.program_name,
    program_prefix: row.program_prefix,
    workspace_sprint_start_date: row.workspace_sprint_start_date,
    issue_count: parseInt(row.issue_count) || 0,
    completed_count: parseInt(row.completed_count) || 0,
    started_count: parseInt(row.started_count) || 0,
    has_plan: row.has_plan === true || row.has_plan === 't',
    has_retro: row.has_retro === true || row.has_retro === 't',
    // Retro outcome summary (populated if retro exists)
    retro_outcome: row.retro_outcome || null,
    retro_id: row.retro_id || null,
    // Sprint goal (concise objective)
    goal: props.goal || null,
    // Hypothesis tracking fields
    hypothesis: props.hypothesis || null,
    success_criteria: props.success_criteria || null,
    confidence: typeof props.confidence === 'number' ? props.confidence : null,
    hypothesis_history: props.hypothesis_history || null,
    // Completeness flags
    is_complete: props.is_complete ?? null,
    missing_fields: props.missing_fields ?? [],
  };
}

// Get all active sprints across the workspace
// Active = sprint_number matches the current 7-day window based on workspace.sprint_start_date
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // First, get the workspace sprint_start_date to calculate current sprint number
    const workspaceResult = await pool.query(
      `SELECT sprint_start_date FROM workspaces WHERE id = $1`,
      [workspaceId]
    );

    if (workspaceResult.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const rawStartDate = workspaceResult.rows[0].sprint_start_date;
    const sprintDuration = 7; // 7-day sprints

    // Calculate the current sprint number
    let workspaceStartDate: Date;
    if (rawStartDate instanceof Date) {
      workspaceStartDate = new Date(Date.UTC(rawStartDate.getFullYear(), rawStartDate.getMonth(), rawStartDate.getDate()));
    } else if (typeof rawStartDate === 'string') {
      workspaceStartDate = new Date(rawStartDate + 'T00:00:00Z');
    } else {
      workspaceStartDate = new Date();
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const daysSinceStart = Math.floor((today.getTime() - workspaceStartDate.getTime()) / (1000 * 60 * 60 * 24));
    const currentSprintNumber = Math.floor(daysSinceStart / sprintDuration) + 1;

    // Calculate days remaining in current sprint
    const currentSprintStart = new Date(workspaceStartDate);
    currentSprintStart.setUTCDate(currentSprintStart.getUTCDate() + (currentSprintNumber - 1) * sprintDuration);
    const currentSprintEnd = new Date(currentSprintStart);
    currentSprintEnd.setUTCDate(currentSprintEnd.getUTCDate() + sprintDuration - 1);
    const daysRemaining = Math.max(0, Math.ceil((currentSprintEnd.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)) + 1);

    // Get all sprints that match the current sprint number
    const result = await pool.query(
      `SELECT d.id, d.title, d.properties, d.program_id,
              p.title as program_name, p.properties->>'prefix' as program_prefix,
              $5::timestamp as workspace_sprint_start_date,
              u.id as owner_id, u.name as owner_name, u.email as owner_email,
              (SELECT COUNT(*) FROM documents i WHERE i.sprint_id = d.id AND i.document_type = 'issue') as issue_count,
              (SELECT COUNT(*) FROM documents i WHERE i.sprint_id = d.id AND i.document_type = 'issue' AND i.properties->>'state' = 'done') as completed_count,
              (SELECT COUNT(*) FROM documents i WHERE i.sprint_id = d.id AND i.document_type = 'issue' AND i.properties->>'state' IN ('in_progress', 'in_review')) as started_count,
              (SELECT COUNT(*) > 0 FROM documents pl WHERE pl.parent_id = d.id AND pl.document_type = 'sprint_plan') as has_plan,
              (SELECT COUNT(*) > 0 FROM documents rt WHERE rt.sprint_id = d.id AND rt.properties->>'outcome' IS NOT NULL) as has_retro,
              (SELECT rt.properties->>'outcome' FROM documents rt WHERE rt.sprint_id = d.id AND rt.properties->>'outcome' IS NOT NULL LIMIT 1) as retro_outcome,
              (SELECT rt.id FROM documents rt WHERE rt.sprint_id = d.id AND rt.properties->>'outcome' IS NOT NULL LIMIT 1) as retro_id
       FROM documents d
       JOIN documents p ON d.program_id = p.id
       LEFT JOIN users u ON (d.properties->>'owner_id')::uuid = u.id
       WHERE d.workspace_id = $1 AND d.document_type = 'sprint'
         AND (d.properties->>'sprint_number')::int = $2
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}
       ORDER BY (d.properties->>'sprint_number')::int, p.title`,
      [workspaceId, currentSprintNumber, userId, isAdmin, rawStartDate]
    );

    const sprints = result.rows.map(row => ({
      ...extractSprintFromRow(row),
      days_remaining: daysRemaining,
      status: 'active' as const,
    }));

    res.json({
      sprints,
      current_sprint_number: currentSprintNumber,
      days_remaining: daysRemaining,
      sprint_start_date: currentSprintStart.toISOString().split('T')[0],
      sprint_end_date: currentSprintEnd.toISOString().split('T')[0],
    });
  } catch (err) {
    console.error('Get active sprints error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get action items for current user (sprints needing docs)
// Returns sprints owned by the user that need plan or retro
router.get('/my-action-items', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Get workspace sprint configuration
    const workspaceResult = await pool.query(
      `SELECT sprint_start_date FROM workspaces WHERE id = $1`,
      [workspaceId]
    );

    if (workspaceResult.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const rawStartDate = workspaceResult.rows[0].sprint_start_date;
    const sprintDuration = 7; // 7-day sprints

    // Calculate the current sprint number
    let workspaceStartDate: Date;
    if (rawStartDate instanceof Date) {
      workspaceStartDate = new Date(Date.UTC(rawStartDate.getFullYear(), rawStartDate.getMonth(), rawStartDate.getDate()));
    } else if (typeof rawStartDate === 'string') {
      workspaceStartDate = new Date(rawStartDate + 'T00:00:00Z');
    } else {
      workspaceStartDate = new Date();
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const daysSinceStart = Math.floor((today.getTime() - workspaceStartDate.getTime()) / (1000 * 60 * 60 * 24));
    const currentSprintNumber = Math.floor(daysSinceStart / sprintDuration) + 1;

    // Get sprints owned by this user that need either plan or retro
    // Include current sprint (for plans) and recent past sprints (for retros)
    const result = await pool.query(
      `SELECT d.id, d.title, d.properties, d.program_id,
              p.title as program_name,
              (d.properties->>'sprint_number')::int as sprint_number,
              (SELECT COUNT(*) > 0 FROM documents pl WHERE pl.parent_id = d.id AND pl.document_type = 'sprint_plan') as has_plan,
              (SELECT COUNT(*) > 0 FROM documents rt WHERE rt.sprint_id = d.id AND rt.properties->>'outcome' IS NOT NULL) as has_retro
       FROM documents d
       JOIN documents p ON d.program_id = p.id
       WHERE d.workspace_id = $1
         AND d.document_type = 'sprint'
         AND (d.properties->>'owner_id')::uuid = $2
         AND (d.properties->>'sprint_number')::int >= $3 - 3
         AND (d.properties->>'sprint_number')::int <= $3
       ORDER BY (d.properties->>'sprint_number')::int DESC`,
      [workspaceId, userId, currentSprintNumber]
    );

    interface ActionItem {
      id: string;
      type: 'plan' | 'retro';
      sprint_id: string;
      sprint_title: string;
      program_id: string;
      program_name: string;
      sprint_number: number;
      urgency: 'overdue' | 'due_today' | 'due_soon' | 'upcoming';
      days_until_due: number;
      message: string;
    }

    const actionItems: ActionItem[] = [];

    for (const row of result.rows) {
      const sprintNumber = parseInt(row.sprint_number, 10);
      const hasPlan = row.has_plan === true || row.has_plan === 't';
      const hasRetro = row.has_retro === true || row.has_retro === 't';

      // Calculate sprint dates
      const sprintStart = new Date(workspaceStartDate);
      sprintStart.setUTCDate(sprintStart.getUTCDate() + (sprintNumber - 1) * sprintDuration);
      const sprintEnd = new Date(sprintStart);
      sprintEnd.setUTCDate(sprintEnd.getUTCDate() + sprintDuration - 1);

      // Days into current sprint (for plan urgency)
      const daysIntoSprint = Math.floor((today.getTime() - sprintStart.getTime()) / (1000 * 60 * 60 * 24));
      // Days since sprint ended (for retro urgency)
      const daysSinceEnd = Math.floor((today.getTime() - sprintEnd.getTime()) / (1000 * 60 * 60 * 24));

      // Check for missing sprint plan (active sprint only)
      if (sprintNumber === currentSprintNumber && !hasPlan) {
        let urgency: ActionItem['urgency'] = 'upcoming';
        let message = 'Write sprint plan';

        if (daysIntoSprint >= 3) {
          urgency = 'overdue';
          message = `Sprint plan is ${daysIntoSprint - 2} days overdue`;
        } else if (daysIntoSprint >= 2) {
          urgency = 'due_today';
          message = 'Sprint plan due today';
        } else if (daysIntoSprint >= 1) {
          urgency = 'due_soon';
          message = 'Sprint plan due tomorrow';
        }

        actionItems.push({
          id: `plan-${row.id}`,
          type: 'plan',
          sprint_id: row.id,
          sprint_title: row.title || `Sprint ${sprintNumber}`,
          program_id: row.program_id,
          program_name: row.program_name,
          sprint_number: sprintNumber,
          urgency,
          days_until_due: Math.max(0, 2 - daysIntoSprint),
          message,
        });
      }

      // Check for missing retro (past sprints only)
      if (sprintNumber < currentSprintNumber && !hasRetro) {
        let urgency: ActionItem['urgency'] = 'upcoming';
        let message = 'Write sprint retro';

        if (daysSinceEnd > 3) {
          urgency = 'overdue';
          message = `Sprint retro is ${daysSinceEnd - 3} days overdue`;
        } else if (daysSinceEnd === 3) {
          urgency = 'due_today';
          message = 'Sprint retro due today';
        } else if (daysSinceEnd >= 1) {
          urgency = 'due_soon';
          message = `Sprint retro due in ${3 - daysSinceEnd} days`;
        }

        actionItems.push({
          id: `retro-${row.id}`,
          type: 'retro',
          sprint_id: row.id,
          sprint_title: row.title || `Sprint ${sprintNumber}`,
          program_id: row.program_id,
          program_name: row.program_name,
          sprint_number: sprintNumber,
          urgency,
          days_until_due: Math.max(0, 3 - daysSinceEnd),
          message,
        });
      }
    }

    // Sort by urgency (overdue first, then due_today, due_soon, upcoming)
    const urgencyOrder = { overdue: 0, due_today: 1, due_soon: 2, upcoming: 3 };
    actionItems.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency]);

    res.json({ action_items: actionItems });
  } catch (err) {
    console.error('Get my action items error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single sprint
router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    const result = await pool.query(
      `SELECT d.id, d.title, d.properties, d.program_id,
              p.title as program_name, p.properties->>'prefix' as program_prefix,
              w.sprint_start_date as workspace_sprint_start_date,
              u.id as owner_id, u.name as owner_name, u.email as owner_email,
              (SELECT COUNT(*) FROM documents i WHERE i.sprint_id = d.id AND i.document_type = 'issue') as issue_count,
              (SELECT COUNT(*) FROM documents i WHERE i.sprint_id = d.id AND i.document_type = 'issue' AND i.properties->>'state' = 'done') as completed_count,
              (SELECT COUNT(*) FROM documents i WHERE i.sprint_id = d.id AND i.document_type = 'issue' AND i.properties->>'state' IN ('in_progress', 'in_review')) as started_count,
              (SELECT COUNT(*) > 0 FROM documents pl WHERE pl.parent_id = d.id AND pl.document_type = 'sprint_plan') as has_plan,
              (SELECT COUNT(*) > 0 FROM documents rt WHERE rt.sprint_id = d.id AND rt.properties->>'outcome' IS NOT NULL) as has_retro,
              (SELECT rt.properties->>'outcome' FROM documents rt WHERE rt.sprint_id = d.id AND rt.properties->>'outcome' IS NOT NULL LIMIT 1) as retro_outcome,
              (SELECT rt.id FROM documents rt WHERE rt.sprint_id = d.id AND rt.properties->>'outcome' IS NOT NULL LIMIT 1) as retro_id
       FROM documents d
       JOIN documents p ON d.program_id = p.id
       JOIN workspaces w ON d.workspace_id = w.id
       LEFT JOIN users u ON (d.properties->>'owner_id')::uuid = u.id
       WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'sprint'
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
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
// Only stores sprint_number and owner_id - dates/status computed from sprint_number
router.post('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    const parsed = createSprintSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
      return;
    }

    const { program_id, title, sprint_number, owner_id, goal, hypothesis, success_criteria, confidence } = parsed.data;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify program belongs to workspace, user can access it, and get workspace info
    const programCheck = await pool.query(
      `SELECT d.id, w.sprint_start_date
       FROM documents d
       JOIN workspaces w ON d.workspace_id = w.id
       WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'program'
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
      [program_id, workspaceId, userId, isAdmin]
    );

    if (programCheck.rows.length === 0) {
      res.status(404).json({ error: 'Program not found' });
      return;
    }

    // Verify owner exists in workspace
    const ownerCheck = await pool.query(
      `SELECT u.id, u.name, u.email FROM users u
       JOIN workspace_memberships wm ON wm.user_id = u.id
       WHERE u.id = $1 AND wm.workspace_id = $2`,
      [owner_id, req.workspaceId]
    );

    if (ownerCheck.rows.length === 0) {
      res.status(400).json({ error: 'Owner not found in workspace' });
      return;
    }

    // Check if sprint already exists for this program + sprint_number
    const existingCheck = await pool.query(
      `SELECT id FROM documents
       WHERE program_id = $1 AND document_type = 'sprint' AND (properties->>'sprint_number')::int = $2`,
      [program_id, sprint_number]
    );

    if (existingCheck.rows.length > 0) {
      res.status(400).json({ error: `Sprint ${sprint_number} already exists for this program` });
      return;
    }

    // Build properties JSONB - sprint_number, owner_id, goal, and hypothesis fields
    const properties: Record<string, unknown> = {
      sprint_number,
      owner_id,
    };

    // Add goal if provided (concise objective, separate from hypothesis)
    if (goal !== undefined) {
      properties.goal = goal;
    }

    // Add hypothesis fields if provided
    if (hypothesis !== undefined) {
      properties.hypothesis = hypothesis;
      // Initialize hypothesis_history with the initial hypothesis
      properties.hypothesis_history = [{
        hypothesis,
        timestamp: new Date().toISOString(),
        author_id: userId,
      }];
    }
    if (success_criteria !== undefined) {
      properties.success_criteria = success_criteria;
    }
    if (confidence !== undefined) {
      properties.confidence = confidence;
    }

    const result = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, program_id, properties, created_by)
       VALUES ($1, 'sprint', $2, $3, $4, $5)
       RETURNING id, title, properties, program_id`,
      [req.workspaceId, title, program_id, JSON.stringify(properties), req.userId]
    );

    const owner = ownerCheck.rows[0];
    const sprintStartDate = programCheck.rows[0].sprint_start_date;

    res.status(201).json({
      id: result.rows[0].id,
      name: result.rows[0].title,
      sprint_number,
      owner: {
        id: owner.id,
        name: owner.name,
        email: owner.email,
      },
      program_id,
      workspace_sprint_start_date: sprintStartDate,
      issue_count: 0,
      completed_count: 0,
      started_count: 0,
      // Sprint goal (concise objective)
      goal: properties.goal || null,
      // Hypothesis tracking fields
      hypothesis: properties.hypothesis || null,
      success_criteria: properties.success_criteria || null,
      confidence: properties.confidence ?? null,
      hypothesis_history: properties.hypothesis_history || null,
    });
  } catch (err) {
    console.error('Create sprint error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update sprint - only title and owner_id can be updated
// sprint_number cannot be changed (determines window), dates/status are computed
router.patch('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    const parsed = updateSprintSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
      return;
    }

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify sprint exists and user can access it
    const existing = await pool.query(
      `SELECT id, properties FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'sprint'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
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

    // Handle owner_id update (in properties)
    const newProps = { ...currentProps };
    let propsChanged = false;

    if (data.owner_id !== undefined) {
      // Verify owner exists in workspace
      const ownerCheck = await pool.query(
        `SELECT u.id FROM users u
         JOIN workspace_memberships wm ON wm.user_id = u.id
         WHERE u.id = $1 AND wm.workspace_id = $2`,
        [data.owner_id, req.workspaceId]
      );

      if (ownerCheck.rows.length === 0) {
        res.status(400).json({ error: 'Owner not found in workspace' });
        return;
      }

      newProps.owner_id = data.owner_id;
      propsChanged = true;
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

    await pool.query(
      `UPDATE documents SET ${updates.join(', ')}
       WHERE id = $${paramIndex} AND workspace_id = $${paramIndex + 1} AND document_type = 'sprint'`,
      [...values, id, req.workspaceId]
    );

    // Re-query to get full sprint with owner info
    const result = await pool.query(
      `SELECT d.id, d.title, d.properties, d.program_id,
              p.title as program_name, p.properties->>'prefix' as program_prefix,
              w.sprint_start_date as workspace_sprint_start_date,
              u.id as owner_id, u.name as owner_name, u.email as owner_email,
              (SELECT COUNT(*) FROM documents i WHERE i.sprint_id = d.id AND i.document_type = 'issue') as issue_count,
              (SELECT COUNT(*) FROM documents i WHERE i.sprint_id = d.id AND i.document_type = 'issue' AND i.properties->>'state' = 'done') as completed_count,
              (SELECT COUNT(*) FROM documents i WHERE i.sprint_id = d.id AND i.document_type = 'issue' AND i.properties->>'state' IN ('in_progress', 'in_review')) as started_count,
              (SELECT COUNT(*) > 0 FROM documents pl WHERE pl.parent_id = d.id AND pl.document_type = 'sprint_plan') as has_plan,
              (SELECT COUNT(*) > 0 FROM documents rt WHERE rt.sprint_id = d.id AND rt.properties->>'outcome' IS NOT NULL) as has_retro,
              (SELECT rt.properties->>'outcome' FROM documents rt WHERE rt.sprint_id = d.id AND rt.properties->>'outcome' IS NOT NULL LIMIT 1) as retro_outcome,
              (SELECT rt.id FROM documents rt WHERE rt.sprint_id = d.id AND rt.properties->>'outcome' IS NOT NULL LIMIT 1) as retro_id
       FROM documents d
       JOIN documents p ON d.program_id = p.id
       JOIN workspaces w ON d.workspace_id = w.id
       LEFT JOIN users u ON (d.properties->>'owner_id')::uuid = u.id
       WHERE d.id = $1 AND d.document_type = 'sprint'`,
      [id]
    );

    res.json(extractSprintFromRow(result.rows[0]));
  } catch (err) {
    console.error('Update sprint error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete sprint
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify sprint exists and user can access it
    const existing = await pool.query(
      `SELECT id FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'sprint'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
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

// Update sprint hypothesis (append mode - preserves history)
// PATCH /api/sprints/:id/hypothesis
router.patch('/:id/hypothesis', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    const parsed = updateHypothesisSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
      return;
    }

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify sprint exists and user can access it, get current properties
    const existing = await pool.query(
      `SELECT id, properties FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'sprint'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Sprint not found' });
      return;
    }

    const currentProps = existing.rows[0].properties || {};
    const newProps = { ...currentProps };
    const data = parsed.data;
    const now = new Date().toISOString();

    // If hypothesis is being updated, append old one to history
    if (data.hypothesis !== undefined && data.hypothesis !== currentProps.hypothesis) {
      // Initialize history if doesn't exist
      const currentHistory = Array.isArray(currentProps.hypothesis_history)
        ? [...currentProps.hypothesis_history]
        : [];

      // If there was a previous hypothesis, add it to history
      if (currentProps.hypothesis) {
        currentHistory.push({
          hypothesis: currentProps.hypothesis,
          timestamp: now,
          author_id: userId,
        });
      }

      // Update to new hypothesis
      newProps.hypothesis = data.hypothesis;
      newProps.hypothesis_history = currentHistory;
    }

    // Update success_criteria and confidence directly
    if (data.success_criteria !== undefined) {
      newProps.success_criteria = data.success_criteria;
    }
    if (data.confidence !== undefined) {
      newProps.confidence = data.confidence;
    }

    // Save updated properties
    await pool.query(
      `UPDATE documents SET properties = $1, updated_at = now()
       WHERE id = $2 AND workspace_id = $3 AND document_type = 'sprint'`,
      [JSON.stringify(newProps), id, workspaceId]
    );

    // Re-query to get full sprint with owner info
    const result = await pool.query(
      `SELECT d.id, d.title, d.properties, d.program_id,
              p.title as program_name, p.properties->>'prefix' as program_prefix,
              w.sprint_start_date as workspace_sprint_start_date,
              u.id as owner_id, u.name as owner_name, u.email as owner_email,
              (SELECT COUNT(*) FROM documents i WHERE i.sprint_id = d.id AND i.document_type = 'issue') as issue_count,
              (SELECT COUNT(*) FROM documents i WHERE i.sprint_id = d.id AND i.document_type = 'issue' AND i.properties->>'state' = 'done') as completed_count,
              (SELECT COUNT(*) FROM documents i WHERE i.sprint_id = d.id AND i.document_type = 'issue' AND i.properties->>'state' IN ('in_progress', 'in_review')) as started_count,
              (SELECT COUNT(*) > 0 FROM documents pl WHERE pl.parent_id = d.id AND pl.document_type = 'sprint_plan') as has_plan,
              (SELECT COUNT(*) > 0 FROM documents rt WHERE rt.sprint_id = d.id AND rt.properties->>'outcome' IS NOT NULL) as has_retro,
              (SELECT rt.properties->>'outcome' FROM documents rt WHERE rt.sprint_id = d.id AND rt.properties->>'outcome' IS NOT NULL LIMIT 1) as retro_outcome,
              (SELECT rt.id FROM documents rt WHERE rt.sprint_id = d.id AND rt.properties->>'outcome' IS NOT NULL LIMIT 1) as retro_id
       FROM documents d
       JOIN documents p ON d.program_id = p.id
       JOIN workspaces w ON d.workspace_id = w.id
       LEFT JOIN users u ON (d.properties->>'owner_id')::uuid = u.id
       WHERE d.id = $1 AND d.document_type = 'sprint'`,
      [id]
    );

    res.json(extractSprintFromRow(result.rows[0]));
  } catch (err) {
    console.error('Update sprint hypothesis error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get sprint issues
router.get('/:id/issues', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify sprint exists, user can access it, and get program info
    const sprintResult = await pool.query(
      `SELECT d.id, p.properties->>'prefix' as prefix FROM documents d
       JOIN documents p ON d.program_id = p.id
       WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'sprint'
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (sprintResult.rows.length === 0) {
      res.status(404).json({ error: 'Sprint not found' });
      return;
    }

    const prefix = sprintResult.rows[0].prefix;

    const result = await pool.query(
      `SELECT d.id, d.title, d.properties, d.ticket_number,
              d.created_at, d.updated_at, d.created_by,
              u.name as assignee_name,
              CASE WHEN person_doc.archived_at IS NOT NULL THEN true ELSE false END as assignee_archived
       FROM documents d
       LEFT JOIN users u ON (d.properties->>'assignee_id')::uuid = u.id
       LEFT JOIN documents person_doc ON person_doc.workspace_id = d.workspace_id
         AND person_doc.document_type = 'person'
         AND person_doc.properties->>'user_id' = d.properties->>'assignee_id'
       WHERE d.sprint_id = $1 AND d.document_type = 'issue'
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

    // Get carryover sprint names for issues that have carryover_from_sprint_id
    const carryoverSprintIds = result.rows
      .map(row => row.properties?.carryover_from_sprint_id)
      .filter(Boolean);

    let carryoverSprintNames: Record<string, string> = {};
    if (carryoverSprintIds.length > 0) {
      const uniqueIds = [...new Set(carryoverSprintIds)];
      const sprintNamesResult = await pool.query(
        `SELECT id, title FROM documents WHERE id = ANY($1) AND document_type = 'sprint'`,
        [uniqueIds]
      );
      carryoverSprintNames = Object.fromEntries(
        sprintNamesResult.rows.map(r => [r.id, r.title])
      );
    }

    const issues = result.rows.map(row => {
      const props = row.properties || {};
      const carryoverFromSprintId = props.carryover_from_sprint_id || null;
      return {
        id: row.id,
        title: row.title,
        state: props.state || 'backlog',
        priority: props.priority || 'medium',
        assignee_id: props.assignee_id || null,
        estimate: props.estimate ?? null,
        ticket_number: row.ticket_number,
        created_at: row.created_at,
        updated_at: row.updated_at,
        created_by: row.created_by,
        assignee_name: row.assignee_name,
        assignee_archived: row.assignee_archived || false,
        display_id: `#${row.ticket_number}`,
        carryover_from_sprint_id: carryoverFromSprintId,
        carryover_from_sprint_name: carryoverFromSprintId
          ? carryoverSprintNames[carryoverFromSprintId] || null
          : null,
      };
    });

    res.json(issues);
  } catch (err) {
    console.error('Get sprint issues error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get sprint scope changes
// Returns: { originalScope, currentScope, scopeChangePercent, scopeChanges }
router.get('/:id/scope-changes', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Get sprint info including sprint_number and workspace start date
    const sprintResult = await pool.query(
      `SELECT d.id, d.properties->>'sprint_number' as sprint_number,
              w.sprint_start_date as workspace_sprint_start_date
       FROM documents d
       JOIN workspaces w ON d.workspace_id = w.id
       WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'sprint'
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (sprintResult.rows.length === 0) {
      res.status(404).json({ error: 'Sprint not found' });
      return;
    }

    const sprintNumber = parseInt(sprintResult.rows[0].sprint_number, 10);
    const rawStartDate = sprintResult.rows[0].workspace_sprint_start_date;
    const sprintDuration = 7; // 1-week sprints

    // Calculate sprint start date
    let workspaceStartDate: Date;
    if (rawStartDate instanceof Date) {
      workspaceStartDate = new Date(Date.UTC(rawStartDate.getFullYear(), rawStartDate.getMonth(), rawStartDate.getDate()));
    } else if (typeof rawStartDate === 'string') {
      workspaceStartDate = new Date(rawStartDate + 'T00:00:00Z');
    } else {
      workspaceStartDate = new Date();
    }

    const sprintStartDate = new Date(workspaceStartDate);
    sprintStartDate.setUTCDate(sprintStartDate.getUTCDate() + (sprintNumber - 1) * sprintDuration);

    // Get all issues currently in the sprint with their estimates
    const issuesResult = await pool.query(
      `SELECT d.id, COALESCE((d.properties->>'estimate')::numeric, 0) as estimate
       FROM documents d
       WHERE d.sprint_id = $1 AND d.document_type = 'issue'`,
      [id]
    );

    // Get when each issue was added to this sprint from document_history
    // field = 'sprint_id' and new_value = sprint_id means issue was added to sprint
    const historyResult = await pool.query(
      `SELECT document_id, created_at, old_value, new_value
       FROM document_history
       WHERE field = 'sprint_id' AND new_value = $1
       ORDER BY created_at ASC`,
      [id]
    );

    // Build a map of issue_id -> first_added_at (when issue was added to this sprint)
    const issueAddedAtMap: Record<string, Date> = {};
    for (const row of historyResult.rows) {
      if (!issueAddedAtMap[row.document_id]) {
        issueAddedAtMap[row.document_id] = new Date(row.created_at);
      }
    }

    // Calculate original scope (issues added before or at sprint start)
    // and current scope (all issues)
    let originalScope = 0;
    let currentScope = 0;

    for (const issue of issuesResult.rows) {
      const estimate = parseFloat(issue.estimate) || 0;
      currentScope += estimate;

      const addedAt = issueAddedAtMap[issue.id];
      // If no history record, assume it was always there (original)
      // If added before or at sprint start, it's original scope
      if (!addedAt || addedAt <= sprintStartDate) {
        originalScope += estimate;
      }
    }

    // Build scope changes timeline for the graph
    // Each entry: { timestamp, newScope, changeType, estimateChange }
    const scopeChanges: Array<{
      timestamp: string;
      scopeAfter: number;
      changeType: 'added' | 'removed';
      estimateChange: number;
    }> = [];

    // Get estimates for issues when they were added
    const issueEstimateMap: Record<string, number> = {};
    for (const issue of issuesResult.rows) {
      issueEstimateMap[issue.id] = parseFloat(issue.estimate) || 0;
    }

    // Only track changes after sprint starts
    let runningScope = originalScope;
    for (const row of historyResult.rows) {
      const createdAt = new Date(row.created_at);
      if (createdAt > sprintStartDate) {
        const estimate = issueEstimateMap[row.document_id] || 0;
        runningScope += estimate;
        scopeChanges.push({
          timestamp: createdAt.toISOString(),
          scopeAfter: runningScope,
          changeType: 'added',
          estimateChange: estimate,
        });
      }
    }

    // Also check for issues removed from sprint (sprint_id changed away from this sprint)
    const removedResult = await pool.query(
      `SELECT document_id, created_at, old_value, new_value
       FROM document_history
       WHERE field = 'sprint_id' AND old_value = $1 AND created_at > $2
       ORDER BY created_at ASC`,
      [id, sprintStartDate.toISOString()]
    );

    for (const row of removedResult.rows) {
      // We need the estimate of the issue at time of removal
      // For simplicity, we'll use the current estimate (or 0 if issue no longer in sprint)
      // In a real system, you might want to track historical estimates
      const issueResult = await pool.query(
        `SELECT COALESCE((properties->>'estimate')::numeric, 0) as estimate
         FROM documents WHERE id = $1`,
        [row.document_id]
      );
      const estimate = issueResult.rows[0] ? parseFloat(issueResult.rows[0].estimate) : 0;

      scopeChanges.push({
        timestamp: new Date(row.created_at).toISOString(),
        scopeAfter: -1, // Will be recalculated when sorting
        changeType: 'removed',
        estimateChange: -estimate,
      });
    }

    // Sort scope changes by timestamp and recalculate running scope
    scopeChanges.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    runningScope = originalScope;
    for (const change of scopeChanges) {
      runningScope += change.estimateChange;
      change.scopeAfter = runningScope;
    }

    // Calculate scope change percentage
    const scopeChangePercent = originalScope > 0
      ? Math.round(((currentScope - originalScope) / originalScope) * 100)
      : 0;

    res.json({
      originalScope,
      currentScope,
      scopeChangePercent,
      sprintStartDate: sprintStartDate.toISOString(),
      scopeChanges,
    });
  } catch (err) {
    console.error('Get sprint scope changes error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// Standup Endpoints - Comment-like entries on sprints
// ============================================

// Schema for creating a standup
const createStandupSchema = z.object({
  content: z.record(z.unknown()).default({ type: 'doc', content: [{ type: 'paragraph' }] }),
  title: z.string().max(200).optional().default('Standup Update'),
});

// Helper to format standup response
function formatStandupResponse(row: any) {
  return {
    id: row.id,
    sprint_id: row.parent_id,
    title: row.title,
    content: row.content,
    author_id: row.author_id,
    author_name: row.author_name,
    author_email: row.author_email,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * @swagger
 * /sprints/{id}/standups:
 *   get:
 *     summary: List standups for a sprint
 *     tags: [Sprints, Standups]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Sprint ID
 *     responses:
 *       200:
 *         description: List of standups
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Standup'
 *       404:
 *         description: Sprint not found
 */
router.get('/:id/standups', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify sprint exists and user can access it
    const sprintCheck = await pool.query(
      `SELECT id FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'sprint'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (sprintCheck.rows.length === 0) {
      res.status(404).json({ error: 'Sprint not found' });
      return;
    }

    // Get all standups for this sprint (parent_id = sprint.id)
    const result = await pool.query(
      `SELECT d.id, d.parent_id, d.title, d.content, d.created_at, d.updated_at,
              d.properties->>'author_id' as author_id,
              u.name as author_name, u.email as author_email
       FROM documents d
       LEFT JOIN users u ON (d.properties->>'author_id')::uuid = u.id
       WHERE d.parent_id = $1 AND d.document_type = 'standup'
         AND ${VISIBILITY_FILTER_SQL('d', '$2', '$3')}
       ORDER BY d.created_at DESC`,
      [id, userId, isAdmin]
    );

    // Transform issue links in standup content (e.g., #123 -> clickable links)
    const standups = await Promise.all(
      result.rows.map(async (row) => {
        const formatted = formatStandupResponse(row);
        formatted.content = await transformIssueLinks(formatted.content, workspaceId);
        return formatted;
      })
    );

    res.json(standups);
  } catch (err) {
    console.error('Get sprint standups error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /sprints/{id}/standups:
 *   post:
 *     summary: Create a standup entry
 *     tags: [Sprints, Standups]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Sprint ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               content:
 *                 type: object
 *                 description: TipTap editor content
 *               title:
 *                 type: string
 *                 default: Untitled
 *     responses:
 *       201:
 *         description: Standup created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Standup'
 *       404:
 *         description: Sprint not found
 */
router.post('/:id/standups', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    const parsed = createStandupSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
      return;
    }

    const { content, title } = parsed.data;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify sprint exists and user can access it
    const sprintCheck = await pool.query(
      `SELECT id FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'sprint'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (sprintCheck.rows.length === 0) {
      res.status(404).json({ error: 'Sprint not found' });
      return;
    }

    // Create the standup document
    // parent_id = sprint.id, properties.author_id = current user
    const properties = { author_id: userId };

    const result = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, content, parent_id, properties, created_by, visibility)
       VALUES ($1, 'standup', $2, $3, $4, $5, $6, 'workspace')
       RETURNING id, parent_id, title, content, properties, created_at, updated_at`,
      [workspaceId, title, JSON.stringify(content), id, JSON.stringify(properties), userId]
    );

    // Get author info
    const authorResult = await pool.query(
      `SELECT name, email FROM users WHERE id = $1`,
      [userId]
    );

    const standup = result.rows[0];
    const author = authorResult.rows[0];

    res.status(201).json({
      id: standup.id,
      sprint_id: standup.parent_id,
      title: standup.title,
      content: standup.content,
      author_id: userId,
      author_name: author?.name || null,
      author_email: author?.email || null,
      created_at: standup.created_at,
      updated_at: standup.updated_at,
    });
  } catch (err) {
    console.error('Create standup error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// Sprint Review Endpoints - One per sprint with hypothesis validation
// ============================================

// Schema for creating/updating a sprint review
const sprintReviewSchema = z.object({
  content: z.record(z.unknown()).optional(),
  title: z.string().max(200).optional(),
  hypothesis_validated: z.boolean().nullable().optional(),
});

// Helper to generate pre-filled sprint review content
async function generatePrefilledReviewContent(sprintData: any, issues: any[]) {
  // Categorize issues
  const issuesPlanned = issues.filter(i => {
    const props = i.properties || {};
    // An issue is "planned" if it was in the sprint from the start (no carryover_from_sprint_id)
    return !props.carryover_from_sprint_id;
  });

  const issuesCompleted = issues.filter(i => {
    const props = i.properties || {};
    return props.state === 'done';
  });

  const issuesIntroduced = issues.filter(i => {
    const props = i.properties || {};
    // Issues introduced mid-sprint would have carryover_from_sprint_id
    return !!props.carryover_from_sprint_id;
  });

  const issuesCancelled = issues.filter(i => {
    const props = i.properties || {};
    return props.state === 'cancelled';
  });

  // Build TipTap content with suggested sections
  const content: any = {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Sprint Summary' }]
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: `Sprint ${sprintData.sprint_number} review for ${sprintData.program_name || 'Program'}.` }]
      },
    ]
  };

  // Add hypothesis section if sprint has one
  if (sprintData.hypothesis) {
    content.content.push(
      {
        type: 'heading',
        attrs: { level: 3 },
        content: [{ type: 'text', text: 'Hypothesis' }]
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: sprintData.hypothesis }]
      }
    );
  }

  // Add issues summary section
  content.content.push(
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Issues Summary' }]
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [{ type: 'text', text: `Planned: ${issuesPlanned.length} issues` }]
          }]
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [{ type: 'text', text: `Completed: ${issuesCompleted.length} issues` }]
          }]
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [{ type: 'text', text: `Introduced mid-sprint: ${issuesIntroduced.length} issues` }]
          }]
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [{ type: 'text', text: `Cancelled: ${issuesCancelled.length} issues` }]
          }]
        },
      ]
    }
  );

  // Add completed issues list
  if (issuesCompleted.length > 0) {
    content.content.push(
      {
        type: 'heading',
        attrs: { level: 3 },
        content: [{ type: 'text', text: 'Deliverables' }]
      },
      {
        type: 'bulletList',
        content: issuesCompleted.map(i => ({
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [{ type: 'text', text: `#${i.ticket_number}: ${i.title}` }]
          }]
        }))
      }
    );
  }

  // Add next steps placeholder
  content.content.push(
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Next Steps' }]
    },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Add follow-up actions and learnings here.' }]
    }
  );

  return content;
}

// GET /api/sprints/:id/review - Get or generate pre-filled sprint review
router.get('/:id/review', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify sprint exists and user can access it
    const sprintResult = await pool.query(
      `SELECT d.id, d.title, d.properties, d.program_id,
              p.title as program_name
       FROM documents d
       JOIN documents p ON d.program_id = p.id
       WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'sprint'
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (sprintResult.rows.length === 0) {
      res.status(404).json({ error: 'Sprint not found' });
      return;
    }

    const sprint = sprintResult.rows[0];
    const sprintProps = sprint.properties || {};

    // Check if a sprint_review already exists for this sprint
    const existingReview = await pool.query(
      `SELECT d.id, d.title, d.content, d.properties, d.created_at, d.updated_at,
              u.name as owner_name, u.email as owner_email
       FROM documents d
       LEFT JOIN users u ON (d.properties->>'owner_id')::uuid = u.id
       WHERE d.properties->>'sprint_id' = $1 AND d.document_type = 'sprint_review'
         AND d.workspace_id = $2
         AND ${VISIBILITY_FILTER_SQL('d', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (existingReview.rows.length > 0) {
      // Return existing review
      const review = existingReview.rows[0];
      const reviewProps = review.properties || {};
      res.json({
        id: review.id,
        sprint_id: id,
        title: review.title,
        content: review.content,
        hypothesis_validated: reviewProps.hypothesis_validated ?? null,
        owner_id: reviewProps.owner_id || null,
        owner_name: review.owner_name || null,
        owner_email: review.owner_email || null,
        created_at: review.created_at,
        updated_at: review.updated_at,
        is_draft: false,
      });
      return;
    }

    // No existing review - generate pre-filled draft
    // Get issues for this sprint
    const issuesResult = await pool.query(
      `SELECT id, title, properties, ticket_number
       FROM documents
       WHERE sprint_id = $1 AND document_type = 'issue'`,
      [id]
    );

    const sprintData = {
      sprint_number: sprintProps.sprint_number || 1,
      program_name: sprint.program_name,
      hypothesis: sprintProps.hypothesis || null,
    };

    const prefilledContent = await generatePrefilledReviewContent(sprintData, issuesResult.rows);

    res.json({
      id: null, // No ID yet - this is a draft
      sprint_id: id,
      title: `Sprint ${sprintData.sprint_number} Review`,
      content: prefilledContent,
      hypothesis_validated: null,
      owner_id: null,
      owner_name: null,
      owner_email: null,
      created_at: null,
      updated_at: null,
      is_draft: true,
    });
  } catch (err) {
    console.error('Get sprint review error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/sprints/:id/review - Create finalized sprint review
router.post('/:id/review', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    const parsed = sprintReviewSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
      return;
    }

    const { content, title, hypothesis_validated } = parsed.data;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify sprint exists and user can access it
    const sprintCheck = await pool.query(
      `SELECT id, properties FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'sprint'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (sprintCheck.rows.length === 0) {
      res.status(404).json({ error: 'Sprint not found' });
      return;
    }

    // Check if a sprint_review already exists
    const existingCheck = await pool.query(
      `SELECT id FROM documents
       WHERE properties->>'sprint_id' = $1 AND document_type = 'sprint_review'
         AND workspace_id = $2`,
      [id, workspaceId]
    );

    if (existingCheck.rows.length > 0) {
      res.status(409).json({ error: 'Sprint review already exists. Use PATCH to update.' });
      return;
    }

    const sprintProps = sprintCheck.rows[0].properties || {};

    // Create the sprint_review document
    const properties = {
      sprint_id: id,
      owner_id: userId,
      hypothesis_validated: hypothesis_validated ?? null,
    };

    const reviewTitle = title || `Sprint ${sprintProps.sprint_number || 'N'} Review`;
    const reviewContent = content || { type: 'doc', content: [{ type: 'paragraph' }] };

    const result = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, content, properties, created_by, visibility)
       VALUES ($1, 'sprint_review', $2, $3, $4, $5, 'workspace')
       RETURNING id, title, content, properties, created_at, updated_at`,
      [workspaceId, reviewTitle, JSON.stringify(reviewContent), JSON.stringify(properties), userId]
    );

    // Get owner info
    const ownerResult = await pool.query(
      `SELECT name, email FROM users WHERE id = $1`,
      [userId]
    );

    const review = result.rows[0];
    const owner = ownerResult.rows[0];

    res.status(201).json({
      id: review.id,
      sprint_id: id,
      title: review.title,
      content: review.content,
      hypothesis_validated: hypothesis_validated ?? null,
      owner_id: userId,
      owner_name: owner?.name || null,
      owner_email: owner?.email || null,
      created_at: review.created_at,
      updated_at: review.updated_at,
      is_draft: false,
    });
  } catch (err) {
    console.error('Create sprint review error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/sprints/:id/review - Update existing sprint review
router.patch('/:id/review', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    const parsed = sprintReviewSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
      return;
    }

    const { content, title, hypothesis_validated } = parsed.data;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Find existing sprint_review for this sprint
    const existing = await pool.query(
      `SELECT id, properties FROM documents
       WHERE properties->>'sprint_id' = $1 AND document_type = 'sprint_review'
         AND workspace_id = $2
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Sprint review not found. Use POST to create.' });
      return;
    }

    const reviewId = existing.rows[0].id;
    const currentProps = existing.rows[0].properties || {};

    // Check if user is owner or admin
    const ownerId = currentProps.owner_id;
    if (ownerId !== userId && !isAdmin) {
      res.status(403).json({ error: 'Only the owner or admin can update this review' });
      return;
    }

    // Build update query
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (content !== undefined) {
      updates.push(`content = $${paramIndex++}`);
      values.push(JSON.stringify(content));
    }

    if (title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      values.push(title);
    }

    // Handle properties update
    let propsChanged = false;
    const newProps = { ...currentProps };

    if (hypothesis_validated !== undefined) {
      newProps.hypothesis_validated = hypothesis_validated;
      propsChanged = true;
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

    await pool.query(
      `UPDATE documents SET ${updates.join(', ')}
       WHERE id = $${paramIndex} AND document_type = 'sprint_review'`,
      [...values, reviewId]
    );

    // Re-query to get full review with owner info
    const result = await pool.query(
      `SELECT d.id, d.title, d.content, d.properties, d.created_at, d.updated_at,
              u.name as owner_name, u.email as owner_email
       FROM documents d
       LEFT JOIN users u ON (d.properties->>'owner_id')::uuid = u.id
       WHERE d.id = $1 AND d.document_type = 'sprint_review'`,
      [reviewId]
    );

    const review = result.rows[0];
    const reviewProps = review.properties || {};

    res.json({
      id: review.id,
      sprint_id: id,
      title: review.title,
      content: review.content,
      hypothesis_validated: reviewProps.hypothesis_validated ?? null,
      owner_id: reviewProps.owner_id || null,
      owner_name: review.owner_name || null,
      owner_email: review.owner_email || null,
      created_at: review.created_at,
      updated_at: review.updated_at,
      is_draft: false,
    });
  } catch (err) {
    console.error('Update sprint review error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
