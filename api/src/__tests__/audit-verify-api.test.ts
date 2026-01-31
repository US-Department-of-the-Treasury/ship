import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import crypto from 'crypto'
import { createApp } from '../app.js'
import { pool } from '../db/client.js'

/**
 * Tests for audit chain verification API.
 * Verifies that the verify endpoint calls verify_audit_chain() correctly.
 */
describe('Audit Chain Verification API', () => {
  const app = createApp()
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

  // Test workspace
  let workspaceId: string

  // Super-admin user
  let superAdminId: string
  let superAdminSessionCookie: string
  let superAdminCsrfToken: string

  // Regular user
  let regularUserId: string
  let regularSessionCookie: string

  beforeAll(async () => {
    // Create test workspace
    const workspaceResult = await pool.query(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
      [`Verify Test ${testRunId}`]
    )
    workspaceId = workspaceResult.rows[0].id

    // Create super-admin user
    const superAdminResult = await pool.query(
      `INSERT INTO users (email, name, password_hash, is_super_admin) VALUES ($1, 'Verify Super Admin', $2, true) RETURNING id`,
      [`verify-super-admin-${testRunId}@ship.local`, '$2a$10$testhashedpassword12345']
    )
    superAdminId = superAdminResult.rows[0].id

    // Create session for super-admin
    const superAdminSessionId = crypto.randomBytes(32).toString('hex')
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at, last_activity, created_at)
       VALUES ($1, $2, $3, now() + interval '1 hour', now(), now())`,
      [superAdminSessionId, superAdminId, workspaceId]
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

    // Create regular user (not super-admin)
    const regularUserResult = await pool.query(
      `INSERT INTO users (email, name, password_hash) VALUES ($1, 'Verify Regular User', $2) RETURNING id`,
      [`verify-regular-${testRunId}@ship.local`, '$2a$10$testhashedpassword12345']
    )
    regularUserId = regularUserResult.rows[0].id

    // Create workspace membership for regular user
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'member')`,
      [workspaceId, regularUserId]
    )

    // Create session for regular user
    const regularSessionId = crypto.randomBytes(32).toString('hex')
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at, last_activity, created_at)
       VALUES ($1, $2, $3, now() + interval '1 hour', now(), now())`,
      [regularSessionId, regularUserId, workspaceId]
    )
    regularSessionCookie = `session_id=${regularSessionId}`

    // Get CSRF token for regular user
    const csrfResRegular = await request(app)
      .get('/api/csrf-token')
      .set('Cookie', regularSessionCookie)
    const regularCsrfToken = csrfResRegular.body.token
    const connectSidCookieRegular = csrfResRegular.headers['set-cookie']?.[0]?.split(';')[0] || ''
    if (connectSidCookieRegular) {
      regularSessionCookie = `${regularSessionCookie}; ${connectSidCookieRegular}`
    }

    // Create some audit log entries using the proper function (with hash chain)
    await pool.query(
      `INSERT INTO audit_logs (workspace_id, actor_user_id, action, resource_type, details)
       VALUES ($1, $2, 'test.event1', 'test', '{}')`,
      [workspaceId, superAdminId]
    )
    await pool.query(
      `INSERT INTO audit_logs (workspace_id, actor_user_id, action, resource_type, details)
       VALUES ($1, $2, 'test.event2', 'test', '{}')`,
      [workspaceId, superAdminId]
    )
  })

  afterAll(async () => {
    // Clean up test data
    await pool.query('DELETE FROM sessions WHERE user_id IN ($1, $2)', [superAdminId, regularUserId])
    await pool.query('DELETE FROM workspace_memberships WHERE user_id IN ($1, $2)', [superAdminId, regularUserId])
    await pool.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_no_update')
    await pool.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_no_delete')
    await pool.query('DELETE FROM audit_logs WHERE workspace_id = $1', [workspaceId])
    await pool.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_no_update')
    await pool.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_no_delete')
    await pool.query('DELETE FROM users WHERE id IN ($1, $2)', [superAdminId, regularUserId])
    await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId])
  })

  describe('POST /api/audit-logs/verify', () => {
    it('returns valid for clean chain (super-admin)', async () => {
      const res = await request(app)
        .post('/api/audit-logs/verify')
        .set('Cookie', superAdminSessionCookie)
        .set('x-csrf-token', superAdminCsrfToken)
        .send({})

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.valid).toBe(true)
      expect(res.body.data.records_checked).toBeGreaterThan(0)
    })

    it('accepts workspace_id filter', async () => {
      const res = await request(app)
        .post('/api/audit-logs/verify')
        .set('Cookie', superAdminSessionCookie)
        .set('x-csrf-token', superAdminCsrfToken)
        .send({ workspace_id: workspaceId })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data).toHaveProperty('valid')
      expect(res.body.data).toHaveProperty('records_checked')
    })

    it('accepts limit parameter', async () => {
      const res = await request(app)
        .post('/api/audit-logs/verify')
        .set('Cookie', superAdminSessionCookie)
        .set('x-csrf-token', superAdminCsrfToken)
        .send({ limit: 100 })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('denies access for non-super-admin', async () => {
      const res = await request(app)
        .post('/api/audit-logs/verify')
        .set('Cookie', regularSessionCookie)
        .set('x-csrf-token', superAdminCsrfToken) // Will be rejected anyway
        .send({})

      expect(res.status).toBe(403)
    })

    it('returns invalid_records when chain is corrupted', async () => {
      // First, temporarily corrupt a record
      // This requires disabling the trigger temporarily
      await pool.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_no_update')

      // Find a record in our workspace and corrupt its hash
      const recordResult = await pool.query(
        `SELECT id FROM audit_logs WHERE workspace_id = $1 LIMIT 1`,
        [workspaceId]
      )

      if (recordResult.rows.length > 0) {
        const recordId = recordResult.rows[0].id
        const originalHash = (await pool.query(
          'SELECT record_hash FROM audit_logs WHERE id = $1',
          [recordId]
        )).rows[0].record_hash

        // Corrupt the hash (must be exactly 64 chars for CHAR(64) column)
        await pool.query(
          `UPDATE audit_logs SET record_hash = 'badbad1234567890123456789012345678901234567890123456789012345678' WHERE id = $1`,
          [recordId]
        )

        try {
          const res = await request(app)
            .post('/api/audit-logs/verify')
            .set('Cookie', superAdminSessionCookie)
            .set('x-csrf-token', superAdminCsrfToken)
            .send({ workspace_id: workspaceId })

          expect(res.status).toBe(200)
          expect(res.body.data.valid).toBe(false)
          expect(res.body.data.invalid_records).toBeDefined()
          expect(res.body.data.invalid_records.length).toBeGreaterThan(0)
        } finally {
          // Restore the original hash
          await pool.query(
            `UPDATE audit_logs SET record_hash = $1 WHERE id = $2`,
            [originalHash, recordId]
          )
        }
      }

      await pool.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_no_update')
    })
  })
})
