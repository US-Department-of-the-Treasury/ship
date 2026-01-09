/**
 * GitHub Activity API Routes
 *
 * Provides endpoints for retrieving GitHub activity (PRs, commits).
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../db/client.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

// Apply auth to all routes
router.use(authMiddleware);

// Query params schema
const activityQuerySchema = z.object({
  program_id: z.string().uuid().optional(),
  issue_id: z.coerce.number().int().positive().optional(),
  author_login: z.string().min(1).max(100).optional(),  // Filter by GitHub username
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * GET /api/github/activity
 *
 * Returns paginated GitHub activity for the current workspace.
 * Query params:
 * - program_id: Filter to repos linked to this program
 * - issue_id: Filter to PRs referencing this issue (by ticket_number)
 * - author_login: Filter to PRs by this GitHub username
 * - limit: Max results (default 20, max 100)
 * - offset: Pagination offset (default 0)
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.workspaceId;
    if (!workspaceId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Parse and validate query params
    const parseResult = activityQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Invalid query parameters',
        details: parseResult.error.issues,
      });
    }

    const { program_id, issue_id, author_login, limit, offset } = parseResult.data;

    // Build query based on filters
    let query: string;
    let params: (string | number)[];

    if (program_id) {
      // Filter by program: get repos linked to this program
      const authorFilter = author_login ? 'AND ga.author_login = $5' : '';
      query = `
        WITH linked_repos AS (
          SELECT
            jsonb_array_elements(d.properties->'githubRepos')->>'owner' AS repo_owner,
            jsonb_array_elements(d.properties->'githubRepos')->>'repo' AS repo_name
          FROM documents d
          WHERE d.id = $1
            AND d.workspace_id = $2
            AND d.document_type = 'program'
        )
        SELECT
          ga.id,
          ga.repo_owner,
          ga.repo_name,
          ga.event_type,
          ga.github_id,
          ga.title,
          ga.url,
          ga.author_login,
          ga.author_avatar_url,
          ga.issue_ids,
          ga.created_at,
          ga.github_created_at
        FROM github_activity ga
        INNER JOIN linked_repos lr
          ON ga.repo_owner = lr.repo_owner AND ga.repo_name = lr.repo_name
        WHERE ga.workspace_id = $2 ${authorFilter}
        ORDER BY ga.created_at DESC
        LIMIT $3 OFFSET $4
      `;
      params = author_login
        ? [program_id, workspaceId, limit, offset, author_login]
        : [program_id, workspaceId, limit, offset];
    } else if (issue_id) {
      // Filter by issue: PRs referencing this issue
      const authorFilter = author_login ? 'AND ga.author_login = $5' : '';
      query = `
        SELECT
          ga.id,
          ga.repo_owner,
          ga.repo_name,
          ga.event_type,
          ga.github_id,
          ga.title,
          ga.url,
          ga.author_login,
          ga.author_avatar_url,
          ga.issue_ids,
          ga.created_at,
          ga.github_created_at
        FROM github_activity ga
        WHERE ga.workspace_id = $1
          AND $2 = ANY(ga.issue_ids) ${authorFilter}
        ORDER BY ga.created_at DESC
        LIMIT $3 OFFSET $4
      `;
      params = author_login
        ? [workspaceId, issue_id, limit, offset, author_login]
        : [workspaceId, issue_id, limit, offset];
    } else if (author_login) {
      // Filter by author only
      query = `
        SELECT
          ga.id,
          ga.repo_owner,
          ga.repo_name,
          ga.event_type,
          ga.github_id,
          ga.title,
          ga.url,
          ga.author_login,
          ga.author_avatar_url,
          ga.issue_ids,
          ga.created_at,
          ga.github_created_at
        FROM github_activity ga
        WHERE ga.workspace_id = $1
          AND ga.author_login = $2
        ORDER BY ga.created_at DESC
        LIMIT $3 OFFSET $4
      `;
      params = [workspaceId, author_login, limit, offset];
    } else {
      // No filter: all activity for workspace
      query = `
        SELECT
          ga.id,
          ga.repo_owner,
          ga.repo_name,
          ga.event_type,
          ga.github_id,
          ga.title,
          ga.url,
          ga.author_login,
          ga.author_avatar_url,
          ga.issue_ids,
          ga.created_at,
          ga.github_created_at
        FROM github_activity ga
        WHERE ga.workspace_id = $1
        ORDER BY ga.created_at DESC
        LIMIT $2 OFFSET $3
      `;
      params = [workspaceId, limit, offset];
    }

    const result = await pool.query(query, params);

    // Get total count for pagination
    let countQuery: string;
    let countParams: (string | number)[];

    if (program_id) {
      const authorFilter = author_login ? 'AND ga.author_login = $3' : '';
      countQuery = `
        WITH linked_repos AS (
          SELECT
            jsonb_array_elements(d.properties->'githubRepos')->>'owner' AS repo_owner,
            jsonb_array_elements(d.properties->'githubRepos')->>'repo' AS repo_name
          FROM documents d
          WHERE d.id = $1
            AND d.workspace_id = $2
            AND d.document_type = 'program'
        )
        SELECT COUNT(*) FROM github_activity ga
        INNER JOIN linked_repos lr
          ON ga.repo_owner = lr.repo_owner AND ga.repo_name = lr.repo_name
        WHERE ga.workspace_id = $2 ${authorFilter}
      `;
      countParams = author_login ? [program_id, workspaceId, author_login] : [program_id, workspaceId];
    } else if (issue_id) {
      const authorFilter = author_login ? 'AND author_login = $3' : '';
      countQuery = `
        SELECT COUNT(*) FROM github_activity
        WHERE workspace_id = $1 AND $2 = ANY(issue_ids) ${authorFilter}
      `;
      countParams = author_login ? [workspaceId, issue_id, author_login] : [workspaceId, issue_id];
    } else if (author_login) {
      countQuery = `SELECT COUNT(*) FROM github_activity WHERE workspace_id = $1 AND author_login = $2`;
      countParams = [workspaceId, author_login];
    } else {
      countQuery = `SELECT COUNT(*) FROM github_activity WHERE workspace_id = $1`;
      countParams = [workspaceId];
    }

    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count, 10);

    return res.json({
      activities: result.rows,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + result.rows.length < total,
      },
    });
  } catch (err) {
    console.error('[GitHub Activity API] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
