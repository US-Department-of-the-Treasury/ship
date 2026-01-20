import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import crypto from 'crypto'
import { createApp } from '../app.js'
import { pool } from '../db/client.js'

describe('Sprints API', () => {
  const app = createApp()
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const testEmail = `sprints-test-${testRunId}@ship.local`
  const testWorkspaceName = `Sprints Test ${testRunId}`

  let sessionCookie: string
  let csrfToken: string
  let testWorkspaceId: string
  let testUserId: string
  let testProgramId: string
  let testProjectId: string

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
       VALUES ($1, 'test-hash', 'Sprints Test User')
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

    // Create a program (required for sprint)
    const programResult = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, visibility)
       VALUES ($1, 'program', 'Test Program', 'workspace')
       RETURNING id`,
      [testWorkspaceId]
    )
    testProgramId = programResult.rows[0].id

    // Create a project
    const projectResult = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, parent_id)
       VALUES ($1, 'project', 'Test Project', 'workspace', $2)
       RETURNING id`,
      [testWorkspaceId, testProgramId]
    )
    testProjectId = projectResult.rows[0].id
  })

  afterAll(async () => {
    // Clean up in correct order (foreign key constraints)
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [testUserId])
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [testWorkspaceId])
    await pool.query('DELETE FROM workspace_memberships WHERE user_id = $1', [testUserId])
    await pool.query('DELETE FROM users WHERE id = $1', [testUserId])
    await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId])
  })

  describe('GET /api/sprints', () => {
    let testSprintId: string

    beforeAll(async () => {
      // Create a test sprint with sprint_number: 1 (matches default current sprint)
      const sprintResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, program_id, created_by, properties)
         VALUES ($1, 'sprint', 'Test Sprint for List', 'workspace', $2, $3, $4)
         RETURNING id`,
        [testWorkspaceId, testProgramId, testUserId, JSON.stringify({ sprint_number: 1 })]
      )
      testSprintId = sprintResult.rows[0].id
    })

    it('should return list of sprints', async () => {
      const res = await request(app)
        .get('/api/sprints')
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(200)
      expect(res.body.sprints).toBeInstanceOf(Array)
      expect(res.body.sprints.length).toBeGreaterThan(0)

      // Find our test sprint
      const testSprint = res.body.sprints.find((s: { id: string }) => s.id === testSprintId)
      expect(testSprint).toBeDefined()
      expect(testSprint.name).toBe('Test Sprint for List')
    })

    it('should filter sprints by program_id', async () => {
      const res = await request(app)
        .get(`/api/sprints?program_id=${testProgramId}`)
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(200)
      expect(res.body.sprints).toBeInstanceOf(Array)
      const allMatchProgram = res.body.sprints.every((s: { program_id: string }) => s.program_id === testProgramId)
      expect(allMatchProgram).toBe(true)
    })

    it('should reject unauthenticated request', async () => {
      const res = await request(app)
        .get('/api/sprints')

      expect(res.status).toBe(401)
    })
  })

  describe('GET /api/sprints/:id', () => {
    let testSprintId: string

    beforeAll(async () => {
      const sprintResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, program_id, created_by)
         VALUES ($1, 'sprint', 'Test Sprint for Get', 'workspace', $2, $3)
         RETURNING id`,
        [testWorkspaceId, testProgramId, testUserId]
      )
      testSprintId = sprintResult.rows[0].id
    })

    it('should return sprint by id', async () => {
      const res = await request(app)
        .get(`/api/sprints/${testSprintId}`)
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(200)
      expect(res.body.id).toBe(testSprintId)
      expect(res.body.name).toBe('Test Sprint for Get')
    })

    it('should return 404 for non-existent sprint', async () => {
      const fakeId = crypto.randomUUID()
      const res = await request(app)
        .get(`/api/sprints/${fakeId}`)
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(404)
    })
  })

  describe('POST /api/sprints', () => {
    it('should create a new sprint', async () => {
      const res = await request(app)
        .post('/api/sprints')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          title: 'New Test Sprint',
          program_id: testProgramId,
          sprint_number: 100,
        })

      expect(res.status).toBe(201)
      expect(res.body.id).toBeDefined()
      expect(res.body.name).toBe('New Test Sprint')
      expect(res.body.program_id).toBe(testProgramId)
    })

    it('should create sprint with dates', async () => {
      const res = await request(app)
        .post('/api/sprints')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          title: 'Sprint with Dates',
          program_id: testProgramId,
          sprint_number: 2,
        })

      // Dates are computed on frontend from sprint_number + workspace.sprint_start_date
      expect(res.status).toBe(201)
      expect(res.body.sprint_number).toBe(2)
      expect(res.body.workspace_sprint_start_date).toBeDefined()
    })

    it('should create sprint with hypothesis', async () => {
      const res = await request(app)
        .post('/api/sprints')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          title: 'Sprint with Hypothesis',
          program_id: testProgramId,
          sprint_number: 3,
          hypothesis: 'If we implement feature X, then metric Y will improve by Z%',
        })

      expect(res.status).toBe(201)
      expect(res.body.hypothesis).toBe('If we implement feature X, then metric Y will improve by Z%')
    })

    it('should require sprint_number', async () => {
      const res = await request(app)
        .post('/api/sprints')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          title: 'Sprint Without Number',
          program_id: testProgramId,
        })

      expect(res.status).toBe(400)
    })
  })

  describe('PATCH /api/sprints/:id', () => {
    let testSprintId: string

    beforeAll(async () => {
      const sprintResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, program_id, created_by)
         VALUES ($1, 'sprint', 'Sprint to Update', 'workspace', $2, $3)
         RETURNING id`,
        [testWorkspaceId, testProgramId, testUserId]
      )
      testSprintId = sprintResult.rows[0].id
    })

    it('should update sprint title', async () => {
      const res = await request(app)
        .patch(`/api/sprints/${testSprintId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          title: 'Updated Sprint Title',
        })

      expect(res.status).toBe(200)
      expect(res.body.name).toBe('Updated Sprint Title')
    })

    it('should update sprint_number via PATCH', async () => {
      // Sprint status is computed from dates, sprint_number can be updated
      const res = await request(app)
        .patch(`/api/sprints/${testSprintId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          sprint_number: 99,
        })

      expect(res.status).toBe(200)
      expect(res.body.sprint_number).toBe(99)
    })

    it('should return 404 for non-existent sprint', async () => {
      const fakeId = crypto.randomUUID()
      const res = await request(app)
        .patch(`/api/sprints/${fakeId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          title: 'Should Fail',
        })

      expect(res.status).toBe(404)
    })
  })

  describe('DELETE /api/sprints/:id', () => {
    it('should delete a sprint', async () => {
      // Create sprint to delete
      const sprintResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, program_id, created_by)
         VALUES ($1, 'sprint', 'Sprint to Delete', 'workspace', $2, $3)
         RETURNING id`,
        [testWorkspaceId, testProgramId, testUserId]
      )
      const sprintId = sprintResult.rows[0].id

      const res = await request(app)
        .delete(`/api/sprints/${sprintId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)

      expect(res.status).toBe(204)

      // Verify it's gone
      const getRes = await request(app)
        .get(`/api/sprints/${sprintId}`)
        .set('Cookie', sessionCookie)

      expect(getRes.status).toBe(404)
    })
  })

  describe('PATCH /api/sprints/:id/hypothesis', () => {
    let testSprintId: string

    beforeAll(async () => {
      const sprintResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, program_id, created_by)
         VALUES ($1, 'sprint', 'Sprint for Hypothesis', 'workspace', $2, $3)
         RETURNING id`,
        [testWorkspaceId, testProgramId, testUserId]
      )
      testSprintId = sprintResult.rows[0].id
    })

    it('should update sprint hypothesis', async () => {
      const res = await request(app)
        .patch(`/api/sprints/${testSprintId}/hypothesis`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          hypothesis: 'Updated hypothesis text',
        })

      expect(res.status).toBe(200)
      expect(res.body.hypothesis).toBe('Updated hypothesis text')
    })
  })

  describe('GET /api/sprints/:id/issues', () => {
    let testSprintId: string
    let testIssueId: string

    beforeAll(async () => {
      // Create sprint
      const sprintResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, program_id, created_by)
         VALUES ($1, 'sprint', 'Sprint for Issues', 'workspace', $2, $3)
         RETURNING id`,
        [testWorkspaceId, testProgramId, testUserId]
      )
      testSprintId = sprintResult.rows[0].id

      // Create issue assigned to sprint
      const issueResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, project_id, sprint_id, created_by)
         VALUES ($1, 'issue', 'Issue in Sprint', 'workspace', $2, $3, $4)
         RETURNING id`,
        [testWorkspaceId, testProjectId, testSprintId, testUserId]
      )
      testIssueId = issueResult.rows[0].id
    })

    it('should return issues assigned to sprint', async () => {
      const res = await request(app)
        .get(`/api/sprints/${testSprintId}/issues`)
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(200)
      expect(res.body).toBeInstanceOf(Array)
      expect(res.body.length).toBe(1)
      expect(res.body[0].id).toBe(testIssueId)
      expect(res.body[0].title).toBe('Issue in Sprint')
    })
  })

  describe('Sprint Lifecycle', () => {
    let testSprintId: string

    beforeAll(async () => {
      const sprintResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, visibility, program_id, created_by, properties)
         VALUES ($1, 'sprint', 'Lifecycle Sprint', 'workspace', $2, $3, $4)
         RETURNING id`,
        [testWorkspaceId, testProgramId, testUserId, JSON.stringify({ sprint_number: 10 })]
      )
      testSprintId = sprintResult.rows[0].id
    })

    it('should update sprint_number', async () => {
      const res = await request(app)
        .patch(`/api/sprints/${testSprintId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          sprint_number: 11,
        })

      expect(res.status).toBe(200)
      expect(res.body.sprint_number).toBe(11)
    })

    it('should update sprint title', async () => {
      const res = await request(app)
        .patch(`/api/sprints/${testSprintId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          title: 'Updated Lifecycle Sprint',
        })

      expect(res.status).toBe(200)
      expect(res.body.name).toBe('Updated Lifecycle Sprint')
    })
  })

  describe('GET /api/sprints/my-week', () => {
    it('should return my-week data', async () => {
      const res = await request(app)
        .get('/api/sprints/my-week')
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(200)
      // my-week returns aggregated data
      expect(res.body).toBeDefined()
    })
  })

  describe('GET /api/sprints/my-action-items', () => {
    it('should return my action items', async () => {
      const res = await request(app)
        .get('/api/sprints/my-action-items')
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(200)
      expect(res.body.action_items).toBeInstanceOf(Array)
    })
  })
})
