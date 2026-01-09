import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../app.js';
import { pool } from '../db/client.js';

describe('GitHub Activity API', () => {
  const app = createApp('http://localhost:5173');
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const testEmail = `github-activity-${testRunId}@ship.local`;
  const testWorkspaceName = `GitHub Activity Test ${testRunId}`;

  let sessionCookie: string;
  let testWorkspaceId: string;
  let testUserId: string;
  let testProgramId: string;
  let testActivityId: string;

  beforeAll(async () => {
    // Create test workspace
    const workspaceResult = await pool.query(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
      [testWorkspaceName]
    );
    testWorkspaceId = workspaceResult.rows[0].id;

    // Create test user
    const userResult = await pool.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'GitHub Activity Test User')
       RETURNING id`,
      [testEmail]
    );
    testUserId = userResult.rows[0].id;

    // Create workspace membership
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [testWorkspaceId, testUserId]
    );

    // Create session
    const sessionId = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [sessionId, testUserId, testWorkspaceId]
    );
    sessionCookie = `session_id=${sessionId}`;

    // Create test program with linked GitHub repo
    const programResult = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, properties)
       VALUES ($1, 'program', 'Test Program', $2)
       RETURNING id`,
      [
        testWorkspaceId,
        JSON.stringify({
          color: 'blue',
          githubRepos: [{ owner: 'test-owner', repo: 'test-repo' }],
        }),
      ]
    );
    testProgramId = programResult.rows[0].id;

    // Create test github activity record
    const activityResult = await pool.query(
      `INSERT INTO github_activity (
        workspace_id, repo_owner, repo_name, event_type, github_id,
        title, url, author_login, author_avatar_url, issue_ids, github_created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id`,
      [
        testWorkspaceId,
        'test-owner',
        'test-repo',
        'pr_opened',
        12345,
        'Test PR #123',
        'https://github.com/test-owner/test-repo/pull/1',
        'test-author',
        'https://avatars.githubusercontent.com/test-author',
        [123, 456],
        new Date(),
      ]
    );
    testActivityId = activityResult.rows[0].id;
  });

  afterAll(async () => {
    // Clean up test data
    await pool.query('DELETE FROM github_activity WHERE workspace_id = $1', [testWorkspaceId]);
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [testWorkspaceId]);
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [testUserId]);
    await pool.query('DELETE FROM workspace_memberships WHERE user_id = $1', [testUserId]);
    await pool.query('DELETE FROM users WHERE id = $1', [testUserId]);
    await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId]);
  });

  describe('GET /api/github/activity', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).get('/api/github/activity');
      expect(res.status).toBe(401);
    });

    it('returns activity with pagination', async () => {
      const res = await request(app)
        .get('/api/github/activity')
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('activities');
      expect(res.body).toHaveProperty('pagination');
      expect(Array.isArray(res.body.activities)).toBe(true);
      expect(res.body.pagination).toHaveProperty('total');
      expect(res.body.pagination).toHaveProperty('limit');
      expect(res.body.pagination).toHaveProperty('offset');
      expect(res.body.pagination).toHaveProperty('hasMore');
    });

    it('returns activity record with correct structure', async () => {
      const res = await request(app)
        .get('/api/github/activity')
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
      expect(res.body.activities.length).toBeGreaterThan(0);

      const activity = res.body.activities[0];
      expect(activity).toHaveProperty('id');
      expect(activity).toHaveProperty('repo_owner');
      expect(activity).toHaveProperty('repo_name');
      expect(activity).toHaveProperty('event_type');
      expect(activity).toHaveProperty('title');
      expect(activity).toHaveProperty('url');
      expect(activity).toHaveProperty('author_login');
      expect(activity).toHaveProperty('issue_ids');
    });

    it('filters by program_id', async () => {
      const res = await request(app)
        .get(`/api/github/activity?program_id=${testProgramId}`)
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
      expect(res.body.activities.length).toBeGreaterThan(0);
      expect(res.body.activities[0].repo_owner).toBe('test-owner');
      expect(res.body.activities[0].repo_name).toBe('test-repo');
    });

    it('filters by issue_id', async () => {
      const res = await request(app)
        .get('/api/github/activity?issue_id=123')
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
      expect(res.body.activities.length).toBeGreaterThan(0);
      expect(res.body.activities[0].issue_ids).toContain(123);
    });

    it('returns empty for non-matching issue_id', async () => {
      const res = await request(app)
        .get('/api/github/activity?issue_id=99999')
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
      expect(res.body.activities).toHaveLength(0);
    });

    it('respects limit parameter', async () => {
      const res = await request(app)
        .get('/api/github/activity?limit=1')
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(200);
      expect(res.body.activities.length).toBeLessThanOrEqual(1);
      expect(res.body.pagination.limit).toBe(1);
    });

    it('returns 400 for invalid program_id format', async () => {
      const res = await request(app)
        .get('/api/github/activity?program_id=not-a-uuid')
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('returns 400 for invalid issue_id format', async () => {
      const res = await request(app)
        .get('/api/github/activity?issue_id=not-a-number')
        .set('Cookie', sessionCookie);

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });
  });
});
