import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import crypto from 'crypto'
import { createApp } from '../app.js'
import { pool } from '../db/client.js'

describe('Sprint Reviews API', () => {
  const app = createApp()
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const testEmail = `sprint-reviews-${testRunId}@ship.local`
  const otherEmail = `sprint-reviews-other-${testRunId}@ship.local`
  const testWorkspaceName = `Sprint Reviews Test ${testRunId}`

  let sessionCookie: string
  let otherSessionCookie: string
  let csrfToken: string
  let otherCsrfToken: string
  let testWorkspaceId: string
  let testUserId: string
  let otherUserId: string
  let testSprintId: string
  let testProgramId: string

  beforeAll(async () => {
    // Create test workspace
    const workspaceResult = await pool.query(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
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

    // Create other user
    const otherUserResult = await pool.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Other User')
       RETURNING id`,
      [otherEmail]
    )
    otherUserId = otherUserResult.rows[0].id

    // Create workspace memberships
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [testWorkspaceId, testUserId]
    )
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [testWorkspaceId, otherUserId]
    )

    // Create sessions
    const sessionId = crypto.randomBytes(32).toString('hex')
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [sessionId, testUserId, testWorkspaceId]
    )
    sessionCookie = `session_id=${sessionId}`

    const otherSessionId = crypto.randomBytes(32).toString('hex')
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [otherSessionId, otherUserId, testWorkspaceId]
    )
    otherSessionCookie = `session_id=${otherSessionId}`

    // Get CSRF tokens
    const csrfRes = await request(app)
      .get('/api/csrf-token')
      .set('Cookie', sessionCookie)
    csrfToken = csrfRes.body.token
    const connectSidCookie = csrfRes.headers['set-cookie']?.[0]?.split(';')[0] || ''
    if (connectSidCookie) {
      sessionCookie = `${sessionCookie}; ${connectSidCookie}`
    }

    const otherCsrfRes = await request(app)
      .get('/api/csrf-token')
      .set('Cookie', otherSessionCookie)
    otherCsrfToken = otherCsrfRes.body.token
    const otherConnectSidCookie = otherCsrfRes.headers['set-cookie']?.[0]?.split(';')[0] || ''
    if (otherConnectSidCookie) {
      otherSessionCookie = `${otherSessionCookie}; ${otherConnectSidCookie}`
    }

    // Create a program
    const programResult = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, created_by, visibility)
       VALUES ($1, 'program', 'Test Program', $2, 'workspace')
       RETURNING id`,
      [testWorkspaceId, testUserId]
    )
    testProgramId = programResult.rows[0].id
  })

  afterAll(async () => {
    await pool.query('DELETE FROM sessions WHERE user_id IN ($1, $2)', [testUserId, otherUserId])
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [testWorkspaceId])
    await pool.query('DELETE FROM workspace_memberships WHERE user_id IN ($1, $2)', [testUserId, otherUserId])
    await pool.query('DELETE FROM users WHERE id IN ($1, $2)', [testUserId, otherUserId])
    await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId])
  })

  beforeEach(async () => {
    // Clean up sprints and reviews before each test
    await pool.query(
      `DELETE FROM documents WHERE workspace_id = $1 AND document_type IN ('sprint', 'sprint_review', 'issue')`,
      [testWorkspaceId]
    )
    // Create fresh sprint
    const sprintResult = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, created_by, parent_id, program_id, visibility, properties)
       VALUES ($1, 'sprint', 'Test Sprint', $2, $3, $3, 'workspace', $4)
       RETURNING id`,
      [testWorkspaceId, testUserId, testProgramId, JSON.stringify({ hypothesis: 'Test hypothesis for sprint' })]
    )
    testSprintId = sprintResult.rows[0].id
  })

  describe('GET /api/sprints/:id/review', () => {
    it('returns pre-filled draft with is_draft: true for new sprint', async () => {
      const response = await request(app)
        .get(`/api/sprints/${testSprintId}/review`)
        .set('Cookie', sessionCookie)

      expect(response.status).toBe(200)
      expect(response.body.is_draft).toBe(true)
      expect(response.body.content).toBeDefined()
      expect(response.body.content.type).toBe('doc')
    })

    it('returns existing review with is_draft: false after POST', async () => {
      // First create a review
      await request(app)
        .post(`/api/sprints/${testSprintId}/review`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          content: { type: 'doc', content: [{ type: 'paragraph' }] },
          hypothesis_validated: true
        })

      // Then GET should return existing review
      const response = await request(app)
        .get(`/api/sprints/${testSprintId}/review`)
        .set('Cookie', sessionCookie)

      expect(response.status).toBe(200)
      expect(response.body.is_draft).toBe(false)
      expect(response.body.hypothesis_validated).toBe(true)
    })

    it('pre-fill content includes issues information', async () => {
      // Create some issues for the sprint
      await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, sprint_id, created_by, visibility, properties)
         VALUES ($1, 'issue', 'Done Issue', $2, $3, 'workspace', $4)`,
        [testWorkspaceId, testSprintId, testUserId, JSON.stringify({ state: 'done' })]
      )
      await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, sprint_id, created_by, visibility, properties)
         VALUES ($1, 'issue', 'In Progress Issue', $2, $3, 'workspace', $4)`,
        [testWorkspaceId, testSprintId, testUserId, JSON.stringify({ state: 'in_progress' })]
      )

      const response = await request(app)
        .get(`/api/sprints/${testSprintId}/review`)
        .set('Cookie', sessionCookie)

      expect(response.status).toBe(200)
      expect(response.body.is_draft).toBe(true)
      expect(response.body.content).toBeDefined()
      // Content should include issues in the pre-filled text
      const contentStr = JSON.stringify(response.body.content)
      expect(contentStr).toContain('Done Issue')
    })

    it('returns 404 for non-existent sprint', async () => {
      const fakeSprintId = '00000000-0000-0000-0000-000000000000'
      const response = await request(app)
        .get(`/api/sprints/${fakeSprintId}/review`)
        .set('Cookie', sessionCookie)

      expect(response.status).toBe(404)
    })
  })

  describe('POST /api/sprints/:id/review', () => {
    it('creates sprint_review document with owner_id', async () => {
      const response = await request(app)
        .post(`/api/sprints/${testSprintId}/review`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Review content' }] }] },
          hypothesis_validated: true
        })

      expect(response.status).toBe(201)
      expect(response.body.owner_id).toBe(testUserId)
      expect(response.body.sprint_id).toBe(testSprintId)
      expect(response.body.hypothesis_validated).toBe(true)
    })

    it('returns 403 without auth (CSRF check first)', async () => {
      const response = await request(app)
        .post(`/api/sprints/${testSprintId}/review`)
        .send({ content: { type: 'doc', content: [] } })

      expect(response.status).toBe(403)
    })

    it('returns 409 if review already exists', async () => {
      // Create first review
      await request(app)
        .post(`/api/sprints/${testSprintId}/review`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ content: { type: 'doc', content: [] } })

      // Try to create second review
      const response = await request(app)
        .post(`/api/sprints/${testSprintId}/review`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ content: { type: 'doc', content: [] } })

      expect(response.status).toBe(409)
    })
  })

  describe('PATCH /api/sprints/:id/review', () => {
    beforeEach(async () => {
      // Create a review to update
      await request(app)
        .post(`/api/sprints/${testSprintId}/review`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          content: { type: 'doc', content: [] },
          hypothesis_validated: null
        })
    })

    it('updates hypothesis_validated and content', async () => {
      const newContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Updated' }] }] }
      const response = await request(app)
        .patch(`/api/sprints/${testSprintId}/review`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          content: newContent,
          hypothesis_validated: false
        })

      expect(response.status).toBe(200)
      expect(response.body.hypothesis_validated).toBe(false)
      expect(response.body.content).toEqual(newContent)
    })

    it('returns 403 for non-owner', async () => {
      const response = await request(app)
        .patch(`/api/sprints/${testSprintId}/review`)
        .set('Cookie', otherSessionCookie)
        .set('x-csrf-token', otherCsrfToken)
        .send({ hypothesis_validated: true })

      expect(response.status).toBe(403)
    })

    it('returns 404 when no review exists', async () => {
      // Delete the review first
      await pool.query(
        `DELETE FROM documents WHERE document_type = 'sprint_review' AND properties->>'sprint_id' = $1`,
        [testSprintId]
      )

      const response = await request(app)
        .patch(`/api/sprints/${testSprintId}/review`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ hypothesis_validated: true })

      expect(response.status).toBe(404)
    })
  })
})
