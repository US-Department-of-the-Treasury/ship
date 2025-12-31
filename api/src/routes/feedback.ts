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
const createFeedbackSchema = z.object({
  title: z.string().min(1).max(500),
  program_id: z.string().uuid(),
  content: z.any().optional(),
});

const rejectFeedbackSchema = z.object({
  reason: z.string().min(1).max(1000),
});

// Helper to extract feedback from row
function extractFeedbackFromRow(row: any, programPrefix?: string | null) {
  const props = row.properties || {};
  return {
    id: row.id,
    title: row.title,
    state: props.state || 'backlog',
    priority: props.priority || 'medium',
    source: props.source || 'feedback',
    feedback_status: props.feedback_status || null,
    rejection_reason: props.rejection_reason || null,
    assignee_id: props.assignee_id || null,
    ticket_number: row.ticket_number,
    program_id: row.program_id,
    content: row.content,
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by: row.created_by,
    program_name: row.program_name,
    program_prefix: row.program_prefix || programPrefix,
    program_color: row.program_color,
    created_by_name: row.created_by_name,
    display_id: (row.program_prefix || programPrefix)
      ? `${row.program_prefix || programPrefix}-${row.ticket_number}`
      : `#${row.ticket_number}`,
  };
}

// Create feedback (creates an issue with source='feedback', feedback_status='draft')
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = createFeedbackSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
      return;
    }

    const { title, program_id, content } = parsed.data;

    // Verify program exists and belongs to workspace
    const programResult = await pool.query(
      `SELECT id, properties->>'prefix' as prefix FROM documents WHERE id = $1 AND workspace_id = $2 AND document_type = 'program'`,
      [program_id, req.user!.workspaceId]
    );

    if (programResult.rows.length === 0) {
      res.status(404).json({ error: 'Program not found' });
      return;
    }

    const programPrefix = programResult.rows[0].prefix;

    // Get next ticket number for workspace
    const ticketResult = await pool.query(
      `SELECT COALESCE(MAX(ticket_number), 0) + 1 as next_number
       FROM documents
       WHERE workspace_id = $1 AND document_type = 'issue'`,
      [req.user!.workspaceId]
    );
    const ticketNumber = ticketResult.rows[0].next_number;

    // Build properties JSONB
    const properties = {
      state: 'backlog',
      priority: 'medium',
      source: 'feedback',
      feedback_status: 'draft',
      assignee_id: null,
      rejection_reason: null,
    };

    // Create the feedback issue
    const result = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, properties, program_id, ticket_number, created_by, content)
       VALUES ($1, 'issue', $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [req.user!.workspaceId, title, JSON.stringify(properties), program_id, ticketNumber, req.user!.id, content ? JSON.stringify(content) : null]
    );

    res.status(201).json(extractFeedbackFromRow(result.rows[0], programPrefix));
  } catch (err) {
    console.error('Create feedback error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single feedback item
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      res.status(404).json({ error: 'Feedback not found' });
      return;
    }

    const result = await pool.query(
      `SELECT d.id, d.title, d.properties, d.ticket_number, d.program_id,
              d.content, d.created_at, d.updated_at, d.created_by,
              p.title as program_name,
              p.properties->>'prefix' as program_prefix,
              p.properties->>'color' as program_color,
              creator.name as created_by_name
       FROM documents d
       LEFT JOIN documents p ON d.program_id = p.id AND p.document_type = 'program'
       LEFT JOIN users creator ON d.created_by = creator.id
       WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'issue' AND d.properties->>'source' = 'feedback'`,
      [id, req.user!.workspaceId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Feedback not found' });
      return;
    }

    res.json(extractFeedbackFromRow(result.rows[0]));
  } catch (err) {
    console.error('Get feedback error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Submit feedback (changes feedback_status from 'draft' to 'submitted')
router.post('/:id/submit', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      res.status(404).json({ error: 'Feedback not found' });
      return;
    }

    // Verify it's a feedback item in draft status
    const existing = await pool.query(
      `SELECT id, properties FROM documents WHERE id = $1 AND workspace_id = $2 AND document_type = 'issue'`,
      [id, req.user!.workspaceId]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Feedback not found' });
      return;
    }

    const props = existing.rows[0].properties || {};
    if (props.source !== 'feedback') {
      res.status(400).json({ error: 'This is not a feedback item' });
      return;
    }

    if (props.feedback_status !== 'draft') {
      res.status(400).json({ error: 'Feedback is not in draft status' });
      return;
    }

    // Update feedback_status to submitted
    const newProps = { ...props, feedback_status: 'submitted' };
    const result = await pool.query(
      `UPDATE documents
       SET properties = $3, updated_at = now()
       WHERE id = $1 AND workspace_id = $2
       RETURNING *`,
      [id, req.user!.workspaceId, JSON.stringify(newProps)]
    );

    // Get program prefix for display_id
    const feedback = result.rows[0];
    let programPrefix = null;
    if (feedback.program_id) {
      const programResult = await pool.query(
        `SELECT properties->>'prefix' as prefix FROM documents WHERE id = $1 AND document_type = 'program'`,
        [feedback.program_id]
      );
      programPrefix = programResult.rows[0]?.prefix || null;
    }

    res.json(extractFeedbackFromRow(feedback, programPrefix));
  } catch (err) {
    console.error('Submit feedback error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Accept feedback (clears feedback_status, keeps state as backlog - becomes regular issue)
router.post('/:id/accept', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      res.status(404).json({ error: 'Feedback not found' });
      return;
    }

    // Verify it's a feedback item in submitted status
    const existing = await pool.query(
      `SELECT id, properties FROM documents WHERE id = $1 AND workspace_id = $2 AND document_type = 'issue'`,
      [id, req.user!.workspaceId]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Feedback not found' });
      return;
    }

    const props = existing.rows[0].properties || {};
    if (props.source !== 'feedback') {
      res.status(400).json({ error: 'This is not a feedback item' });
      return;
    }

    if (props.feedback_status !== 'submitted') {
      res.status(400).json({ error: 'Feedback must be submitted before it can be accepted' });
      return;
    }

    // Clear feedback_status (becomes regular backlog issue)
    const newProps = { ...props, feedback_status: null };
    const result = await pool.query(
      `UPDATE documents
       SET properties = $3, updated_at = now()
       WHERE id = $1 AND workspace_id = $2
       RETURNING *`,
      [id, req.user!.workspaceId, JSON.stringify(newProps)]
    );

    // Get program prefix for display_id
    const feedback = result.rows[0];
    let programPrefix = null;
    if (feedback.program_id) {
      const programResult = await pool.query(
        `SELECT properties->>'prefix' as prefix FROM documents WHERE id = $1 AND document_type = 'program'`,
        [feedback.program_id]
      );
      programPrefix = programResult.rows[0]?.prefix || null;
    }

    res.json(extractFeedbackFromRow(feedback, programPrefix));
  } catch (err) {
    console.error('Accept feedback error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Reject feedback (clears feedback_status, stores rejection reason)
router.post('/:id/reject', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      res.status(404).json({ error: 'Feedback not found' });
      return;
    }

    const parsed = rejectFeedbackSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Rejection reason is required' });
      return;
    }

    const { reason } = parsed.data;

    // Verify it's a feedback item in submitted status
    const existing = await pool.query(
      `SELECT id, properties FROM documents WHERE id = $1 AND workspace_id = $2 AND document_type = 'issue'`,
      [id, req.user!.workspaceId]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Feedback not found' });
      return;
    }

    const props = existing.rows[0].properties || {};
    if (props.source !== 'feedback') {
      res.status(400).json({ error: 'This is not a feedback item' });
      return;
    }

    if (props.feedback_status !== 'submitted') {
      res.status(400).json({ error: 'Feedback must be submitted before it can be rejected' });
      return;
    }

    // Clear feedback_status and store rejection reason
    const newProps = { ...props, feedback_status: null, rejection_reason: reason };
    const result = await pool.query(
      `UPDATE documents
       SET properties = $3, updated_at = now()
       WHERE id = $1 AND workspace_id = $2
       RETURNING *`,
      [id, req.user!.workspaceId, JSON.stringify(newProps)]
    );

    // Get program prefix for display_id
    const feedback = result.rows[0];
    let programPrefix = null;
    if (feedback.program_id) {
      const programResult = await pool.query(
        `SELECT properties->>'prefix' as prefix FROM documents WHERE id = $1 AND document_type = 'program'`,
        [feedback.program_id]
      );
      programPrefix = programResult.rows[0]?.prefix || null;
    }

    res.json(extractFeedbackFromRow(feedback, programPrefix));
  } catch (err) {
    console.error('Reject feedback error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
