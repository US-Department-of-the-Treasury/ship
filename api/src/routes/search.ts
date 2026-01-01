import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../db/client.js';

type RouterType = ReturnType<typeof Router>;
export const searchRouter: RouterType = Router();

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

// Search for mentions (people + documents)
// GET /api/search/mentions?q=:query
searchRouter.get('/mentions', requireAuth, async (req: Request, res: Response) => {
  try {
    const searchQuery = (req.query.q as string) || '';
    const workspaceId = req.user!.workspaceId;

    // Search for people (person documents linked via properties.user_id)
    const peopleResult = await pool.query(
      `SELECT
         d.id::text as id,
         d.title as name,
         'person' as document_type
       FROM documents d
       WHERE d.workspace_id = $1
         AND d.document_type = 'person'
         AND d.archived_at IS NULL
         AND d.title ILIKE $2
       ORDER BY d.title ASC
       LIMIT 5`,
      [workspaceId, `%${searchQuery}%`]
    );

    // Search for other documents (wiki, issue, project, program)
    // Exclude 'person' and system types like 'sprint', 'sprint_plan', 'sprint_retro'
    const documentsResult = await pool.query(
      `SELECT id, title, document_type
       FROM documents
       WHERE workspace_id = $1
         AND document_type IN ('wiki', 'issue', 'project', 'program')
         AND title ILIKE $2
       ORDER BY
         CASE document_type
           WHEN 'issue' THEN 1
           WHEN 'wiki' THEN 2
           WHEN 'project' THEN 3
           WHEN 'program' THEN 4
           ELSE 5
         END,
         updated_at DESC
       LIMIT 10`,
      [workspaceId, `%${searchQuery}%`]
    );

    res.json({
      people: peopleResult.rows,
      documents: documentsResult.rows,
    });
  } catch (error) {
    console.error('Error searching mentions:', error);
    res.status(500).json({ error: 'Failed to search mentions' });
  }
});
