import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../db/client.js';

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

// GET /api/team/grid - Get team grid data
// Query params:
//   fromSprint: number - start of range (default: current - 7)
//   toSprint: number - end of range (default: current + 7)
router.get('/grid', requireAuth, async (req: Request, res: Response) => {
  try {
    const workspaceId = req.user!.workspaceId;

    // Get all users in workspace
    const usersResult = await pool.query(
      `SELECT id, name, email FROM users WHERE workspace_id = $1 ORDER BY name`,
      [workspaceId]
    );

    // Get workspace sprint start date
    const workspaceResult = await pool.query(
      `SELECT sprint_start_date FROM workspaces WHERE id = $1`,
      [workspaceId]
    );

    const sprintStartDate = workspaceResult.rows[0]?.sprint_start_date || new Date().toISOString().split('T')[0];
    const sprintDurationDays = 14; // 2-week sprints

    const today = new Date();
    const startDate = new Date(sprintStartDate);

    // Calculate which sprint number we're in
    const daysSinceStart = Math.floor((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const currentSprintNumber = Math.max(1, Math.floor(daysSinceStart / sprintDurationDays) + 1);

    // Parse query params for sprint range (default: ~quarter each way)
    const defaultBack = 7;
    const defaultForward = 7;
    const fromSprint = req.query.fromSprint
      ? Math.max(1, parseInt(req.query.fromSprint as string, 10))
      : Math.max(1, currentSprintNumber - defaultBack);
    const toSprint = req.query.toSprint
      ? parseInt(req.query.toSprint as string, 10)
      : currentSprintNumber + defaultForward;

    // Generate sprint periods for requested range
    const sprints = [];
    for (let i = fromSprint; i <= toSprint; i++) {
      const sprintStart = new Date(startDate);
      sprintStart.setDate(sprintStart.getDate() + (i - 1) * sprintDurationDays);

      const sprintEnd = new Date(sprintStart);
      sprintEnd.setDate(sprintEnd.getDate() + sprintDurationDays - 1);

      sprints.push({
        number: i,
        name: `Sprint ${i}`,
        startDate: sprintStart.toISOString().split('T')[0],
        endDate: sprintEnd.toISOString().split('T')[0],
        isCurrent: i === currentSprintNumber,
      });
    }

    // Get all sprints from database that fall within our date range
    const minDate = sprints[0]?.startDate || today.toISOString().split('T')[0];
    const maxDate = sprints[sprints.length - 1]?.endDate || today.toISOString().split('T')[0];

    const dbSprintsResult = await pool.query(
      `SELECT d.id, d.title as name, d.start_date, d.end_date, d.program_id,
              p.title as program_name, p.prefix as program_prefix, p.color as program_color
       FROM documents d
       JOIN documents p ON d.program_id = p.id
       WHERE d.workspace_id = $1 AND d.document_type = 'sprint'
         AND d.start_date >= $2 AND d.end_date <= $3`,
      [workspaceId, minDate, maxDate]
    );

    // Get issues with sprint and assignee info
    const issuesResult = await pool.query(
      `SELECT i.id, i.title, i.sprint_id, i.assignee_id, i.state, i.ticket_number,
              s.start_date as sprint_start, s.end_date as sprint_end,
              p.id as program_id, p.title as program_name, p.prefix as program_prefix, p.color as program_color
       FROM documents i
       JOIN documents s ON i.sprint_id = s.id
       JOIN documents p ON i.program_id = p.id
       WHERE i.workspace_id = $1 AND i.document_type = 'issue' AND i.sprint_id IS NOT NULL AND i.assignee_id IS NOT NULL`,
      [workspaceId]
    );

    // Build associations: user_id -> sprint_number -> { programs: [...], issues: [...] }
    const associations: Record<string, Record<number, {
      programs: Array<{ id: string; name: string; prefix: string; color: string; issueCount: number }>;
      issues: Array<{ id: string; title: string; displayId: string; state: string }>;
    }>> = {};

    for (const issue of issuesResult.rows) {
      const userId = issue.assignee_id;
      const sprintStart = new Date(issue.sprint_start);

      // Calculate which sprint number this issue belongs to
      const daysSinceStart = Math.floor((sprintStart.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      const sprintNumber = Math.max(1, Math.floor(daysSinceStart / sprintDurationDays) + 1);

      // Skip if outside our range
      if (!sprints.find(s => s.number === sprintNumber)) continue;

      if (!associations[userId]) {
        associations[userId] = {};
      }
      if (!associations[userId][sprintNumber]) {
        associations[userId][sprintNumber] = { programs: [], issues: [] };
      }

      const cell = associations[userId][sprintNumber];

      // Add issue
      cell.issues.push({
        id: issue.id,
        title: issue.title,
        displayId: `${issue.program_prefix}-${issue.ticket_number}`,
        state: issue.state,
      });

      // Add program if not already there
      const existingProgram = cell.programs.find(p => p.id === issue.program_id);
      if (existingProgram) {
        existingProgram.issueCount++;
      } else {
        cell.programs.push({
          id: issue.program_id,
          name: issue.program_name,
          prefix: issue.program_prefix,
          color: issue.program_color,
          issueCount: 1,
        });
      }
    }

    res.json({
      users: usersResult.rows,
      sprints,
      associations,
      currentSprintNumber,
    });
  } catch (err) {
    console.error('Get team grid error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/team/programs - Get all programs
router.get('/programs', requireAuth, async (req: Request, res: Response) => {
  try {
    const workspaceId = req.user!.workspaceId;

    const result = await pool.query(
      `SELECT id, title as name, prefix, color
       FROM documents
       WHERE workspace_id = $1 AND document_type = 'program'
       ORDER BY title`,
      [workspaceId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Get programs error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/team/assignments - Get user->sprint->program assignments
router.get('/assignments', requireAuth, async (req: Request, res: Response) => {
  try {
    const workspaceId = req.user!.workspaceId;

    // Get workspace sprint info
    const workspaceResult = await pool.query(
      `SELECT sprint_start_date FROM workspaces WHERE id = $1`,
      [workspaceId]
    );
    const sprintStartDate = new Date(workspaceResult.rows[0]?.sprint_start_date || new Date());
    const sprintDurationDays = 14;

    // Get all issues with sprint and assignee
    const issuesResult = await pool.query(
      `SELECT i.assignee_id, i.sprint_id,
              s.start_date as sprint_start,
              p.id as program_id, p.title as program_name, p.prefix, p.color
       FROM documents i
       JOIN documents s ON i.sprint_id = s.id
       JOIN documents p ON i.program_id = p.id
       WHERE i.workspace_id = $1 AND i.document_type = 'issue'
         AND i.sprint_id IS NOT NULL AND i.assignee_id IS NOT NULL`,
      [workspaceId]
    );

    // Build assignments map: userId -> sprintNumber -> assignment
    const assignments: Record<string, Record<number, {
      programId: string;
      programName: string;
      prefix: string;
      color: string;
      sprintDocId: string;
    }>> = {};

    for (const issue of issuesResult.rows) {
      const userId = issue.assignee_id;
      const sprintStart = new Date(issue.sprint_start);

      // Calculate sprint number
      const daysSinceStart = Math.floor((sprintStart.getTime() - sprintStartDate.getTime()) / (1000 * 60 * 60 * 24));
      const sprintNumber = Math.max(1, Math.floor(daysSinceStart / sprintDurationDays) + 1);

      if (!assignments[userId]) {
        assignments[userId] = {};
      }

      // Only set if not already set (first program wins per user per sprint)
      if (!assignments[userId][sprintNumber]) {
        assignments[userId][sprintNumber] = {
          programId: issue.program_id,
          programName: issue.program_name,
          prefix: issue.prefix,
          color: issue.color,
          sprintDocId: issue.sprint_id,
        };
      }
    }

    res.json(assignments);
  } catch (err) {
    console.error('Get assignments error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/team/assign - Assign user to program for a sprint
router.post('/assign', requireAuth, async (req: Request, res: Response) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const { userId, programId, sprintNumber } = req.body;

    if (!userId || !programId || !sprintNumber) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    // Get workspace sprint start date
    const workspaceResult = await pool.query(
      `SELECT sprint_start_date FROM workspaces WHERE id = $1`,
      [workspaceId]
    );
    const sprintStartDate = new Date(workspaceResult.rows[0].sprint_start_date);

    // Calculate sprint dates
    const sprintStart = new Date(sprintStartDate);
    sprintStart.setDate(sprintStart.getDate() + (sprintNumber - 1) * 14);
    const sprintEnd = new Date(sprintStart);
    sprintEnd.setDate(sprintEnd.getDate() + 13);

    const startStr = sprintStart.toISOString().split('T')[0];
    const endStr = sprintEnd.toISOString().split('T')[0];

    // Find or create sprint for this program
    let sprintResult = await pool.query(
      `SELECT id FROM documents
       WHERE workspace_id = $1 AND document_type = 'sprint'
         AND program_id = $2 AND start_date = $3`,
      [workspaceId, programId, startStr]
    );

    let sprintId: string;
    if (sprintResult.rows[0]) {
      sprintId = sprintResult.rows[0].id;
    } else {
      // Create the sprint
      const newSprintResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, program_id, start_date, end_date)
         VALUES ($1, 'sprint', $2, $3, $4, $5)
         RETURNING id`,
        [workspaceId, `Sprint ${sprintNumber}`, programId, startStr, endStr]
      );
      sprintId = newSprintResult.rows[0].id;
    }

    // Check if user already has issues in another program for this sprint period
    const existingAssignment = await pool.query(
      `SELECT p.id as program_id, p.title as program_name
       FROM documents i
       JOIN documents s ON i.sprint_id = s.id
       JOIN documents p ON i.program_id = p.id
       WHERE i.workspace_id = $1 AND i.document_type = 'issue'
         AND i.assignee_id = $2
         AND s.start_date = $3
         AND p.id != $4
       LIMIT 1`,
      [workspaceId, userId, startStr, programId]
    );

    if (existingAssignment.rows[0]) {
      res.status(409).json({
        error: 'User already assigned to another program',
        existingProgramId: existingAssignment.rows[0].program_id,
        existingProgramName: existingAssignment.rows[0].program_name,
      });
      return;
    }

    // Check if user already has assignment to this program for this sprint
    const existingSameProgram = await pool.query(
      `SELECT id FROM documents
       WHERE workspace_id = $1 AND document_type = 'issue'
         AND assignee_id = $2 AND sprint_id = $3`,
      [workspaceId, userId, sprintId]
    );

    if (existingSameProgram.rows[0]) {
      res.json({ success: true, sprintId, message: 'Already assigned' });
      return;
    }

    // Get max ticket number for this program
    const maxTicketResult = await pool.query(
      `SELECT COALESCE(MAX(ticket_number), 0) as max_ticket
       FROM documents WHERE workspace_id = $1 AND program_id = $2 AND document_type = 'issue'`,
      [workspaceId, programId]
    );
    const nextTicket = maxTicketResult.rows[0].max_ticket + 1;

    // Create a placeholder issue for this assignment
    await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, program_id, sprint_id, assignee_id, state, ticket_number)
       VALUES ($1, 'issue', $2, $3, $4, $5, 'todo', $6)`,
      [workspaceId, 'Sprint Assignment', programId, sprintId, userId, nextTicket]
    );

    res.json({ success: true, sprintId });
  } catch (err) {
    console.error('Assign error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/team/assign - Unassign user from sprint
router.delete('/assign', requireAuth, async (req: Request, res: Response) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const { userId, sprintNumber } = req.body;

    if (!userId || !sprintNumber) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    // Get workspace sprint start date
    const workspaceResult = await pool.query(
      `SELECT sprint_start_date FROM workspaces WHERE id = $1`,
      [workspaceId]
    );
    const sprintStartDate = new Date(workspaceResult.rows[0].sprint_start_date);

    // Calculate sprint start date
    const sprintStart = new Date(sprintStartDate);
    sprintStart.setDate(sprintStart.getDate() + (sprintNumber - 1) * 14);
    const startStr = sprintStart.toISOString().split('T')[0];

    // Find all issues for this user in this sprint period
    const issuesToUpdate = await pool.query(
      `SELECT i.id, i.title
       FROM documents i
       JOIN documents s ON i.sprint_id = s.id
       WHERE i.workspace_id = $1 AND i.document_type = 'issue'
         AND i.assignee_id = $2
         AND s.start_date = $3`,
      [workspaceId, userId, startStr]
    );

    // Move issues to backlog (remove sprint assignment)
    if (issuesToUpdate.rows.length > 0) {
      const issueIds = issuesToUpdate.rows.map((i: { id: string }) => i.id);
      await pool.query(
        `UPDATE documents SET sprint_id = NULL WHERE id = ANY($1)`,
        [issueIds]
      );
    }

    res.json({
      success: true,
      issuesOrphaned: issuesToUpdate.rows,
    });
  } catch (err) {
    console.error('Unassign error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/team/people - Get all people (person documents)
router.get('/people', requireAuth, async (req: Request, res: Response) => {
  try {
    const workspaceId = req.user!.workspaceId;

    // Get person documents joined with user info by matching name/title
    const result = await pool.query(
      `SELECT d.id, d.title as name, u.email
       FROM documents d
       LEFT JOIN users u ON d.title = u.name AND u.workspace_id = d.workspace_id
       WHERE d.workspace_id = $1 AND d.document_type = 'person'
       ORDER BY d.title`,
      [workspaceId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Get people error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
