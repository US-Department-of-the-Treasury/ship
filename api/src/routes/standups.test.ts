import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import crypto from 'crypto'
import { createApp } from '../app.js'
import { pool } from '../db/client.js'

describe('Standups API', () => {
  const app = createApp()
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const testEmail = `standups-${testRunId}@ship.local`
  const otherEmail = `standups-other-${testRunId}@ship.local`
  const testWorkspaceName = `Standups Test ${testRunId}`

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

    // Create other user (for testing authorization)
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

    // Create session for test user
    const sessionId = crypto.randomBytes(32).toString('hex')
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [sessionId, testUserId, testWorkspaceId]
    )
    sessionCookie = `session_id=${sessionId}`

    // Create session for other user
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

    // Create a program (required for sprint)
    const programResult = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, created_by, visibility)
       VALUES ($1, 'program', 'Test Program', $2, 'workspace')
       RETURNING id`,
      [testWorkspaceId, testUserId]
    )
    testProgramId = programResult.rows[0].id

    // Create a sprint for standup tests
    const sprintResult = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, created_by, parent_id, program_id, visibility)
       VALUES ($1, 'sprint', 'Test Sprint', $2, $3, $3, 'workspace')
       RETURNING id`,
      [testWorkspaceId, testUserId, testProgramId]
    )
    testSprintId = sprintResult.rows[0].id
  })

  afterAll(async () => {
    await pool.query('DELETE FROM sessions WHERE user_id IN ($1, $2)', [testUserId, otherUserId])
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [testWorkspaceId])
    await pool.query('DELETE FROM workspace_memberships WHERE user_id IN ($1, $2)', [testUserId, otherUserId])
    await pool.query('DELETE FROM users WHERE id IN ($1, $2)', [testUserId, otherUserId])
    await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId])
  })

  beforeEach(async () => {
    // Clean up standups before each test
    await pool.query(
      `DELETE FROM documents WHERE workspace_id = $1 AND document_type = 'standup'`,
      [testWorkspaceId]
    )
  })

  describe('POST /api/sprints/:id/standups', () => {
    it('creates standup with valid sprint_id and returns 201', async () => {
      const response = await request(app)
        .post(`/api/sprints/${testSprintId}/standups`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'My standup' }] }] },
          title: 'Daily Standup'
        })

      expect(response.status).toBe(201)
      expect(response.body.id).toBeDefined()
      expect(response.body.sprint_id).toBe(testSprintId)
      expect(response.body.author_id).toBe(testUserId)
      expect(response.body.title).toBe('Daily Standup')
    })

    it('returns 404 for non-existent sprint', async () => {
      const fakeSprintId = '00000000-0000-0000-0000-000000000000'
      const response = await request(app)
        .post(`/api/sprints/${fakeSprintId}/standups`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ content: { type: 'doc', content: [] } })

      expect(response.status).toBe(404)
      expect(response.body.error).toBe('Sprint not found')
    })

    it('returns 403 without auth (CSRF check first)', async () => {
      const response = await request(app)
        .post(`/api/sprints/${testSprintId}/standups`)
        .send({ content: { type: 'doc', content: [] } })

      expect(response.status).toBe(403)
    })

    it('uses default title when not provided', async () => {
      const response = await request(app)
        .post(`/api/sprints/${testSprintId}/standups`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({})

      expect(response.status).toBe(201)
      expect(response.body.title).toBe('Standup Update')
    })
  })

  describe('GET /api/sprints/:id/standups', () => {
    it('returns array sorted newest first', async () => {
      // Create two standups with different timestamps
      await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, parent_id, created_by, properties, visibility, created_at)
         VALUES ($1, 'standup', 'First', $2, $3, $4, 'workspace', now() - interval '1 hour')`,
        [testWorkspaceId, testSprintId, testUserId, JSON.stringify({ author_id: testUserId })]
      )
      await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, parent_id, created_by, properties, visibility, created_at)
         VALUES ($1, 'standup', 'Second', $2, $3, $4, 'workspace', now())`,
        [testWorkspaceId, testSprintId, testUserId, JSON.stringify({ author_id: testUserId })]
      )

      const response = await request(app)
        .get(`/api/sprints/${testSprintId}/standups`)
        .set('Cookie', sessionCookie)

      expect(response.status).toBe(200)
      expect(Array.isArray(response.body)).toBe(true)
      expect(response.body.length).toBe(2)
      expect(response.body[0].title).toBe('Second') // Newest first
      expect(response.body[1].title).toBe('First')
    })

    it('returns empty array for sprint with no standups', async () => {
      const response = await request(app)
        .get(`/api/sprints/${testSprintId}/standups`)
        .set('Cookie', sessionCookie)

      expect(response.status).toBe(200)
      expect(response.body).toEqual([])
    })

    it('returns 404 for non-existent sprint', async () => {
      const fakeSprintId = '00000000-0000-0000-0000-000000000000'
      const response = await request(app)
        .get(`/api/sprints/${fakeSprintId}/standups`)
        .set('Cookie', sessionCookie)

      expect(response.status).toBe(404)
    })
  })

  describe('PATCH /api/standups/:id', () => {
    let standupId: string

    beforeEach(async () => {
      // Create a standup for update tests
      const result = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, parent_id, created_by, properties, visibility)
         VALUES ($1, 'standup', 'Original Title', $2, $3, $4, 'workspace')
         RETURNING id`,
        [testWorkspaceId, testSprintId, testUserId, JSON.stringify({ author_id: testUserId })]
      )
      standupId = result.rows[0].id
    })

    it('updates content and returns 200', async () => {
      const newContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Updated content' }] }] }
      const response = await request(app)
        .patch(`/api/standups/${standupId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ content: newContent, title: 'Updated Title' })

      expect(response.status).toBe(200)
      expect(response.body.title).toBe('Updated Title')
      expect(response.body.content).toEqual(newContent)
    })

    it('returns 403 for non-author', async () => {
      const response = await request(app)
        .patch(`/api/standups/${standupId}`)
        .set('Cookie', otherSessionCookie)
        .set('x-csrf-token', otherCsrfToken)
        .send({ title: 'Hacked Title' })

      expect(response.status).toBe(403)
      expect(response.body.error).toContain('Only the author')
    })

    it('returns 404 for non-existent standup', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000'
      const response = await request(app)
        .patch(`/api/standups/${fakeId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ title: 'New Title' })

      expect(response.status).toBe(404)
    })
  })

  describe('DELETE /api/standups/:id', () => {
    let standupId: string

    beforeEach(async () => {
      const result = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, parent_id, created_by, properties, visibility)
         VALUES ($1, 'standup', 'To Delete', $2, $3, $4, 'workspace')
         RETURNING id`,
        [testWorkspaceId, testSprintId, testUserId, JSON.stringify({ author_id: testUserId })]
      )
      standupId = result.rows[0].id
    })

    it('removes standup and returns 204', async () => {
      const response = await request(app)
        .delete(`/api/standups/${standupId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)

      expect(response.status).toBe(204)

      // Verify deletion
      const checkResult = await pool.query(
        'SELECT id FROM documents WHERE id = $1',
        [standupId]
      )
      expect(checkResult.rows.length).toBe(0)
    })

    it('returns 403 for non-author', async () => {
      const response = await request(app)
        .delete(`/api/standups/${standupId}`)
        .set('Cookie', otherSessionCookie)
        .set('x-csrf-token', otherCsrfToken)

      expect(response.status).toBe(403)
      expect(response.body.error).toContain('Only the author')
    })

    it('returns 404 for non-existent standup', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000'
      const response = await request(app)
        .delete(`/api/standups/${fakeId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)

      expect(response.status).toBe(404)
    })
  })
})
