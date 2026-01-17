import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import crypto from 'crypto'
import { createApp } from '../app.js'
import { pool } from '../db/client.js'

describe('Documents API - Delete', () => {
  const app = createApp()
  // Use unique identifiers to avoid conflicts between concurrent test runs
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const testEmail = `docs-delete-${testRunId}@ship.local`
  const testWorkspaceName = `Docs Delete Test ${testRunId}`

  let sessionCookie: string
  let csrfToken: string
  let testDocumentId: string
  let testWorkspaceId: string
  let testUserId: string

  // Setup: Create a test user and session
  beforeAll(async () => {
    // Create test workspace
    const workspaceResult = await pool.query(
      `INSERT INTO workspaces (name) VALUES ($1)
       RETURNING id`,
      [testWorkspaceName]
    )
    testWorkspaceId = workspaceResult.rows[0].id

    // Create test user
    const userResult = await pool.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Test User')
       RETURNING id`,
      [testEmail]
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

describe('Documents API - Conversion', () => {
  const app = createApp()
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const testEmail = `docs-convert-${testRunId}@ship.local`
  const testWorkspaceName = `Docs Convert Test ${testRunId}`

  let sessionCookie: string
  let csrfToken: string
  let testWorkspaceId: string
  let testUserId: string
  let testProgramId: string

  // Setup: Create a test user, session, and program
  beforeAll(async () => {
    // Create test workspace
    const workspaceResult = await pool.query(
      `INSERT INTO workspaces (name) VALUES ($1)
       RETURNING id`,
      [testWorkspaceName]
    )
    testWorkspaceId = workspaceResult.rows[0].id

    // Create test user
    const userResult = await pool.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Test User')
       RETURNING id`,
      [testEmail]
    )
    testUserId = userResult.rows[0].id

    // Create workspace membership
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [testWorkspaceId, testUserId]
    )

    // Create a test program for association testing
    const programResult = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, created_by)
       VALUES ($1, 'program', 'Test Program', $2)
       RETURNING id`,
      [testWorkspaceId, testUserId]
    )
    testProgramId = programResult.rows[0].id

    // Create session
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
    await pool.query('DELETE FROM document_associations WHERE document_id IN (SELECT id FROM documents WHERE workspace_id = $1)', [testWorkspaceId])
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [testUserId])
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [testWorkspaceId])
    await pool.query('DELETE FROM workspace_memberships WHERE user_id = $1', [testUserId])
    await pool.query('DELETE FROM users WHERE id = $1', [testUserId])
    await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId])
  })

  describe('POST /api/documents/:id/convert', () => {
    it('should convert issue to project and copy program associations', async () => {
      // Create an issue
      const issueResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, ticket_number, created_by)
         VALUES ($1, 'issue', 'Issue to Convert', 1001, $2)
         RETURNING id`,
        [testWorkspaceId, testUserId]
      )
      const issueId = issueResult.rows[0].id

      // Add program association to the issue
      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'program')`,
        [issueId, testProgramId]
      )

      // Convert issue to project
      const response = await request(app)
        .post(`/api/documents/${issueId}/convert`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ target_type: 'project' })

      expect(response.status).toBe(201)
      expect(response.body.document_type).toBe('project')

      const newProjectId = response.body.id

      // Verify program association was copied to new project
      const assocResult = await pool.query(
        `SELECT * FROM document_associations
         WHERE document_id = $1 AND related_id = $2 AND relationship_type = 'program'`,
        [newProjectId, testProgramId]
      )
      expect(assocResult.rows.length).toBe(1)

      // Verify converted_from_id pointer
      expect(response.body.converted_from_id).toBe(issueId)
    })

    it('should convert project to issue and copy program associations', async () => {
      // Create a project
      const projectResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, created_by)
         VALUES ($1, 'project', 'Project to Convert', $2)
         RETURNING id`,
        [testWorkspaceId, testUserId]
      )
      const projectId = projectResult.rows[0].id

      // Add program association to the project
      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'program')`,
        [projectId, testProgramId]
      )

      // Convert project to issue
      const response = await request(app)
        .post(`/api/documents/${projectId}/convert`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ target_type: 'issue' })

      expect(response.status).toBe(201)
      expect(response.body.document_type).toBe('issue')

      const newIssueId = response.body.id

      // Verify program association was copied to new issue
      const assocResult = await pool.query(
        `SELECT * FROM document_associations
         WHERE document_id = $1 AND related_id = $2 AND relationship_type = 'program'`,
        [newIssueId, testProgramId]
      )
      expect(assocResult.rows.length).toBe(1)

      // Verify converted_from_id pointer
      expect(response.body.converted_from_id).toBe(projectId)
    })
  })

  describe('POST /api/documents/:id/undo-conversion', () => {
    it('should undo conversion and restore original associations', async () => {
      // Create an issue
      const issueResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, ticket_number, created_by)
         VALUES ($1, 'issue', 'Issue for Undo Test', 1002, $2)
         RETURNING id`,
        [testWorkspaceId, testUserId]
      )
      const originalIssueId = issueResult.rows[0].id

      // Add program association to the issue
      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'program')`,
        [originalIssueId, testProgramId]
      )

      // Convert issue to project
      const convertResponse = await request(app)
        .post(`/api/documents/${originalIssueId}/convert`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ target_type: 'project' })

      expect(convertResponse.status).toBe(201)
      const projectId = convertResponse.body.id

      // Undo the conversion
      const undoResponse = await request(app)
        .post(`/api/documents/${projectId}/undo-conversion`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)

      expect(undoResponse.status).toBe(200)
      expect(undoResponse.body.restored_document.id).toBe(originalIssueId)
      expect(undoResponse.body.restored_document.document_type).toBe('issue')

      // Verify original issue has its association restored
      const assocResult = await pool.query(
        `SELECT * FROM document_associations
         WHERE document_id = $1 AND related_id = $2 AND relationship_type = 'program'`,
        [originalIssueId, testProgramId]
      )
      expect(assocResult.rows.length).toBe(1)

      // Verify project is now archived
      const projectResult = await pool.query(
        `SELECT archived_at, converted_to_id FROM documents WHERE id = $1`,
        [projectId]
      )
      expect(projectResult.rows[0].archived_at).not.toBeNull()
      expect(projectResult.rows[0].converted_to_id).toBe(originalIssueId)
    })

    it('should have no orphaned associations after conversion/undo cycle', async () => {
      // Create an issue
      const issueResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, ticket_number, created_by)
         VALUES ($1, 'issue', 'Issue for Orphan Test', 1003, $2)
         RETURNING id`,
        [testWorkspaceId, testUserId]
      )
      const issueId = issueResult.rows[0].id

      // Add program association
      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'program')`,
        [issueId, testProgramId]
      )

      // Count associations before
      const beforeCount = await pool.query(
        `SELECT COUNT(*) FROM document_associations
         WHERE document_id = $1 OR related_id = $1`,
        [issueId]
      )

      // Convert to project
      const convertResponse = await request(app)
        .post(`/api/documents/${issueId}/convert`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ target_type: 'project' })

      const projectId = convertResponse.body.id

      // Undo conversion
      await request(app)
        .post(`/api/documents/${projectId}/undo-conversion`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)

      // Count associations after - should be same as before (1 program association)
      const afterCount = await pool.query(
        `SELECT COUNT(*) FROM document_associations
         WHERE document_id = $1 OR related_id = $1`,
        [issueId]
      )

      expect(parseInt(afterCount.rows[0].count)).toBe(parseInt(beforeCount.rows[0].count))
    })
  })
})
