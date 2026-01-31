import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import crypto from 'crypto'
import { createApp } from '../app.js'
import { pool } from '../db/client.js'

describe('Audit Document Mutations Logging', () => {
  const app = createApp()
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  let testWorkspaceId: string
  let testUserId: string
  let sessionCookie: string
  let csrfToken: string

  beforeAll(async () => {
    // Create test workspace
    const workspaceResult = await pool.query(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
      [`Audit Mutations Test ${testRunId}`]
    )
    testWorkspaceId = workspaceResult.rows[0].id

    // Create test user
    const userResult = await pool.query(
      `INSERT INTO users (email, name, password_hash) VALUES ($1, 'Audit Mutations Test User', 'test-hash') RETURNING id`,
      [`audit-mutations-${testRunId}@ship.local`]
    )
    testUserId = userResult.rows[0].id

    // Create workspace membership
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'member')`,
      [testWorkspaceId, testUserId]
    )

    // Create session
    const sessionId = crypto.randomBytes(32).toString('hex')
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at, last_activity, created_at)
       VALUES ($1, $2, $3, now() + interval '1 hour', now(), now())`,
      [sessionId, testUserId, testWorkspaceId]
    )
    sessionCookie = `session_id=${sessionId}`

    // Get CSRF token
    const csrfRes = await request(app)
      .get('/api/csrf-token')
      .set('Cookie', sessionCookie)
    csrfToken = csrfRes.body.token
    const connectSidCookie = csrfRes.headers['set-cookie']?.[0]?.split(';')[0] || ''
    if (connectSidCookie) {
      sessionCookie = `${sessionCookie}; ${connectSidCookie}`
    }
  })

  afterAll(async () => {
    // Clean up test data in correct order (FK constraints)
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [testUserId])
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [testWorkspaceId])
    await pool.query('DELETE FROM workspace_memberships WHERE user_id = $1', [testUserId])
    await pool.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_no_delete')
    await pool.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_no_update')
    await pool.query("DELETE FROM audit_logs WHERE workspace_id = $1", [testWorkspaceId])
    await pool.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_no_update')
    await pool.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_no_delete')
    await pool.query('DELETE FROM users WHERE id = $1', [testUserId])
    await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId])
  })

  it('logs document creation', async () => {
    const res = await request(app)
      .post('/api/documents')
      .set('Cookie', sessionCookie)
      .set('x-csrf-token', csrfToken)
      .send({
        title: 'Test Document',
        document_type: 'wiki',
      })

    expect(res.status).toBe(201)
    const docId = res.body.id

    // Check audit log was created
    const auditResult = await pool.query(
      `SELECT * FROM audit_logs
       WHERE action = 'document.create'
         AND resource_id = $1
         AND actor_user_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [docId, testUserId]
    )

    expect(auditResult.rows.length).toBe(1)
    const auditLog = auditResult.rows[0]
    expect(auditLog.action).toBe('document.create')
    expect(auditLog.resource_type).toBe('document')
    expect(auditLog.workspace_id).toBe(testWorkspaceId)
    expect(auditLog.details.document_type).toBe('wiki')
    expect(auditLog.details.title).toBe('Test Document')
  })

  it('logs document update with changed fields', async () => {
    // Create a document first
    const createRes = await request(app)
      .post('/api/documents')
      .set('Cookie', sessionCookie)
      .set('x-csrf-token', csrfToken)
      .send({
        title: 'Original Title',
        document_type: 'wiki',
      })

    expect(createRes.status).toBe(201)
    const docId = createRes.body.id

    // Update the document
    const updateRes = await request(app)
      .patch(`/api/documents/${docId}`)
      .set('Cookie', sessionCookie)
      .set('x-csrf-token', csrfToken)
      .send({
        title: 'Updated Title',
      })

    expect(updateRes.status).toBe(200)

    // Check audit log was created
    const auditResult = await pool.query(
      `SELECT * FROM audit_logs
       WHERE action = 'document.update'
         AND resource_id = $1
         AND actor_user_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [docId, testUserId]
    )

    expect(auditResult.rows.length).toBe(1)
    const auditLog = auditResult.rows[0]
    expect(auditLog.action).toBe('document.update')
    expect(auditLog.resource_type).toBe('document')
    expect(auditLog.details.changed_fields).toContain('title')
    expect(auditLog.details.changes.title.old).toBe('Original Title')
    expect(auditLog.details.changes.title.new).toBe('Updated Title')
  })

  it('skips logging when no fields actually changed', async () => {
    // Create a document first
    const createRes = await request(app)
      .post('/api/documents')
      .set('Cookie', sessionCookie)
      .set('x-csrf-token', csrfToken)
      .send({
        title: 'Same Title',
        document_type: 'wiki',
      })

    expect(createRes.status).toBe(201)
    const docId = createRes.body.id

    // Clean up any existing audit logs for this doc
    await pool.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_no_delete')
    await pool.query("DELETE FROM audit_logs WHERE action = 'document.update' AND resource_id = $1", [docId])
    await pool.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_no_delete')

    // "Update" with the same title
    const updateRes = await request(app)
      .patch(`/api/documents/${docId}`)
      .set('Cookie', sessionCookie)
      .set('x-csrf-token', csrfToken)
      .send({
        title: 'Same Title',  // Same as original
      })

    expect(updateRes.status).toBe(200)

    // Check NO update audit log was created
    const auditResult = await pool.query(
      `SELECT * FROM audit_logs
       WHERE action = 'document.update'
         AND resource_id = $1`,
      [docId]
    )

    expect(auditResult.rows.length).toBe(0)
  })

  it('logs document deletion with snapshot', async () => {
    // Create a document first
    const createRes = await request(app)
      .post('/api/documents')
      .set('Cookie', sessionCookie)
      .set('x-csrf-token', csrfToken)
      .send({
        title: 'Document To Delete',
        document_type: 'wiki',
      })

    expect(createRes.status).toBe(201)
    const docId = createRes.body.id

    // Delete the document
    const deleteRes = await request(app)
      .delete(`/api/documents/${docId}`)
      .set('Cookie', sessionCookie)
      .set('x-csrf-token', csrfToken)

    expect(deleteRes.status).toBe(204)

    // Check audit log was created with snapshot
    const auditResult = await pool.query(
      `SELECT * FROM audit_logs
       WHERE action = 'document.delete'
         AND resource_id = $1
         AND actor_user_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [docId, testUserId]
    )

    expect(auditResult.rows.length).toBe(1)
    const auditLog = auditResult.rows[0]
    expect(auditLog.action).toBe('document.delete')
    expect(auditLog.resource_type).toBe('document')
    expect(auditLog.details.document_type).toBe('wiki')
    expect(auditLog.details.title).toBe('Document To Delete')
    expect(auditLog.details.properties).toBeDefined()
  })

  it('logs issue property updates', async () => {
    // Create an issue document
    const createRes = await request(app)
      .post('/api/documents')
      .set('Cookie', sessionCookie)
      .set('x-csrf-token', csrfToken)
      .send({
        title: 'Test Issue',
        document_type: 'issue',
      })

    expect(createRes.status).toBe(201)
    const docId = createRes.body.id

    // Update the issue state
    const updateRes = await request(app)
      .patch(`/api/documents/${docId}`)
      .set('Cookie', sessionCookie)
      .set('x-csrf-token', csrfToken)
      .send({
        state: 'in_progress',
        priority: 'high',
      })

    expect(updateRes.status).toBe(200)

    // Check audit log captures property changes
    const auditResult = await pool.query(
      `SELECT * FROM audit_logs
       WHERE action = 'document.update'
         AND resource_id = $1
         AND actor_user_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [docId, testUserId]
    )

    expect(auditResult.rows.length).toBe(1)
    const auditLog = auditResult.rows[0]
    expect(auditLog.details.changed_fields).toContain('properties.state')
    expect(auditLog.details.changed_fields).toContain('properties.priority')
  })

  it('does not log actual content in update', async () => {
    // Create a document first
    const createRes = await request(app)
      .post('/api/documents')
      .set('Cookie', sessionCookie)
      .set('x-csrf-token', csrfToken)
      .send({
        title: 'Content Test Doc',
        document_type: 'wiki',
      })

    expect(createRes.status).toBe(201)
    const docId = createRes.body.id

    // Update with content
    const updateRes = await request(app)
      .patch(`/api/documents/${docId}`)
      .set('Cookie', sessionCookie)
      .set('x-csrf-token', csrfToken)
      .send({
        content: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Sensitive information here' }] }
          ]
        }
      })

    expect(updateRes.status).toBe(200)

    // Check audit log does NOT contain actual content
    const auditResult = await pool.query(
      `SELECT * FROM audit_logs
       WHERE action = 'document.update'
         AND resource_id = $1
         AND actor_user_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [docId, testUserId]
    )

    expect(auditResult.rows.length).toBe(1)
    const auditLog = auditResult.rows[0]
    expect(auditLog.details.changed_fields).toContain('content')
    // Changes should NOT have old/new content values
    expect(auditLog.details.changes['content']).toBeUndefined()
    // Details should not contain the sensitive text
    expect(JSON.stringify(auditLog.details)).not.toContain('Sensitive information')
  })
})
