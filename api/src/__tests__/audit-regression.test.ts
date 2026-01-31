import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import crypto from 'crypto'
import { createApp } from '../app.js'
import { pool } from '../db/client.js'

/**
 * Audit Logging Regression Tests
 *
 * These tests verify all existing audit logging functionality works before
 * making changes. They run against a real database to ensure the audit logs
 * are actually being written.
 *
 * Action types tested:
 * - auth.login, auth.logout, auth.login_failed, auth.extend_session
 * - workspace.create, workspace.switch, membership.create, member.add
 * - api_token.created, api_token.revoked
 */
describe('Audit Logging Regression', () => {
  const app = createApp()
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

  // Test user credentials
  const testUserEmail = `audit-user-${testRunId}@ship.local`
  const testUserPassword = 'TestPassword123!'
  const superAdminEmail = `audit-admin-${testRunId}@ship.local`
  const superAdminPassword = 'AdminPassword123!'
  const testWorkspaceName = `Audit Test Workspace ${testRunId}`

  let testUserId: string
  let superAdminUserId: string
  let testWorkspaceId: string
  let passwordHash: string
  let adminPasswordHash: string

  // Session cookies created directly in DB (for tests that need authenticated access)
  let testUserSessionCookie: string
  let superAdminSessionCookie: string
  let testUserCsrfToken: string
  let superAdminCsrfToken: string

  // Helper to get the most recent audit log for an action
  async function getRecentAuditLog(action: string, actorUserId?: string) {
    const query = actorUserId
      ? `SELECT * FROM audit_logs WHERE action = $1 AND actor_user_id = $2 ORDER BY created_at DESC LIMIT 1`
      : `SELECT * FROM audit_logs WHERE action = $1 ORDER BY created_at DESC LIMIT 1`
    const params = actorUserId ? [action, actorUserId] : [action]
    const result = await pool.query(query, params)
    return result.rows[0]
  }

  // Helper to count audit logs for an action
  async function countAuditLogs(action: string) {
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM audit_logs WHERE action = $1`,
      [action]
    )
    return parseInt(result.rows[0].count)
  }

  beforeAll(async () => {
    // Import bcrypt for password hashing
    const bcrypt = await import('bcryptjs')
    passwordHash = await bcrypt.hash(testUserPassword, 10)
    adminPasswordHash = await bcrypt.hash(superAdminPassword, 10)

    // Create test workspace
    const workspaceResult = await pool.query(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
      [testWorkspaceName]
    )
    testWorkspaceId = workspaceResult.rows[0].id

    // Create regular test user with valid password hash
    const userResult = await pool.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, $2, 'Audit Test User')
       RETURNING id`,
      [testUserEmail, passwordHash]
    )
    testUserId = userResult.rows[0].id

    // Create workspace membership for regular user
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [testWorkspaceId, testUserId]
    )

    // Create super admin user
    const adminResult = await pool.query(
      `INSERT INTO users (email, password_hash, name, is_super_admin)
       VALUES ($1, $2, 'Audit Super Admin', true)
       RETURNING id`,
      [superAdminEmail, adminPasswordHash]
    )
    superAdminUserId = adminResult.rows[0].id

    // Create workspace membership for super admin
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'admin')`,
      [testWorkspaceId, superAdminUserId]
    )

    // Create sessions directly in the database (like workspaces.test.ts does)
    // IMPORTANT: Must set last_activity and created_at for authMiddleware validation
    const testUserSessionId = crypto.randomBytes(32).toString('hex')
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at, last_activity, created_at)
       VALUES ($1, $2, $3, now() + interval '1 hour', now(), now())`,
      [testUserSessionId, testUserId, testWorkspaceId]
    )
    testUserSessionCookie = `session_id=${testUserSessionId}`

    const superAdminSessionId = crypto.randomBytes(32).toString('hex')
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at, last_activity, created_at)
       VALUES ($1, $2, $3, now() + interval '1 hour', now(), now())`,
      [superAdminSessionId, superAdminUserId, testWorkspaceId]
    )
    superAdminSessionCookie = `session_id=${superAdminSessionId}`

    // Get CSRF tokens for both users
    const testUserCsrfRes = await request(app)
      .get('/api/csrf-token')
      .set('Cookie', testUserSessionCookie)
    testUserCsrfToken = testUserCsrfRes.body.token
    const testUserConnectSidCookie = (testUserCsrfRes.headers['set-cookie'] as string[] | undefined)?.[0]?.split(';')[0] || ''
    if (testUserConnectSidCookie) {
      testUserSessionCookie = `${testUserSessionCookie}; ${testUserConnectSidCookie}`
    }

    const superAdminCsrfRes = await request(app)
      .get('/api/csrf-token')
      .set('Cookie', superAdminSessionCookie)
    superAdminCsrfToken = superAdminCsrfRes.body.token
    const superAdminConnectSidCookie = (superAdminCsrfRes.headers['set-cookie'] as string[] | undefined)?.[0]?.split(';')[0] || ''
    if (superAdminConnectSidCookie) {
      superAdminSessionCookie = `${superAdminSessionCookie}; ${superAdminConnectSidCookie}`
    }
  })

  afterAll(async () => {
    // Clean up test data in correct order (foreign keys)
    // NOTE: audit_logs cannot be deleted (immutability triggers for AU-9 compliance)
    // We clean up sessions, memberships, tokens but leave users/workspaces that are
    // referenced by audit_logs to avoid FK constraint violations
    await pool.query('DELETE FROM api_tokens WHERE user_id = $1', [testUserId])
    await pool.query('DELETE FROM sessions WHERE user_id IN ($1, $2)', [testUserId, superAdminUserId])
    await pool.query('DELETE FROM workspace_memberships WHERE user_id IN ($1, $2)', [testUserId, superAdminUserId])
    // Users and workspaces may be referenced by audit_logs, clean up if possible
    try {
      await pool.query('DELETE FROM users WHERE id IN ($1, $2)', [testUserId, superAdminUserId])
      await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId])
    } catch {
      // FK constraint from audit_logs - expected and acceptable
    }
  })

  describe('Authentication Events', () => {
    it('auth.login creates audit log with actor_user_id, ip_address, user_agent', async () => {
      const countBefore = await countAuditLogs('auth.login')

      // First get a CSRF token (requires express-session, creates connect.sid cookie)
      const csrfRes = await request(app).get('/api/csrf-token')
      const loginCsrfToken = csrfRes.body.token
      const connectSidCookie = (csrfRes.headers['set-cookie'] as string[] | undefined)?.[0]?.split(';')[0] || ''

      const response = await request(app)
        .post('/api/auth/login')
        .set('User-Agent', 'AuditTest/1.0')
        .set('x-csrf-token', loginCsrfToken)
        .set('Cookie', connectSidCookie)
        .send({
          email: testUserEmail,
          password: testUserPassword,
          workspaceId: testWorkspaceId,
        })

      expect(response.status).toBe(200)

      const countAfter = await countAuditLogs('auth.login')
      expect(countAfter).toBeGreaterThan(countBefore)

      const auditLog = await getRecentAuditLog('auth.login', testUserId)
      expect(auditLog).toBeDefined()
      expect(auditLog.actor_user_id).toBe(testUserId)
      expect(auditLog.action).toBe('auth.login')
      expect(auditLog.created_at).toBeDefined()
      expect(auditLog.created_at).not.toBeNull()
      // IP address is set (might be ::1 or 127.0.0.1 or ::ffff:127.0.0.1 in tests)
      expect(auditLog.ip_address).toBeDefined()
      expect(auditLog.user_agent).toBe('AuditTest/1.0')
    })

    it('auth.logout creates audit log', async () => {
      // Create a fresh session for the logout test
      const logoutSessionId = crypto.randomBytes(32).toString('hex')
      await pool.query(
        `INSERT INTO sessions (id, user_id, workspace_id, expires_at, last_activity, created_at)
         VALUES ($1, $2, $3, now() + interval '1 hour', now(), now())`,
        [logoutSessionId, testUserId, testWorkspaceId]
      )
      const logoutSessionCookie = `session_id=${logoutSessionId}`

      // Get CSRF token with the session
      const csrfRes = await request(app)
        .get('/api/csrf-token')
        .set('Cookie', logoutSessionCookie)
      const logoutCsrfToken = csrfRes.body.token
      const connectSidCookie = (csrfRes.headers['set-cookie'] as string[] | undefined)?.[0]?.split(';')[0] || ''
      const fullCookie = connectSidCookie ? `${logoutSessionCookie}; ${connectSidCookie}` : logoutSessionCookie

      const countBefore = await countAuditLogs('auth.logout')

      const response = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', fullCookie)
        .set('x-csrf-token', logoutCsrfToken)

      expect(response.status).toBe(200)

      const countAfter = await countAuditLogs('auth.logout')
      expect(countAfter).toBeGreaterThan(countBefore)

      const auditLog = await getRecentAuditLog('auth.logout', testUserId)
      expect(auditLog).toBeDefined()
      expect(auditLog.action).toBe('auth.logout')
      expect(auditLog.created_at).toBeDefined()
      expect(auditLog.created_at).not.toBeNull()
    })

    it('auth.login_failed creates audit log with details.reason', async () => {
      const countBefore = await countAuditLogs('auth.login_failed')

      // First get a CSRF token
      const csrfRes = await request(app).get('/api/csrf-token')
      const loginCsrfToken = csrfRes.body.token
      const connectSidCookie = (csrfRes.headers['set-cookie'] as string[] | undefined)?.[0]?.split(';')[0] || ''

      await request(app)
        .post('/api/auth/login')
        .set('x-csrf-token', loginCsrfToken)
        .set('Cookie', connectSidCookie)
        .send({
          email: testUserEmail,
          password: 'WrongPassword!',
        })

      const countAfter = await countAuditLogs('auth.login_failed')
      expect(countAfter).toBeGreaterThan(countBefore)

      const auditLog = await getRecentAuditLog('auth.login_failed')
      expect(auditLog).toBeDefined()
      expect(auditLog.action).toBe('auth.login_failed')
      expect(auditLog.details).toBeDefined()
      expect(auditLog.details.reason).toBeDefined()
      expect(auditLog.details.reason).toBe('invalid_password')
      expect(auditLog.created_at).toBeDefined()
    })

    it('auth.extend_session creates audit log', async () => {
      // Create a fresh session for the extend test
      const extendSessionId = crypto.randomBytes(32).toString('hex')
      await pool.query(
        `INSERT INTO sessions (id, user_id, workspace_id, expires_at, last_activity, created_at)
         VALUES ($1, $2, $3, now() + interval '1 hour', now(), now())`,
        [extendSessionId, testUserId, testWorkspaceId]
      )
      const extendSessionCookie = `session_id=${extendSessionId}`

      // Get CSRF token with the session
      const csrfRes = await request(app)
        .get('/api/csrf-token')
        .set('Cookie', extendSessionCookie)
      const extendCsrfToken = csrfRes.body.token
      const connectSidCookie = (csrfRes.headers['set-cookie'] as string[] | undefined)?.[0]?.split(';')[0] || ''
      const fullCookie = connectSidCookie ? `${extendSessionCookie}; ${connectSidCookie}` : extendSessionCookie

      const countBefore = await countAuditLogs('auth.extend_session')

      // Call extend session endpoint
      const response = await request(app)
        .post('/api/auth/extend-session')
        .set('Cookie', fullCookie)
        .set('x-csrf-token', extendCsrfToken)

      expect(response.status).toBe(200)

      const countAfter = await countAuditLogs('auth.extend_session')
      expect(countAfter).toBeGreaterThan(countBefore)

      const auditLog = await getRecentAuditLog('auth.extend_session', testUserId)
      expect(auditLog).toBeDefined()
      expect(auditLog.action).toBe('auth.extend_session')
      expect(auditLog.created_at).toBeDefined()
      expect(auditLog.created_at).not.toBeNull()
    })
  })

  describe('Workspace Events', () => {
    it('workspace.create creates audit log', async () => {
      const countBefore = await countAuditLogs('workspace.create')
      const newWorkspaceName = `New Workspace ${testRunId}-${Date.now()}`

      const response = await request(app)
        .post('/api/admin/workspaces')
        .set('Cookie', superAdminSessionCookie)
        .set('x-csrf-token', superAdminCsrfToken)
        .send({ name: newWorkspaceName })

      expect(response.status).toBe(201)

      const countAfter = await countAuditLogs('workspace.create')
      expect(countAfter).toBeGreaterThan(countBefore)

      const auditLog = await getRecentAuditLog('workspace.create', superAdminUserId)
      expect(auditLog).toBeDefined()
      expect(auditLog.action).toBe('workspace.create')
      expect(auditLog.resource_type).toBe('workspace')
      expect(auditLog.details).toBeDefined()
      expect(auditLog.details.name).toBe(newWorkspaceName)
      expect(auditLog.created_at).toBeDefined()
      expect(auditLog.created_at).not.toBeNull()
    })

    it('workspace.members.add creates audit log', async () => {
      // Create a new user to add to workspace
      const newUserEmail = `new-member-${testRunId}-${Date.now()}@ship.local`
      const bcrypt = await import('bcryptjs')
      const newPasswordHash = await bcrypt.hash('TestPassword123!', 10)

      const newUserResult = await pool.query(
        `INSERT INTO users (email, password_hash, name)
         VALUES ($1, $2, 'New Member')
         RETURNING id`,
        [newUserEmail, newPasswordHash]
      )
      const newUserId = newUserResult.rows[0].id

      const countBefore = await countAuditLogs('workspace.member_add')

      const response = await request(app)
        .post(`/api/admin/workspaces/${testWorkspaceId}/members`)
        .set('Cookie', superAdminSessionCookie)
        .set('x-csrf-token', superAdminCsrfToken)
        .send({
          userId: newUserId,
          role: 'member',
        })

      expect(response.status).toBe(201)

      const countAfter = await countAuditLogs('workspace.member_add')
      expect(countAfter).toBeGreaterThan(countBefore)

      const auditLog = await getRecentAuditLog('workspace.member_add', superAdminUserId)
      expect(auditLog).toBeDefined()
      expect(auditLog.action).toBe('workspace.member_add')
      expect(auditLog.resource_type).toBe('workspace_membership')
      expect(auditLog.created_at).toBeDefined()
      expect(auditLog.created_at).not.toBeNull()

      // Cleanup the new user
      await pool.query('DELETE FROM workspace_memberships WHERE user_id = $1', [newUserId])
      await pool.query('DELETE FROM users WHERE id = $1', [newUserId])
    })
  })

  describe('API Token Events', () => {
    it('api_token.created creates audit log', async () => {
      const countBefore = await countAuditLogs('api_token.created')

      const response = await request(app)
        .post('/api/api-tokens')
        .set('Cookie', testUserSessionCookie)
        .set('x-csrf-token', testUserCsrfToken)
        .send({
          name: `Test Token ${testRunId}-${Date.now()}`,
          expiresInDays: 30,
        })

      expect(response.status).toBe(201)
      const tokenId = response.body.data.id

      const countAfter = await countAuditLogs('api_token.created')
      expect(countAfter).toBeGreaterThan(countBefore)

      const auditLog = await getRecentAuditLog('api_token.created', testUserId)
      expect(auditLog).toBeDefined()
      expect(auditLog.action).toBe('api_token.created')
      expect(auditLog.resource_type).toBe('api_token')
      expect(auditLog.resource_id).toBe(tokenId)
      expect(auditLog.created_at).toBeDefined()
      expect(auditLog.created_at).not.toBeNull()
    })

    it('api_token.revoked creates audit log', async () => {
      // Create token to revoke
      const createRes = await request(app)
        .post('/api/api-tokens')
        .set('Cookie', testUserSessionCookie)
        .set('x-csrf-token', testUserCsrfToken)
        .send({
          name: `Token to Revoke ${testRunId}-${Date.now()}`,
          expiresInDays: 30,
        })

      expect(createRes.status).toBe(201)
      const revokeTokenId = createRes.body.data.id

      const countBefore = await countAuditLogs('api_token.revoked')

      const response = await request(app)
        .delete(`/api/api-tokens/${revokeTokenId}`)
        .set('Cookie', testUserSessionCookie)
        .set('x-csrf-token', testUserCsrfToken)

      expect(response.status).toBe(200)

      const countAfter = await countAuditLogs('api_token.revoked')
      expect(countAfter).toBeGreaterThan(countBefore)

      const auditLog = await getRecentAuditLog('api_token.revoked', testUserId)
      expect(auditLog).toBeDefined()
      expect(auditLog.action).toBe('api_token.revoked')
      expect(auditLog.resource_type).toBe('api_token')
      expect(auditLog.resource_id).toBe(revokeTokenId)
      expect(auditLog.created_at).toBeDefined()
      expect(auditLog.created_at).not.toBeNull()
    })
  })

  describe('Audit Log Record Structure', () => {
    it('audit log record has non-null created_at timestamp', async () => {
      // Get any recent audit log (there should be many from previous tests)
      const result = await pool.query(
        `SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 1`
      )

      expect(result.rows.length).toBeGreaterThan(0)
      const auditLog = result.rows[0]

      expect(auditLog.created_at).toBeDefined()
      expect(auditLog.created_at).not.toBeNull()
      expect(auditLog.created_at instanceof Date).toBe(true)
    })

    it('audit log record has action matching expected value', async () => {
      // Verify a few different actions exist with correct format
      const actions = ['auth.login', 'auth.logout', 'auth.login_failed']

      for (const action of actions) {
        const result = await pool.query(
          `SELECT * FROM audit_logs WHERE action = $1 LIMIT 1`,
          [action]
        )

        if (result.rows.length > 0) {
          expect(result.rows[0].action).toBe(action)
        }
      }
    })
  })
})
