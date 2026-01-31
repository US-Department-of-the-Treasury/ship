import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import { pool } from '../db/client.js'

describe('Audit Document Denied Logging', () => {
  const app = createApp()
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  let testWorkspaceId: string
  let testUserId: string
  let testUserSessionId: string
  let otherUserId: string
  let otherUserSessionId: string
  let privateDocumentId: string

  beforeAll(async () => {
    // Create test workspace
    const workspaceResult = await pool.query(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
      [`Audit Denied Test ${testRunId}`]
    )
    testWorkspaceId = workspaceResult.rows[0].id

    // Create test user (document owner)
    const userResult = await pool.query(
      `INSERT INTO users (email, name) VALUES ($1, 'Audit Denied Test Owner') RETURNING id`,
      [`audit-denied-owner-${testRunId}@ship.local`]
    )
    testUserId = userResult.rows[0].id

    // Create other user (will be denied access)
    const otherUserResult = await pool.query(
      `INSERT INTO users (email, name) VALUES ($1, 'Audit Denied Test Other') RETURNING id`,
      [`audit-denied-other-${testRunId}@ship.local`]
    )
    otherUserId = otherUserResult.rows[0].id

    // Create workspace memberships
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'member')`,
      [testWorkspaceId, testUserId]
    )
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'member')`,
      [testWorkspaceId, otherUserId]
    )

    // Create sessions
    testUserSessionId = `test-session-owner-${testRunId}`
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at, last_activity, created_at)
       VALUES ($1, $2, $3, now() + interval '1 hour', now(), now())`,
      [testUserSessionId, testUserId, testWorkspaceId]
    )

    otherUserSessionId = `test-session-other-${testRunId}`
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at, last_activity, created_at)
       VALUES ($1, $2, $3, now() + interval '1 hour', now(), now())`,
      [otherUserSessionId, otherUserId, testWorkspaceId]
    )

    // Create private document (owned by testUser)
    const docResult = await pool.query(
      `INSERT INTO documents (workspace_id, created_by, document_type, title, visibility)
       VALUES ($1, $2, 'wiki', 'Private Document', 'private')
       RETURNING id`,
      [testWorkspaceId, testUserId]
    )
    privateDocumentId = docResult.rows[0].id
  })

  afterAll(async () => {
    // Clean up test data
    await pool.query('DELETE FROM sessions WHERE id IN ($1, $2)', [testUserSessionId, otherUserSessionId])
    await pool.query('DELETE FROM documents WHERE id = $1', [privateDocumentId])
    await pool.query('DELETE FROM workspace_memberships WHERE user_id IN ($1, $2)', [testUserId, otherUserId])
    await pool.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_no_delete')
    await pool.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_no_update')
    await pool.query("DELETE FROM audit_logs WHERE action = 'document.view_denied' AND workspace_id = $1", [testWorkspaceId])
    await pool.query('DELETE FROM users WHERE id IN ($1, $2)', [testUserId, otherUserId])
    await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId])
    await pool.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_no_update')
    await pool.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_no_delete')
  })

  it('logs denial when accessing private document', async () => {
    const res = await request(app)
      .get(`/api/documents/${privateDocumentId}/content`)
      .set('Cookie', `session_id=${otherUserSessionId}`)

    // Should be denied (404 to not leak document existence)
    expect(res.status).toBe(404)

    // Check audit log was created
    const auditResult = await pool.query(
      `SELECT * FROM audit_logs
       WHERE action = 'document.view_denied'
         AND resource_id = $1
         AND actor_user_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [privateDocumentId, otherUserId]
    )

    expect(auditResult.rows.length).toBe(1)
    const auditLog = auditResult.rows[0]
    expect(auditLog.action).toBe('document.view_denied')
    expect(auditLog.resource_type).toBe('document')
    expect(auditLog.workspace_id).toBe(testWorkspaceId)
    expect(auditLog.details.reason).toBe('private')
  })

  it('logs denial when document not found', async () => {
    const nonExistentId = '00000000-0000-0000-0000-000000000000'

    const res = await request(app)
      .get(`/api/documents/${nonExistentId}/content`)
      .set('Cookie', `session_id=${testUserSessionId}`)

    expect(res.status).toBe(404)

    // Check audit log was created
    const auditResult = await pool.query(
      `SELECT * FROM audit_logs
       WHERE action = 'document.view_denied'
         AND resource_id = $1
         AND actor_user_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [nonExistentId, testUserId]
    )

    expect(auditResult.rows.length).toBe(1)
    const auditLog = auditResult.rows[0]
    expect(auditLog.action).toBe('document.view_denied')
    expect(auditLog.details.reason).toBe('not_found')
  })

  it('logs denial with IP address', async () => {
    // Clean up previous denial logs
    await pool.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_no_delete')
    await pool.query("DELETE FROM audit_logs WHERE action = 'document.view_denied' AND resource_id = $1", [privateDocumentId])
    await pool.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_no_delete')

    await request(app)
      .get(`/api/documents/${privateDocumentId}/content`)
      .set('Cookie', `session_id=${otherUserSessionId}`)

    const auditResult = await pool.query(
      `SELECT ip_address FROM audit_logs
       WHERE action = 'document.view_denied' AND resource_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [privateDocumentId]
    )

    expect(auditResult.rows.length).toBe(1)
    expect(auditResult.rows[0].ip_address).not.toBeNull()
  })

  it('does NOT deduplicate - logs every denial', async () => {
    // Clean up previous denial logs
    await pool.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_no_delete')
    await pool.query("DELETE FROM audit_logs WHERE action = 'document.view_denied' AND resource_id = $1", [privateDocumentId])
    await pool.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_no_delete')

    // Make 3 denied requests
    for (let i = 0; i < 3; i++) {
      await request(app)
        .get(`/api/documents/${privateDocumentId}/content`)
        .set('Cookie', `session_id=${otherUserSessionId}`)
    }

    // Should have 3 separate audit logs
    const auditResult = await pool.query(
      `SELECT COUNT(*) as cnt FROM audit_logs
       WHERE action = 'document.view_denied' AND resource_id = $1`,
      [privateDocumentId]
    )

    expect(parseInt(auditResult.rows[0].cnt)).toBe(3)
  })

  it('owner can still access private document', async () => {
    const res = await request(app)
      .get(`/api/documents/${privateDocumentId}/content`)
      .set('Cookie', `session_id=${testUserSessionId}`)

    // Owner should be able to access
    expect(res.status).toBe(200)
  })

  it('HTTP response unchanged - still returns 404 for denied access', async () => {
    const res = await request(app)
      .get(`/api/documents/${privateDocumentId}/content`)
      .set('Cookie', `session_id=${otherUserSessionId}`)

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Document not found')
  })
})
