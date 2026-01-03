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

// GET /api/team/grid - Get team grid data
// Query params:
//   fromSprint: number - start of range (default: current - 7)
//   toSprint: number - end of range (default: current + 7)
router.get('/grid', requireAuth, async (req: Request, res: Response) => {
  try {
    const workspaceId = req.user!.workspaceId;

    // Get all people in workspace via person documents
    const usersResult = await pool.query(
      `SELECT
         d.properties->>'user_id' as id,
         d.title as name,
         COALESCE(d.properties->>'email', u.email) as email
       FROM documents d
       LEFT JOIN users u ON u.id = (d.properties->>'user_id')::uuid
       WHERE d.workspace_id = $1
         AND d.document_type = 'person'
         AND d.archived_at IS NULL
       ORDER BY d.title`,
      [workspaceId]
    );

    // Get workspace sprint start date
    const workspaceResult = await pool.query(
      `SELECT sprint_start_date FROM workspaces WHERE id = $1`,
      [workspaceId]
    );

    const rawSprintStartDate = workspaceResult.rows[0]?.sprint_start_date;
    const sprintDurationDays = 14; // 2-week sprints

    const today = new Date();

    // Normalize sprint start date to midnight UTC to avoid timezone issues
    // pg driver may return DATE as a Date object with local timezone offset
    let startDate: Date;
    if (rawSprintStartDate instanceof Date) {
      // Extract just the date parts and create a UTC midnight date
      startDate = new Date(Date.UTC(rawSprintStartDate.getFullYear(), rawSprintStartDate.getMonth(), rawSprintStartDate.getDate()));
    } else if (typeof rawSprintStartDate === 'string') {
      // Parse string as UTC midnight
      startDate = new Date(rawSprintStartDate + 'T00:00:00Z');
    } else {
      // Fallback to today
      startDate = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
    }

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
      sprintStart.setUTCDate(sprintStart.getUTCDate() + (i - 1) * sprintDurationDays);

      const sprintEnd = new Date(sprintStart);
      sprintEnd.setUTCDate(sprintEnd.getUTCDate() + sprintDurationDays - 1);

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
      `SELECT d.id, d.title as name, d.properties->>'start_date' as start_date, d.properties->>'end_date' as end_date, d.program_id,
              p.title as program_name, p.properties->>'prefix' as program_prefix, p.properties->>'color' as program_color
       FROM documents d
       JOIN documents p ON d.program_id = p.id
       WHERE d.workspace_id = $1 AND d.document_type = 'sprint'
         AND (d.properties->>'start_date')::date >= $2 AND (d.properties->>'end_date')::date <= $3`,
      [workspaceId, minDate, maxDate]
    );

    // Get issues with sprint and assignee info
    const issuesResult = await pool.query(
      `SELECT i.id, i.title, i.sprint_id, i.properties->>'assignee_id' as assignee_id, i.properties->>'state' as state, i.ticket_number,
              s.properties->>'start_date' as sprint_start, s.properties->>'end_date' as sprint_end,
              p.id as program_id, p.title as program_name, p.properties->>'prefix' as program_prefix, p.properties->>'color' as program_color
       FROM documents i
       JOIN documents s ON i.sprint_id = s.id
       JOIN documents p ON i.program_id = p.id
       WHERE i.workspace_id = $1 AND i.document_type = 'issue' AND i.sprint_id IS NOT NULL AND i.properties->>'assignee_id' IS NOT NULL`,
      [workspaceId]
    );

    // Build associations: user_id -> sprint_number -> { programs: [...], issues: [...] }
    const associations: Record<string, Record<number, {
      programs: Array<{ id: string; name: string; prefix: string; color: string; issueCount: number }>;
      issues: Array<{ id: string; title: string; displayId: string; state: string }>;
    }>> = {};

    for (const issue of issuesResult.rows) {
      const userId = issue.assignee_id;
      // Parse issue's sprint start date as UTC midnight to match startDate
      const sprintStart = new Date(issue.sprint_start + 'T00:00:00Z');

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
        displayId: `#${issue.ticket_number}`,
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
      `SELECT id, title as name, properties->>'prefix' as prefix, properties->>'color' as color
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

// GET /api/team/assignments - Get user->sprint->program assignments based on sprint owner_id
router.get('/assignments', requireAuth, async (req: Request, res: Response) => {
  try {
    const workspaceId = req.user!.workspaceId;

    // Get all sprints with their owners
    // Sprint assignment is based on owner_id (explicit assignment), not issue assignees
    const sprintsResult = await pool.query(
      `SELECT s.id as sprint_id, s.properties->>'sprint_number' as sprint_number,
              s.properties->>'owner_id' as owner_id,
              p.id as program_id, p.title as program_name,
              p.properties->>'prefix' as prefix, p.properties->>'color' as color
       FROM documents s
       JOIN documents p ON s.program_id = p.id
       WHERE s.workspace_id = $1 AND s.document_type = 'sprint'
         AND s.properties->>'owner_id' IS NOT NULL`,
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

    for (const sprint of sprintsResult.rows) {
      const userId = sprint.owner_id;
      const sprintNumber = parseInt(sprint.sprint_number, 10);

      if (!userId || isNaN(sprintNumber)) continue;

      if (!assignments[userId]) {
        assignments[userId] = {};
      }

      // One owner per sprint window - this should be enforced at write time
      assignments[userId][sprintNumber] = {
        programId: sprint.program_id,
        programName: sprint.program_name,
        prefix: sprint.prefix,
        color: sprint.color,
        sprintDocId: sprint.sprint_id,
      };
    }

    res.json(assignments);
  } catch (err) {
    console.error('Get assignments error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/team/assign - Assign user as sprint owner for a program
router.post('/assign', requireAuth, async (req: Request, res: Response) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const { userId, programId, sprintNumber } = req.body;

    if (!userId || !programId || !sprintNumber) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    // Check if user is already assigned to another program for this sprint window
    const existingAssignment = await pool.query(
      `SELECT s.id, p.id as program_id, p.title as program_name
       FROM documents s
       JOIN documents p ON s.program_id = p.id
       WHERE s.workspace_id = $1 AND s.document_type = 'sprint'
         AND s.properties->>'owner_id' = $2
         AND (s.properties->>'sprint_number')::int = $3
         AND p.id != $4`,
      [workspaceId, userId, sprintNumber, programId]
    );

    if (existingAssignment.rows[0]) {
      res.status(409).json({
        error: 'User already assigned to another program',
        existingProgramId: existingAssignment.rows[0].program_id,
        existingProgramName: existingAssignment.rows[0].program_name,
      });
      return;
    }

    // Find existing sprint for this program and sprint number
    let sprintResult = await pool.query(
      `SELECT id, properties FROM documents
       WHERE workspace_id = $1 AND document_type = 'sprint'
         AND program_id = $2 AND (properties->>'sprint_number')::int = $3`,
      [workspaceId, programId, sprintNumber]
    );

    let sprintId: string;
    if (sprintResult.rows[0]) {
      // Update existing sprint's owner_id
      sprintId = sprintResult.rows[0].id;
      const currentProps = sprintResult.rows[0].properties || {};
      const updatedProps = { ...currentProps, owner_id: userId };

      await pool.query(
        `UPDATE documents SET properties = $1, updated_at = now() WHERE id = $2`,
        [JSON.stringify(updatedProps), sprintId]
      );
    } else {
      // Create new sprint with owner_id
      const newSprintResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, program_id, properties)
         VALUES ($1, 'sprint', $2, $3, $4)
         RETURNING id`,
        [workspaceId, `Sprint ${sprintNumber}`, programId, JSON.stringify({ sprint_number: sprintNumber, owner_id: userId })]
      );
      sprintId = newSprintResult.rows[0].id;
    }

    res.json({ success: true, sprintId });
  } catch (err) {
    console.error('Assign error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/team/assign - Remove user as sprint owner
router.delete('/assign', requireAuth, async (req: Request, res: Response) => {
  try {
    const workspaceId = req.user!.workspaceId;
    const { userId, sprintNumber } = req.body;

    if (!userId || !sprintNumber) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    // Find the sprint this user owns for this sprint number
    const sprintResult = await pool.query(
      `SELECT id, properties FROM documents
       WHERE workspace_id = $1 AND document_type = 'sprint'
         AND properties->>'owner_id' = $2
         AND (properties->>'sprint_number')::int = $3`,
      [workspaceId, userId, sprintNumber]
    );

    if (!sprintResult.rows[0]) {
      res.status(404).json({ error: 'No assignment found' });
      return;
    }

    const sprintId = sprintResult.rows[0].id;
    const currentProps = sprintResult.rows[0].properties || {};

    // Remove owner_id from sprint properties
    const { owner_id: _, ...updatedProps } = currentProps;

    await pool.query(
      `UPDATE documents SET properties = $1, updated_at = now() WHERE id = $2`,
      [JSON.stringify(updatedProps), sprintId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Unassign error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/team/people - Get all people (person documents)
router.get('/people', requireAuth, async (req: Request, res: Response) => {
  try {
    const workspaceId = req.user!.workspaceId;

    // Get person documents - return document id for navigation to person editor
    // Also include user_id for grid consistency
    // Email comes from properties or joined user
    const result = await pool.query(
      `SELECT d.id, d.properties->>'user_id' as user_id, d.title as name,
              COALESCE(d.properties->>'email', u.email) as email
       FROM documents d
       LEFT JOIN users u ON u.id = (d.properties->>'user_id')::uuid
       WHERE d.workspace_id = $1
         AND d.document_type = 'person'
         AND d.archived_at IS NULL
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
