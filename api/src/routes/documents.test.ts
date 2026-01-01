import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import crypto from 'crypto'
import { createApp } from '../app.js'
import { pool } from '../db/client.js'

describe('Documents API - Delete', () => {
  const app = createApp()
  let sessionCookie: string
  let csrfToken: string
  let testDocumentId: string
  let testWorkspaceId: string
  let testUserId: string

  // Setup: Create a test user and session
  beforeAll(async () => {
    // Create test workspace
    const workspaceResult = await pool.query(
      `INSERT INTO workspaces (name) VALUES ('Test Workspace Delete')
       RETURNING id`
    )
    testWorkspaceId = workspaceResult.rows[0].id

    // Create test user
    const userResult = await pool.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ('test-delete@ship.local', 'test-hash', 'Test User')
       RETURNING id`
    )
    testUserId = userResult.rows[0].id

    // Create workspace membership
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [testWorkspaceId, testUserId]
    )

    // Create session (sessions.id is TEXT not UUID, generated from crypto.randomBytes)
    const sessionId = crypto.randomBytes(32).toString('hex')
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 hour')`,
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

  // Cleanup after all tests
  afterAll(async () => {
    // Clean up test data in correct order (foreign keys)
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [testUserId])
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [testWorkspaceId])
    await pool.query('DELETE FROM workspace_memberships WHERE user_id = $1', [testUserId])
    await pool.query('DELETE FROM users WHERE id = $1', [testUserId])
    await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId])
  })

  // Create a fresh document before each test
  beforeEach(async () => {
    // Clean up any documents from previous tests
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [testWorkspaceId])

    const docResult = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, created_by)
       VALUES ($1, 'wiki', 'Test Document', $2)
       RETURNING id`,
      [testWorkspaceId, testUserId]
    )
    testDocumentId = docResult.rows[0].id
  })

  describe('DELETE /api/documents/:id', () => {
    it('should delete a document and return 204', async () => {
      const response = await request(app)
        .delete(`/api/documents/${testDocumentId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)

      expect(response.status).toBe(204)

      // Verify document is actually deleted
      const checkResult = await pool.query(
        'SELECT id FROM documents WHERE id = $1',
        [testDocumentId]
      )
      expect(checkResult.rows.length).toBe(0)
    })

    it('should return 404 when deleting non-existent document', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000'

      const response = await request(app)
        .delete(`/api/documents/${fakeId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)

      expect(response.status).toBe(404)
      expect(response.body.error).toBe('Document not found')
    })

    it('should return 403 when not authenticated (CSRF check runs first)', async () => {
      const response = await request(app)
        .delete(`/api/documents/${testDocumentId}`)

      // Without session cookie, CSRF validation fails first (403) before auth check (401)
      expect(response.status).toBe(403)
    })

    it('should return 404 when trying to delete document from another workspace', async () => {
      // Create document in a different workspace
      const otherWorkspaceResult = await pool.query(
        `INSERT INTO workspaces (name) VALUES ('Other Workspace Delete')
         RETURNING id`
      )
      const otherWorkspaceId = otherWorkspaceResult.rows[0].id

      const otherDocResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, created_by)
         VALUES ($1, 'wiki', 'Other Document', $2)
         RETURNING id`,
        [otherWorkspaceId, testUserId]
      )
      const otherDocumentId = otherDocResult.rows[0].id

      // Try to delete document from another workspace
      const response = await request(app)
        .delete(`/api/documents/${otherDocumentId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)

      // Should return 404 because the document doesn't belong to user's workspace
      expect(response.status).toBe(404)
      expect(response.body.error).toBe('Document not found')

      // Cleanup
      await pool.query('DELETE FROM documents WHERE id = $1', [otherDocumentId])
      await pool.query('DELETE FROM workspaces WHERE id = $1', [otherWorkspaceId])
    })

    it('should allow deleting a document with children (cascade)', async () => {
      // Create a child document
      await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, parent_id, created_by)
         VALUES ($1, 'wiki', 'Child Document', $2, $3)`,
        [testWorkspaceId, testDocumentId, testUserId]
      )

      const response = await request(app)
        .delete(`/api/documents/${testDocumentId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)

      expect(response.status).toBe(204)

      // Verify parent document is deleted
      const checkResult = await pool.query(
        'SELECT id FROM documents WHERE id = $1',
        [testDocumentId]
      )
      expect(checkResult.rows.length).toBe(0)
    })

    it('should return 403 when session is expired (CSRF check runs first)', async () => {
      // Create expired session (sessions.id is TEXT not UUID, generated from crypto.randomBytes)
      const expiredSessionId = crypto.randomBytes(32).toString('hex')
      await pool.query(
        `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
         VALUES ($1, $2, $3, now() - interval '1 hour')`,
        [expiredSessionId, testUserId, testWorkspaceId]
      )
      const expiredCookie = `session_id=${expiredSessionId}`

      const response = await request(app)
        .delete(`/api/documents/${testDocumentId}`)
        .set('Cookie', expiredCookie)
        .set('x-csrf-token', csrfToken)

      // CSRF validation fails first (403) because the CSRF token is bound to a different session
      expect(response.status).toBe(403)

      // Cleanup expired session
      await pool.query('DELETE FROM sessions WHERE id = $1', [expiredSessionId])
    })
  })
})
