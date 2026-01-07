import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../app.js';
import { pool } from '../db/client.js';

describe('Search API', () => {
  const app = createApp('http://localhost:5173');
  // Use unique identifiers to avoid conflicts between concurrent test runs
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const testEmail = `search-${testRunId}@ship.local`;
  const testWorkspaceName = `Search Test ${testRunId}`;

  let sessionCookie: string;
  let testWorkspaceId: string;
  let testUserId: string;
  let testPersonDocId: string;
  let testWikiDocId: string;

  beforeAll(async () => {
    // Create test workspace
    const workspaceResult = await pool.query(
      `INSERT INTO workspaces (name) VALUES ($1)
       RETURNING id`,
      [testWorkspaceName]
    );
    testWorkspaceId = workspaceResult.rows[0].id;

    // Create test user
    const userResult = await pool.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Search Test User')
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

    // Create session (sessions.id is TEXT not UUID, generated from crypto.randomBytes)
    const sessionId = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [sessionId, testUserId, testWorkspaceId]
    );
    sessionCookie = `session_id=${sessionId}`;

    // Create test person document
    const personResult = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, content)
       VALUES ($1, 'person', 'Test Person', '{}')
       RETURNING id`,
      [testWorkspaceId]
    );
    testPersonDocId = personResult.rows[0].id;

    // Create test wiki document
    const wikiResult = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, content)
       VALUES ($1, 'wiki', 'Test Wiki', '{}')
       RETURNING id`,
      [testWorkspaceId]
    );
    testWikiDocId = wikiResult.rows[0].id;
  });

  afterAll(async () => {
    // Clean up test data in correct order (foreign keys)
    await pool.query('DELETE FROM documents WHERE id IN ($1, $2)', [testPersonDocId, testWikiDocId]);
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [testUserId]);
    await pool.query('DELETE FROM workspace_memberships WHERE user_id = $1', [testUserId]);
    await pool.query('DELETE FROM users WHERE id = $1', [testUserId]);
    await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId]);
    // Don't close pool - it's shared across test files
  });

  it('GET /api/search/mentions returns 401 without auth', async () => {
    const res = await request(app)
      .get('/api/search/mentions?q=test');

    expect(res.status).toBe(401);
  });

  it('GET /api/search/mentions returns people and documents', async () => {
    const res = await request(app)
      .get('/api/search/mentions?q=Test')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('people');
    expect(res.body).toHaveProperty('documents');
    expect(Array.isArray(res.body.people)).toBe(true);
    expect(Array.isArray(res.body.documents)).toBe(true);
  });

  it('GET /api/search/mentions filters by query string', async () => {
    const res = await request(app)
      .get('/api/search/mentions?q=nonexistent12345')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(200);
    expect(res.body.people).toHaveLength(0);
    expect(res.body.documents).toHaveLength(0);
  });

  it('GET /api/search/mentions returns people with correct structure', async () => {
    const res = await request(app)
      .get('/api/search/mentions?q=Test')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(200);

    // Should find our test person
    expect(res.body.people.length).toBeGreaterThan(0);
    const person = res.body.people[0];
    expect(person).toHaveProperty('id');
    expect(person).toHaveProperty('name');
  });

  it('GET /api/search/mentions returns documents with correct structure', async () => {
    const res = await request(app)
      .get('/api/search/mentions?q=Test')
      .set('Cookie', sessionCookie);

    expect(res.status).toBe(200);

    // Should find our test wiki document
    expect(res.body.documents.length).toBeGreaterThan(0);
    const doc = res.body.documents[0];
    expect(doc).toHaveProperty('id');
    expect(doc).toHaveProperty('title');
    expect(doc).toHaveProperty('document_type');
  });
});
