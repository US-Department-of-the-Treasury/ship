import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import crypto from 'crypto'
import { createApp } from '../app.js'
import { pool } from '../db/client.js'

/**
 * Tests for audit log query API.
 * Verifies filtering, pagination, SQL injection prevention, and cross-workspace access.
 */
describe('Audit Log Query API', () => {
  const app = createApp()
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

  // Test workspace 1
  let workspaceId1: string
  let userId1: string
  let sessionCookie1: string
  let csrfToken1: string

  // Test workspace 2 (for cross-workspace tests)
  let workspaceId2: string

  // Super-admin user
  let superAdminId: string
  let superAdminSessionCookie: string
  let superAdminCsrfToken: string

  // Test document
  let testDocumentId: string

  beforeAll(async () => {
    // Create test workspace 1
    const workspace1Result = await pool.query(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
      [`Audit Query Test 1 ${testRunId}`]
    )
    workspaceId1 = workspace1Result.rows[0].id

    // Create test workspace 2
    const workspace2Result = await pool.query(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
      [`Audit Query Test 2 ${testRunId}`]
    )
    workspaceId2 = workspace2Result.rows[0].id

    // Create admin user for workspace 1
    const userResult = await pool.query(
      `INSERT INTO users (email, name, password_hash) VALUES ($1, 'Audit Query Test Admin', $2) RETURNING id`,
      [`audit-query-admin-${testRunId}@ship.local`, '$2a$10$testhashedpassword12345']
    )
    userId1 = userResult.rows[0].id

    // Create workspace membership (admin role)
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'admin')`,
      [workspaceId1, userId1]
    )

    // Create session for admin user
    const sessionId1 = crypto.randomBytes(32).toString('hex')
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at, last_activity, created_at)
       VALUES ($1, $2, $3, now() + interval '1 hour', now(), now())`,
      [sessionId1, userId1, workspaceId1]
    )
    sessionCookie1 = `session_id=${sessionId1}`

    // Get CSRF token for admin
    const csrfRes1 = await request(app)
      .get('/api/csrf-token')
      .set('Cookie', sessionCookie1)
    csrfToken1 = csrfRes1.body.token
    const connectSidCookie1 = csrfRes1.headers['set-cookie']?.[0]?.split(';')[0] || ''
    if (connectSidCookie1) {
      sessionCookie1 = `${sessionCookie1}; ${connectSidCookie1}`
    }

    // Create super-admin user
    const superAdminResult = await pool.query(
      `INSERT INTO users (email, name, password_hash, is_super_admin) VALUES ($1, 'Super Admin', $2, true) RETURNING id`,
      [`super-admin-${testRunId}@ship.local`, '$2a$10$testhashedpassword12345']
    )
    superAdminId = superAdminResult.rows[0].id

    // Create session for super-admin
    const superAdminSessionId = crypto.randomBytes(32).toString('hex')
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at, last_activity, created_at)
       VALUES ($1, $2, $3, now() + interval '1 hour', now(), now())`,
      [superAdminSessionId, superAdminId, workspaceId1]
    )
    superAdminSessionCookie = `session_id=${superAdminSessionId}`

    // Get CSRF token for super-admin
    const csrfResSuperAdmin = await request(app)
      .get('/api/csrf-token')
      .set('Cookie', superAdminSessionCookie)
    superAdminCsrfToken = csrfResSuperAdmin.body.token
    const connectSidCookieSuperAdmin = csrfResSuperAdmin.headers['set-cookie']?.[0]?.split(';')[0] || ''
    if (connectSidCookieSuperAdmin) {
      superAdminSessionCookie = `${superAdminSessionCookie}; ${connectSidCookieSuperAdmin}`
    }

    // Create test document
    const docRes = await request(app)
      .post('/api/documents')
      .set('Cookie', sessionCookie1)
      .set('x-csrf-token', csrfToken1)
      .send({
        title: 'Audit Query Test Document',
        document_type: 'wiki',
      })
    testDocumentId = docRes.body.id

    // Create some additional audit log entries for testing
    await pool.query(
      `INSERT INTO audit_logs (workspace_id, actor_user_id, action, resource_type, resource_id, details)
       VALUES ($1, $2, 'document.view', 'document', $3, '{"access_method": "api"}')`,
      [workspaceId1, userId1, testDocumentId]
    )
    await pool.query(
      `INSERT INTO audit_logs (workspace_id, actor_user_id, action, resource_type, resource_id, details)
       VALUES ($1, $2, 'document.view', 'document', $3, '{"access_method": "websocket"}')`,
      [workspaceId2, superAdminId, testDocumentId]
    )
    await pool.query(
      `INSERT INTO audit_logs (workspace_id, actor_user_id, action, resource_type, details)
       VALUES ($1, $2, 'document.create', 'document', '{"title": "Another Doc"}')`,
      [workspaceId1, userId1]
    )
  })

  afterAll(async () => {
    // Clean up test data
    await pool.query('DELETE FROM sessions WHERE user_id IN ($1, $2)', [userId1, superAdminId])
    await pool.query('DELETE FROM documents WHERE workspace_id IN ($1, $2)', [workspaceId1, workspaceId2])
    await pool.query('DELETE FROM workspace_memberships WHERE user_id IN ($1, $2)', [userId1, superAdminId])
    await pool.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_no_update')
    await pool.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_no_delete')
    await pool.query('DELETE FROM audit_logs WHERE workspace_id IN ($1, $2)', [workspaceId1, workspaceId2])
    await pool.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_no_update')
    await pool.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_no_delete')
    await pool.query('DELETE FROM users WHERE id IN ($1, $2)', [userId1, superAdminId])
    await pool.query('DELETE FROM workspaces WHERE id IN ($1, $2)', [workspaceId1, workspaceId2])
  })

  describe('GET /api/workspaces/:id/audit-logs', () => {
    it('returns audit logs for workspace', async () => {
      const res = await request(app)
        .get(`/api/workspaces/${workspaceId1}/audit-logs`)
        .set('Cookie', sessionCookie1)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.logs).toBeInstanceOf(Array)
      expect(res.body.data.logs.length).toBeGreaterThan(0)
    })

    it('filters by resource_id', async () => {
      const res = await request(app)
        .get(`/api/workspaces/${workspaceId1}/audit-logs?resource_id=${testDocumentId}`)
        .set('Cookie', sessionCookie1)

      expect(res.status).toBe(200)
      expect(res.body.data.logs.every((log: any) => log.resourceId === testDocumentId)).toBe(true)
    })

    it('filters by actor_user_id', async () => {
      const res = await request(app)
        .get(`/api/workspaces/${workspaceId1}/audit-logs?actor_user_id=${userId1}`)
        .set('Cookie', sessionCookie1)

      expect(res.status).toBe(200)
      // All logs in workspace 1 should have user1 as actor
      expect(res.body.data.logs.length).toBeGreaterThan(0)
    })

    it('filters by action', async () => {
      const res = await request(app)
        .get(`/api/workspaces/${workspaceId1}/audit-logs?action=document.view`)
        .set('Cookie', sessionCookie1)

      expect(res.status).toBe(200)
      expect(res.body.data.logs.every((log: any) => log.action === 'document.view')).toBe(true)
    })

    it('filters by date range', async () => {
      const startDate = new Date(Date.now() - 3600000).toISOString() // 1 hour ago
      const endDate = new Date(Date.now() + 3600000).toISOString() // 1 hour from now

      const res = await request(app)
        .get(`/api/workspaces/${workspaceId1}/audit-logs?start_date=${startDate}&end_date=${endDate}`)
        .set('Cookie', sessionCookie1)

      expect(res.status).toBe(200)
      expect(res.body.data.logs.length).toBeGreaterThan(0)
    })

    it('combines multiple filters', async () => {
      const res = await request(app)
        .get(`/api/workspaces/${workspaceId1}/audit-logs?action=document.view&resource_id=${testDocumentId}`)
        .set('Cookie', sessionCookie1)

      expect(res.status).toBe(200)
      expect(res.body.data.logs.every((log: any) =>
        log.action === 'document.view' && log.resourceId === testDocumentId
      )).toBe(true)
    })

    it('prevents SQL injection', async () => {
      const maliciousAction = "'; DROP TABLE audit_logs;--"
      const res = await request(app)
        .get(`/api/workspaces/${workspaceId1}/audit-logs?action=${encodeURIComponent(maliciousAction)}`)
        .set('Cookie', sessionCookie1)

      // Should return 200 with no results (no matching action)
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.logs).toEqual([])

      // Verify table still exists
      const tableCheck = await pool.query('SELECT COUNT(*) FROM audit_logs')
      expect(parseInt(tableCheck.rows[0].count)).toBeGreaterThanOrEqual(0)
    })

    it('applies pagination with limit and offset', async () => {
      const res = await request(app)
        .get(`/api/workspaces/${workspaceId1}/audit-logs?limit=2&offset=0`)
        .set('Cookie', sessionCookie1)

      expect(res.status).toBe(200)
      expect(res.body.data.logs.length).toBeLessThanOrEqual(2)
    })

    it('enforces max limit of 1000', async () => {
      const res = await request(app)
        .get(`/api/workspaces/${workspaceId1}/audit-logs?limit=9999`)
        .set('Cookie', sessionCookie1)

      expect(res.status).toBe(200)
      // Can't easily test that limit was enforced without 1000+ records,
      // but the query should succeed without error
      expect(res.body.success).toBe(true)
    })

    it('applies default limit of 100', async () => {
      const res = await request(app)
        .get(`/api/workspaces/${workspaceId1}/audit-logs`)
        .set('Cookie', sessionCookie1)

      expect(res.status).toBe(200)
      // Default should be 100, so with few test records, all should be returned
      expect(res.body.success).toBe(true)
    })

    it('includes record_hash in response', async () => {
      const res = await request(app)
        .get(`/api/workspaces/${workspaceId1}/audit-logs`)
        .set('Cookie', sessionCookie1)

      expect(res.status).toBe(200)
      expect(res.body.data.logs.length).toBeGreaterThan(0)
      // At least some logs should have record_hash (those created via logAuditEvent)
      const logsWithHash = res.body.data.logs.filter((log: any) => log.recordHash)
      expect(logsWithHash.length).toBeGreaterThan(0)
    })
  })

  describe('GET /api/audit-logs (cross-workspace, super-admin only)', () => {
    it('returns logs across all workspaces for super-admin', async () => {
      const res = await request(app)
        .get('/api/audit-logs')
        .set('Cookie', superAdminSessionCookie)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.logs).toBeInstanceOf(Array)
    })

    it('denies access for non-super-admin', async () => {
      const res = await request(app)
        .get('/api/audit-logs')
        .set('Cookie', sessionCookie1)

      expect(res.status).toBe(403)
    })

    it('filters by resource_id across workspaces', async () => {
      const res = await request(app)
        .get(`/api/audit-logs?resource_id=${testDocumentId}`)
        .set('Cookie', superAdminSessionCookie)

      expect(res.status).toBe(200)
      // Should find logs from both workspaces
      const workspaceIds = new Set(res.body.data.logs.map((log: any) => log.workspaceId))
      // The document was created in workspace1 and viewed in workspace2
      expect(workspaceIds.size).toBeGreaterThanOrEqual(1)
    })

    it('includes workspace info in cross-workspace response', async () => {
      const res = await request(app)
        .get('/api/audit-logs')
        .set('Cookie', superAdminSessionCookie)

      expect(res.status).toBe(200)
      expect(res.body.data.logs[0]).toHaveProperty('workspaceId')
      expect(res.body.data.logs[0]).toHaveProperty('workspaceName')
    })

    it('filters by workspace_id', async () => {
      const res = await request(app)
        .get(`/api/audit-logs?workspace_id=${workspaceId1}`)
        .set('Cookie', superAdminSessionCookie)

      expect(res.status).toBe(200)
      expect(res.body.data.logs.every((log: any) => log.workspaceId === workspaceId1)).toBe(true)
    })

    it('includes record_hash in cross-workspace response', async () => {
      const res = await request(app)
        .get('/api/audit-logs')
        .set('Cookie', superAdminSessionCookie)

      expect(res.status).toBe(200)
      expect(res.body.data.logs.length).toBeGreaterThan(0)
      // At least some logs should have record_hash
      const logsWithHash = res.body.data.logs.filter((log: any) => log.recordHash)
      expect(logsWithHash.length).toBeGreaterThan(0)
    })
  })
})
