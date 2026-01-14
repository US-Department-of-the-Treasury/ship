import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import crypto from 'crypto'
import { createApp } from '../app.js'
import { pool } from '../db/client.js'

describe('Project Retros API', () => {
  const app = createApp()
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const testEmail = `project-retros-${testRunId}@ship.local`
  const otherEmail = `project-retros-other-${testRunId}@ship.local`
  const testWorkspaceName = `Project Retros Test ${testRunId}`

  let sessionCookie: string
  let otherSessionCookie: string
  let csrfToken: string
  let otherCsrfToken: string
  let testWorkspaceId: string
  let testUserId: string
  let otherUserId: string
  let testProjectId: string
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

    // Create other user (not in workspace for auth tests)
    const otherUserResult = await pool.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Other User')
       RETURNING id`,
      [otherEmail]
    )
    otherUserId = otherUserResult.rows[0].id

    // Create workspace memberships (only test user)
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [testWorkspaceId, testUserId]
    )

    // Create other workspace for other user
    const otherWorkspaceResult = await pool.query(
      `INSERT INTO workspaces (name) VALUES ('Other Workspace') RETURNING id`
    )
    const otherWorkspaceId = otherWorkspaceResult.rows[0].id
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [otherWorkspaceId, otherUserId]
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
      [otherSessionId, otherUserId, otherWorkspaceId]
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
    await pool.query(`DELETE FROM workspaces WHERE name IN ($1, 'Other Workspace')`, [testWorkspaceName])
  })

  beforeEach(async () => {
    // Clean up projects before each test
    await pool.query(
      `DELETE FROM documents WHERE workspace_id = $1 AND document_type IN ('project', 'sprint', 'issue')`,
      [testWorkspaceId]
    )
    // Create fresh project with ICE scores
    const projectResult = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, created_by, parent_id, visibility, properties)
       VALUES ($1, 'project', 'Test Project', $2, $3, 'workspace', $4)
       RETURNING id`,
      [testWorkspaceId, testUserId, testProgramId, JSON.stringify({
        hypothesis: 'We believe that X will result in Y',
        impact: 8,
        confidence: 7,
        ease: 5,
        monetary_impact_expected: '$50,000'
      })]
    )
    testProjectId = projectResult.rows[0].id
  })

  describe('GET /api/projects/:id/retro', () => {
    it('returns pre-filled draft with is_draft: true for project without retro', async () => {
      const response = await request(app)
        .get(`/api/projects/${testProjectId}/retro`)
        .set('Cookie', sessionCookie)

      expect(response.status).toBe(200)
      expect(response.body.is_draft).toBe(true)
      expect(response.body.content).toBeDefined()
      expect(response.body.content.type).toBe('doc')
    })

    it('pre-fill includes monetary_impact_expected from project properties', async () => {
      const response = await request(app)
        .get(`/api/projects/${testProjectId}/retro`)
        .set('Cookie', sessionCookie)

      expect(response.status).toBe(200)
      expect(response.body.monetary_impact_expected).toBe('$50,000')
      expect(response.body.is_draft).toBe(true)
    })

    it('pre-fill includes sprints list associated with project', async () => {
      // Create a sprint linked to the project
      await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, project_id, parent_id, program_id, created_by, visibility)
         VALUES ($1, 'sprint', 'Sprint 1', $2, $3, $3, $4, 'workspace')`,
        [testWorkspaceId, testProjectId, testProgramId, testUserId]
      )

      const response = await request(app)
        .get(`/api/projects/${testProjectId}/retro`)
        .set('Cookie', sessionCookie)

      expect(response.status).toBe(200)
      expect(response.body.sprints).toBeDefined()
      expect(response.body.sprints.length).toBe(1)
      expect(response.body.sprints[0].title).toBe('Sprint 1')
    })

    it('pre-fill includes issues categorized (completed/active/cancelled)', async () => {
      // Create issues in various states
      await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, project_id, created_by, visibility, properties)
         VALUES ($1, 'issue', 'Done Issue', $2, $3, 'workspace', $4)`,
        [testWorkspaceId, testProjectId, testUserId, JSON.stringify({ state: 'done' })]
      )
      await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, project_id, created_by, visibility, properties)
         VALUES ($1, 'issue', 'Active Issue', $2, $3, 'workspace', $4)`,
        [testWorkspaceId, testProjectId, testUserId, JSON.stringify({ state: 'in_progress' })]
      )
      await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, project_id, created_by, visibility, properties)
         VALUES ($1, 'issue', 'Cancelled Issue', $2, $3, 'workspace', $4)`,
        [testWorkspaceId, testProjectId, testUserId, JSON.stringify({ state: 'cancelled' })]
      )

      const response = await request(app)
        .get(`/api/projects/${testProjectId}/retro`)
        .set('Cookie', sessionCookie)

      expect(response.status).toBe(200)
      expect(response.body.issues_summary).toBeDefined()
      expect(response.body.issues_summary.completed).toBe(1)
      expect(response.body.issues_summary.active).toBe(1)
      expect(response.body.issues_summary.cancelled).toBe(1)
    })

    it('returns 404 for non-existent project', async () => {
      const fakeProjectId = '00000000-0000-0000-0000-000000000000'
      const response = await request(app)
        .get(`/api/projects/${fakeProjectId}/retro`)
        .set('Cookie', sessionCookie)

      expect(response.status).toBe(404)
    })
  })

  describe('POST /api/projects/:id/retro', () => {
    it('updates project properties (hypothesis_validated, monetary_impact_actual, etc)', async () => {
      const response = await request(app)
        .post(`/api/projects/${testProjectId}/retro`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          hypothesis_validated: true,
          monetary_impact_actual: '$75,000',
          success_criteria: ['Increased signups by 20%', 'Reduced churn by 15%'],
          next_steps: 'Scale to all users'
        })

      expect(response.status).toBe(201)
      expect(response.body.hypothesis_validated).toBe(true)
      expect(response.body.monetary_impact_actual).toBe('$75,000')
      expect(response.body.success_criteria).toEqual(['Increased signups by 20%', 'Reduced churn by 15%'])
      expect(response.body.next_steps).toBe('Scale to all users')
    })

    it('returns 403 without auth (CSRF check first)', async () => {
      const response = await request(app)
        .post(`/api/projects/${testProjectId}/retro`)
        .send({ hypothesis_validated: true })

      expect(response.status).toBe(403)
    })

    it('returns 404 for non-existent project', async () => {
      const fakeProjectId = '00000000-0000-0000-0000-000000000000'
      const response = await request(app)
        .post(`/api/projects/${fakeProjectId}/retro`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ hypothesis_validated: true })

      expect(response.status).toBe(404)
    })
  })

  describe('PATCH /api/projects/:id/retro', () => {
    beforeEach(async () => {
      // Set initial retro data
      await request(app)
        .post(`/api/projects/${testProjectId}/retro`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          hypothesis_validated: null,
          monetary_impact_actual: '',
          success_criteria: [],
          next_steps: ''
        })
    })

    it('updates existing retro properties', async () => {
      const response = await request(app)
        .patch(`/api/projects/${testProjectId}/retro`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          hypothesis_validated: false,
          monetary_impact_actual: '$10,000',
          next_steps: 'Pivot to new approach'
        })

      expect(response.status).toBe(200)
      expect(response.body.hypothesis_validated).toBe(false)
      expect(response.body.monetary_impact_actual).toBe('$10,000')
      expect(response.body.next_steps).toBe('Pivot to new approach')
    })

    it('returns 404 for user not in workspace (non-member)', async () => {
      const response = await request(app)
        .patch(`/api/projects/${testProjectId}/retro`)
        .set('Cookie', otherSessionCookie)
        .set('x-csrf-token', otherCsrfToken)
        .send({ hypothesis_validated: true })

      expect(response.status).toBe(404)
    })

    it('returns 404 for non-existent project', async () => {
      const fakeProjectId = '00000000-0000-0000-0000-000000000000'
      const response = await request(app)
        .patch(`/api/projects/${fakeProjectId}/retro`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ hypothesis_validated: true })

      expect(response.status).toBe(404)
    })
  })
})
