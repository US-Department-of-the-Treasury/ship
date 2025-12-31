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
      `SELECT s.*, u.id as user_id, u.email, u.name, u.workspace_id
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

// Create feedback (creates an issue with source='feedback')
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
      `SELECT id, prefix FROM documents WHERE id = $1 AND workspace_id = $2 AND document_type = 'program'`,
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

    // Create the feedback issue
    const result = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, state, priority, program_id, ticket_number, created_by, source, content)
       VALUES ($1, 'issue', $2, 'new', 'medium', $3, $4, $5, 'feedback', $6)
       RETURNING *`,
      [req.user!.workspaceId, title, program_id, ticketNumber, req.user!.id, content ? JSON.stringify(content) : null]
    );

    const feedback = result.rows[0];
    const displayId = programPrefix
      ? `${programPrefix}-${ticketNumber}`
      : `#${ticketNumber}`;

    res.status(201).json({
      ...feedback,
      display_id: displayId,
      program_prefix: programPrefix,
    });
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
      `SELECT d.*,
              p.title as program_name, p.prefix as program_prefix, p.color as program_color,
              creator.name as created_by_name
       FROM documents d
       LEFT JOIN documents p ON d.program_id = p.id AND p.document_type = 'program'
       LEFT JOIN users creator ON d.created_by = creator.id
       WHERE d.id = $1 AND d.workspace_id = $2 AND d.document_type = 'issue' AND d.source = 'feedback'`,
      [id, req.user!.workspaceId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Feedback not found' });
      return;
    }

    const feedback = result.rows[0];
    res.json({
      ...feedback,
      display_id: feedback.program_prefix
        ? `${feedback.program_prefix}-${feedback.ticket_number}`
        : `#${feedback.ticket_number}`,
    });
  } catch (err) {
    console.error('Get feedback error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Accept feedback (changes state to 'backlog')
router.post('/:id/accept', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      res.status(404).json({ error: 'Feedback not found' });
      return;
    }

    // Verify it's a feedback item
    const existing = await pool.query(
      `SELECT id, source FROM documents WHERE id = $1 AND workspace_id = $2 AND document_type = 'issue'`,
      [id, req.user!.workspaceId]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Feedback not found' });
      return;
    }

    if (existing.rows[0].source !== 'feedback') {
      res.status(400).json({ error: 'This is not a feedback item' });
      return;
    }

    // Update state to backlog
    const result = await pool.query(
      `UPDATE documents
       SET state = 'backlog', updated_at = now()
       WHERE id = $1 AND workspace_id = $2
       RETURNING *`,
      [id, req.user!.workspaceId]
    );

    // Get program info for display_id
    const feedback = result.rows[0];
    let displayId = `#${feedback.ticket_number}`;
    if (feedback.program_id) {
      const programResult = await pool.query(
        `SELECT prefix FROM documents WHERE id = $1 AND document_type = 'program'`,
        [feedback.program_id]
      );
      if (programResult.rows[0]?.prefix) {
        displayId = `${programResult.rows[0].prefix}-${feedback.ticket_number}`;
      }
    }

    res.json({ ...feedback, display_id: displayId });
  } catch (err) {
    console.error('Accept feedback error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Reject feedback (changes state to 'closed' and stores reason)
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

    // Verify it's a feedback item
    const existing = await pool.query(
      `SELECT id, source FROM documents WHERE id = $1 AND workspace_id = $2 AND document_type = 'issue'`,
      [id, req.user!.workspaceId]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Feedback not found' });
      return;
    }

    if (existing.rows[0].source !== 'feedback') {
      res.status(400).json({ error: 'This is not a feedback item' });
      return;
    }

    // Update state to closed and store rejection reason
    const result = await pool.query(
      `UPDATE documents
       SET state = 'closed', rejection_reason = $3, updated_at = now()
       WHERE id = $1 AND workspace_id = $2
       RETURNING *`,
      [id, req.user!.workspaceId, reason]
    );

    // Get program info for display_id
    const feedback = result.rows[0];
    let displayId = `#${feedback.ticket_number}`;
    if (feedback.program_id) {
      const programResult = await pool.query(
        `SELECT prefix FROM documents WHERE id = $1 AND document_type = 'program'`,
        [feedback.program_id]
      );
      if (programResult.rows[0]?.prefix) {
        displayId = `${programResult.rows[0].prefix}-${feedback.ticket_number}`;
      }
    }

    res.json({ ...feedback, display_id: displayId });
  } catch (err) {
    console.error('Reject feedback error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
