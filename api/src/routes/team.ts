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
router.get('/grid', requireAuth, async (req: Request, res: Response) => {
  try {
    const workspaceId = req.user!.workspaceId;

    // Get all users in workspace
    const usersResult = await pool.query(
      `SELECT id, name, email FROM users WHERE workspace_id = $1 ORDER BY name`,
      [workspaceId]
    );

    // Get all sprints with their project info (past 2, current, future 2 based on dates)
    // We'll generate sprint periods based on workspace start date
    const workspaceResult = await pool.query(
      `SELECT sprint_start_date FROM workspaces WHERE id = $1`,
      [workspaceId]
    );

    const sprintStartDate = workspaceResult.rows[0]?.sprint_start_date || new Date().toISOString().split('T')[0];
    const sprintDurationDays = 14; // 2-week sprints

    // Calculate sprint periods (2 past, current, 2 future = 5 total)
    const today = new Date();
    const startDate = new Date(sprintStartDate);

    // Calculate which sprint number we're in
    const daysSinceStart = Math.floor((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const currentSprintNumber = Math.max(1, Math.floor(daysSinceStart / sprintDurationDays) + 1);

    // Generate sprint periods (2 before current, current, 2 after)
    const sprints = [];
    for (let i = currentSprintNumber - 2; i <= currentSprintNumber + 2; i++) {
      if (i < 1) continue;

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
      `SELECT d.id, d.title as name, d.start_date, d.end_date, d.project_id,
              p.title as project_name, p.prefix as project_prefix, p.color as project_color
       FROM documents d
       JOIN documents p ON d.project_id = p.id
       WHERE d.workspace_id = $1 AND d.document_type = 'sprint'
         AND d.start_date >= $2 AND d.end_date <= $3`,
      [workspaceId, minDate, maxDate]
    );

    // Get issues with sprint and assignee info
    const issuesResult = await pool.query(
      `SELECT i.id, i.title, i.sprint_id, i.assignee_id, i.state, i.ticket_number,
              s.start_date as sprint_start, s.end_date as sprint_end,
              p.id as project_id, p.title as project_name, p.prefix as project_prefix, p.color as project_color
       FROM documents i
       JOIN documents s ON i.sprint_id = s.id
       JOIN documents p ON i.project_id = p.id
       WHERE i.workspace_id = $1 AND i.document_type = 'issue' AND i.sprint_id IS NOT NULL AND i.assignee_id IS NOT NULL`,
      [workspaceId]
    );

    // Build associations: user_id -> sprint_number -> { projects: [...], issues: [...] }
    const associations: Record<string, Record<number, {
      projects: Array<{ id: string; name: string; prefix: string; color: string; issueCount: number }>;
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
        associations[userId][sprintNumber] = { projects: [], issues: [] };
      }

      const cell = associations[userId][sprintNumber];

      // Add issue
      cell.issues.push({
        id: issue.id,
        title: issue.title,
        displayId: `${issue.project_prefix}-${issue.ticket_number}`,
        state: issue.state,
      });

      // Add project if not already there
      const existingProject = cell.projects.find(p => p.id === issue.project_id);
      if (existingProject) {
        existingProject.issueCount++;
      } else {
        cell.projects.push({
          id: issue.project_id,
          name: issue.project_name,
          prefix: issue.project_prefix,
          color: issue.project_color,
          issueCount: 1,
        });
      }
    }

    res.json({
      users: usersResult.rows,
      sprints,
      associations,
    });
  } catch (err) {
    console.error('Get team grid error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
