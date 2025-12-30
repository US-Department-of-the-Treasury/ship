import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import { pool } from '../db/client.js'

describe('Documents API - Delete', () => {
  const app = createApp()
  let sessionCookie: string
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
      `INSERT INTO users (email, password_hash, name, workspace_id)
       VALUES ('test-delete@ship.local', 'test-hash', 'Test User', $1)
       RETURNING id`,
      [testWorkspaceId]
    )
    testUserId = userResult.rows[0].id

    // Create session (sessions also need workspace_id)
    const sessionResult = await pool.query(
      `INSERT INTO sessions (user_id, workspace_id, expires_at)
       VALUES ($1, $2, now() + interval '1 hour')
       RETURNING id`,
      [testUserId, testWorkspaceId]
    )
    sessionCookie = `session_id=${sessionResult.rows[0].id}`
  })

  // Cleanup after all tests
  afterAll(async () => {
    // Clean up test data in correct order (foreign keys)
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [testUserId])
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [testWorkspaceId])
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

      expect(response.status).toBe(404)
      expect(response.body.error).toBe('Document not found')
    })

    it('should return 401 when not authenticated', async () => {
      const response = await request(app)
        .delete(`/api/documents/${testDocumentId}`)

      expect(response.status).toBe(401)
      expect(response.body.error).toBe('Not authenticated')
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

      expect(response.status).toBe(204)

      // Verify parent document is deleted
      const checkResult = await pool.query(
        'SELECT id FROM documents WHERE id = $1',
        [testDocumentId]
      )
      expect(checkResult.rows.length).toBe(0)
    })

    it('should return 401 when session is expired', async () => {
      // Create expired session
      const expiredSessionResult = await pool.query(
        `INSERT INTO sessions (user_id, workspace_id, expires_at)
         VALUES ($1, $2, now() - interval '1 hour')
         RETURNING id`,
        [testUserId, testWorkspaceId]
      )
      const expiredCookie = `session_id=${expiredSessionResult.rows[0].id}`

      const response = await request(app)
        .delete(`/api/documents/${testDocumentId}`)
        .set('Cookie', expiredCookie)

      expect(response.status).toBe(401)
      expect(response.body.error).toBe('Session expired')

      // Cleanup expired session
      await pool.query('DELETE FROM sessions WHERE id = $1', [expiredSessionResult.rows[0].id])
    })
  })
})
