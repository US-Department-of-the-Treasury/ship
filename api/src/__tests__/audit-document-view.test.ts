import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import { pool } from '../db/client.js'

describe('Audit Document View Logging', () => {
  const app = createApp()
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  let testWorkspaceId: string
  let testUserId: string
  let testUserSessionId: string
  let testDocumentId: string

  beforeAll(async () => {
    // Create test workspace
    const workspaceResult = await pool.query(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
      [`Audit View Test ${testRunId}`]
    )
    testWorkspaceId = workspaceResult.rows[0].id

    // Create test user
    const userResult = await pool.query(
      `INSERT INTO users (email, name) VALUES ($1, 'Audit View Test User') RETURNING id`,
      [`audit-view-test-${testRunId}@ship.local`]
    )
    testUserId = userResult.rows[0].id

    // Create workspace membership
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'member')`,
      [testWorkspaceId, testUserId]
    )

    // Create test session
    testUserSessionId = `test-session-${testRunId}`
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at, last_activity, created_at)
       VALUES ($1, $2, $3, now() + interval '1 hour', now(), now())`,
      [testUserSessionId, testUserId, testWorkspaceId]
    )

    // Create test document
    const docResult = await pool.query(
      `INSERT INTO documents (workspace_id, created_by, document_type, title, visibility)
       VALUES ($1, $2, 'wiki', 'Test Document', 'workspace')
       RETURNING id`,
      [testWorkspaceId, testUserId]
    )
    testDocumentId = docResult.rows[0].id

    // Clean up any existing test audit records
    await pool.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_no_delete')
    await pool.query("DELETE FROM audit_logs WHERE action = 'document.view' AND resource_id = $1", [testDocumentId])
    await pool.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_no_delete')
  })

  afterAll(async () => {
    // Clean up test data
    await pool.query('DELETE FROM sessions WHERE id = $1', [testUserSessionId])
    await pool.query('DELETE FROM documents WHERE id = $1', [testDocumentId])
    await pool.query('DELETE FROM workspace_memberships WHERE user_id = $1', [testUserId])
    await pool.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_no_delete')
    await pool.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_no_update')
    await pool.query("DELETE FROM audit_logs WHERE resource_id = $1", [testDocumentId])
    await pool.query('DELETE FROM users WHERE id = $1', [testUserId])
    await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId])
    await pool.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_no_update')
    await pool.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_no_delete')
  })

  it('logs document view via REST API /content endpoint', async () => {
    const res = await request(app)
      .get(`/api/documents/${testDocumentId}/content`)
      .set('Cookie', `session_id=${testUserSessionId}`)

    expect(res.status).toBe(200)

    // Check audit log was created
    const auditResult = await pool.query(
      `SELECT * FROM audit_logs
       WHERE action = 'document.view'
         AND resource_id = $1
         AND actor_user_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [testDocumentId, testUserId]
    )

    expect(auditResult.rows.length).toBe(1)
    const auditLog = auditResult.rows[0]
    expect(auditLog.action).toBe('document.view')
    expect(auditLog.resource_type).toBe('document')
    expect(auditLog.workspace_id).toBe(testWorkspaceId)
    expect(auditLog.details.access_method).toBe('api')
    expect(auditLog.details.document_type).toBe('wiki')
  })

  it('deduplicates views within 60 seconds', async () => {
    // First request should create new log
    await request(app)
      .get(`/api/documents/${testDocumentId}/content`)
      .set('Cookie', `session_id=${testUserSessionId}`)

    // Get the count
    const countBefore = await pool.query(
      `SELECT COUNT(*) as cnt FROM audit_logs
       WHERE action = 'document.view' AND resource_id = $1 AND actor_user_id = $2`,
      [testDocumentId, testUserId]
    )
    const initialCount = parseInt(countBefore.rows[0].cnt)

    // Second request within 60 seconds should NOT create new log
    await request(app)
      .get(`/api/documents/${testDocumentId}/content`)
      .set('Cookie', `session_id=${testUserSessionId}`)

    const countAfter = await pool.query(
      `SELECT COUNT(*) as cnt FROM audit_logs
       WHERE action = 'document.view' AND resource_id = $1 AND actor_user_id = $2`,
      [testDocumentId, testUserId]
    )
    const finalCount = parseInt(countAfter.rows[0].cnt)

    // Should be same count (deduplicated)
    expect(finalCount).toBe(initialCount)
  })

  it('logs view with IP address', async () => {
    // Clean up previous logs for clean test
    await pool.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_no_delete')
    await pool.query("DELETE FROM audit_logs WHERE action = 'document.view' AND resource_id = $1", [testDocumentId])
    await pool.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_no_delete')

    const res = await request(app)
      .get(`/api/documents/${testDocumentId}/content`)
      .set('Cookie', `session_id=${testUserSessionId}`)

    expect(res.status).toBe(200)

    const auditResult = await pool.query(
      `SELECT ip_address FROM audit_logs
       WHERE action = 'document.view' AND resource_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [testDocumentId]
    )

    expect(auditResult.rows.length).toBe(1)
    expect(auditResult.rows[0].ip_address).not.toBeNull()
  })

  it('does NOT log document metadata endpoint', async () => {
    // Clean up previous logs
    await pool.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_no_delete')
    await pool.query("DELETE FROM audit_logs WHERE action = 'document.view' AND resource_id = $1", [testDocumentId])
    await pool.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_no_delete')

    // Hit the metadata endpoint (not /content)
    const res = await request(app)
      .get(`/api/documents/${testDocumentId}`)
      .set('Cookie', `session_id=${testUserSessionId}`)

    expect(res.status).toBe(200)

    // Should NOT have created an audit log
    const auditResult = await pool.query(
      `SELECT * FROM audit_logs
       WHERE action = 'document.view' AND resource_id = $1`,
      [testDocumentId]
    )

    expect(auditResult.rows.length).toBe(0)
  })

  it('logs different users separately', async () => {
    // Create second user
    const user2Result = await pool.query(
      `INSERT INTO users (email, name) VALUES ($1, 'Second Test User') RETURNING id`,
      [`audit-view-test-user2-${testRunId}@ship.local`]
    )
    const user2Id = user2Result.rows[0].id

    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'member')`,
      [testWorkspaceId, user2Id]
    )

    const session2Id = `test-session-user2-${testRunId}`
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at, last_activity, created_at)
       VALUES ($1, $2, $3, now() + interval '1 hour', now(), now())`,
      [session2Id, user2Id, testWorkspaceId]
    )

    // Clean up previous logs
    await pool.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_no_delete')
    await pool.query("DELETE FROM audit_logs WHERE action = 'document.view' AND resource_id = $1", [testDocumentId])
    await pool.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_no_delete')

    // User 1 views document
    await request(app)
      .get(`/api/documents/${testDocumentId}/content`)
      .set('Cookie', `session_id=${testUserSessionId}`)

    // User 2 views same document
    await request(app)
      .get(`/api/documents/${testDocumentId}/content`)
      .set('Cookie', `session_id=${session2Id}`)

    // Both should be logged separately
    const auditResult = await pool.query(
      `SELECT DISTINCT actor_user_id FROM audit_logs
       WHERE action = 'document.view' AND resource_id = $1`,
      [testDocumentId]
    )

    expect(auditResult.rows.length).toBe(2)

    // Cleanup user 2 (must disable triggers for FK cascade)
    await pool.query('DELETE FROM sessions WHERE id = $1', [session2Id])
    await pool.query('DELETE FROM workspace_memberships WHERE user_id = $1', [user2Id])
    await pool.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_no_delete')
    await pool.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_no_update')
    await pool.query('DELETE FROM users WHERE id = $1', [user2Id])
    await pool.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_no_update')
    await pool.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_no_delete')
  })
})
