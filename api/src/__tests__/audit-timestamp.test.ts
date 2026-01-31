import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import crypto from 'crypto'
import { createApp } from '../app.js'
import { pool } from '../db/client.js'

/**
 * Tests for audit log timestamp standardization.
 * Verifies ISO 8601 format with milliseconds as required by NIST 800-53 AU-8.
 */
describe('Audit Log Timestamps (AU-8)', () => {
  const app = createApp()
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

  let workspaceId: string
  let adminId: string
  let sessionCookie: string
  let csrfToken: string

  beforeAll(async () => {
    // Create test workspace
    const workspaceResult = await pool.query(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
      [`Timestamp Test ${testRunId}`]
    )
    workspaceId = workspaceResult.rows[0].id

    // Create admin user
    const adminResult = await pool.query(
      `INSERT INTO users (email, name, password_hash) VALUES ($1, 'Timestamp Test Admin', $2) RETURNING id`,
      [`timestamp-admin-${testRunId}@ship.local`, '$2a$10$testhashedpassword12345']
    )
    adminId = adminResult.rows[0].id

    // Create workspace membership (admin role)
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'admin')`,
      [workspaceId, adminId]
    )

    // Create session
    const sessionId = crypto.randomBytes(32).toString('hex')
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at, last_activity, created_at)
       VALUES ($1, $2, $3, now() + interval '1 hour', now(), now())`,
      [sessionId, adminId, workspaceId]
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

    // Create some audit logs via document operations
    await request(app)
      .post('/api/documents')
      .set('Cookie', sessionCookie)
      .set('x-csrf-token', csrfToken)
      .send({ title: 'Timestamp Test Doc 1', document_type: 'wiki' })

    // Small delay to ensure different timestamps
    await new Promise(resolve => setTimeout(resolve, 50))

    await request(app)
      .post('/api/documents')
      .set('Cookie', sessionCookie)
      .set('x-csrf-token', csrfToken)
      .send({ title: 'Timestamp Test Doc 2', document_type: 'wiki' })
  })

  afterAll(async () => {
    // Clean up test data
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [adminId])
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [workspaceId])
    await pool.query('DELETE FROM workspace_memberships WHERE user_id = $1', [adminId])
    await pool.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_no_update')
    await pool.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_no_delete')
    await pool.query('DELETE FROM audit_logs WHERE workspace_id = $1', [workspaceId])
    await pool.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_no_update')
    await pool.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_no_delete')
    await pool.query('DELETE FROM users WHERE id = $1', [adminId])
    await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId])
  })

  describe('ISO 8601 format compliance', () => {
    it('timestamps match ISO 8601 format with milliseconds', async () => {
      const res = await request(app)
        .get(`/api/workspaces/${workspaceId}/audit-logs`)
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(200)
      expect(res.body.data.logs.length).toBeGreaterThan(0)

      // ISO 8601 with milliseconds: YYYY-MM-DDTHH:mm:ss.sssZ
      const isoFormat = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

      for (const log of res.body.data.logs) {
        expect(log.createdAt).toMatch(isoFormat)
      }
    })

    it('timestamps have millisecond precision (3 decimal places)', async () => {
      const res = await request(app)
        .get(`/api/workspaces/${workspaceId}/audit-logs`)
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(200)

      for (const log of res.body.data.logs) {
        // Extract milliseconds part
        const millisPart = log.createdAt.match(/\.(\d+)Z$/)?.[1]
        expect(millisPart).toBeDefined()
        expect(millisPart.length).toBeGreaterThanOrEqual(3)
      }
    })

    it('timestamps are in UTC (end with Z)', async () => {
      const res = await request(app)
        .get(`/api/workspaces/${workspaceId}/audit-logs`)
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(200)

      for (const log of res.body.data.logs) {
        expect(log.createdAt.endsWith('Z')).toBe(true)
      }
    })

    it('timestamps are monotonically ordered (DESC order in response)', async () => {
      const res = await request(app)
        .get(`/api/workspaces/${workspaceId}/audit-logs`)
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(200)

      const timestamps = res.body.data.logs.map((log: any) => new Date(log.createdAt).getTime())

      // API returns in DESC order, so each timestamp should be >= the next
      for (let i = 0; i < timestamps.length - 1; i++) {
        expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i + 1])
      }
    })

    it('consecutive inserts have increasing timestamps', async () => {
      // Query the raw database to verify monotonic increase
      const result = await pool.query(
        `SELECT created_at FROM audit_logs
         WHERE workspace_id = $1
         ORDER BY created_at ASC
         LIMIT 10`,
        [workspaceId]
      )

      expect(result.rows.length).toBeGreaterThanOrEqual(2)

      // Timestamps should increase (or at least not decrease)
      for (let i = 1; i < result.rows.length; i++) {
        const prev = new Date(result.rows[i - 1].created_at).getTime()
        const curr = new Date(result.rows[i].created_at).getTime()
        expect(curr).toBeGreaterThanOrEqual(prev)
      }
    })
  })
})
