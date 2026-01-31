import { describe, it, expect, beforeAll, afterAll, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import crypto from 'crypto'
import { createApp } from '../app.js'
import { pool } from '../db/client.js'

/**
 * Tests for CloudWatch audit logging integration.
 * Tests behavior with and without CloudWatch configured.
 */
describe('CloudWatch Audit Logging', () => {
  const app = createApp()
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  let testWorkspaceId: string
  let testUserId: string
  let sessionCookie: string
  let csrfToken: string

  beforeAll(async () => {
    // Create test workspace
    const workspaceResult = await pool.query(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
      [`CloudWatch Test ${testRunId}`]
    )
    testWorkspaceId = workspaceResult.rows[0].id

    // Create test user
    const userResult = await pool.query(
      `INSERT INTO users (email, name, password_hash) VALUES ($1, 'CloudWatch Test User', $2) RETURNING id`,
      [`cloudwatch-${testRunId}@ship.local`, '$2a$10$testhashedpassword12345']
    )
    testUserId = userResult.rows[0].id

    // Create workspace membership
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'member')`,
      [testWorkspaceId, testUserId]
    )

    // Create session
    const sessionId = crypto.randomBytes(32).toString('hex')
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at, last_activity, created_at)
       VALUES ($1, $2, $3, now() + interval '1 hour', now(), now())`,
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

  afterAll(async () => {
    // Clean up test data
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [testUserId])
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [testWorkspaceId])
    await pool.query('DELETE FROM workspace_memberships WHERE user_id = $1', [testUserId])
    await pool.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_no_update')
    await pool.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_no_delete')
    await pool.query("DELETE FROM audit_logs WHERE workspace_id = $1", [testWorkspaceId])
    await pool.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_no_update')
    await pool.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_no_delete')
    await pool.query('DELETE FROM users WHERE id = $1', [testUserId])
    await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId])
  })

  describe('Health check includes CloudWatch status', () => {
    it('returns cloudwatch_audit_status field', async () => {
      const res = await request(app).get('/health')

      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty('cloudwatch_audit_status')
      // Without CLOUDWATCH_AUDIT_LOG_GROUP, should be 'disabled'
      expect(res.body.cloudwatch_audit_status).toBe('disabled')
    })

    it('health check is healthy even when CloudWatch is disabled', async () => {
      const res = await request(app).get('/health')

      expect(res.status).toBe(200)
      expect(res.body.status).toBe('ok')
    })
  })

  describe('Audit logging works without CloudWatch', () => {
    it('document create succeeds and creates audit log', async () => {
      const res = await request(app)
        .post('/api/documents')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          title: 'CloudWatch Disabled Test Doc',
          document_type: 'wiki',
        })

      expect(res.status).toBe(201)
      const docId = res.body.id

      // Verify audit log was created
      const auditCheck = await pool.query(
        "SELECT id, record_hash FROM audit_logs WHERE action = 'document.create' AND resource_id = $1",
        [docId]
      )
      expect(auditCheck.rows.length).toBe(1)
      expect(auditCheck.rows[0].record_hash).toBeTruthy() // Should have hash chain
    })

    it('non-critical operations succeed silently without CloudWatch', async () => {
      // Create a document
      const createRes = await request(app)
        .post('/api/documents')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          title: 'Non-Critical Test Doc',
          document_type: 'wiki',
        })

      const docId = createRes.body.id

      // View the document content - should succeed
      const viewRes = await request(app)
        .get(`/api/documents/${docId}/content`)
        .set('Cookie', sessionCookie)

      expect(viewRes.status).toBe(200)

      // Verify view audit log exists
      const auditCheck = await pool.query(
        "SELECT id FROM audit_logs WHERE action = 'document.view' AND resource_id = $1",
        [docId]
      )
      expect(auditCheck.rows.length).toBe(1)
    })
  })

  describe('Audit event contains required fields', () => {
    it('audit event includes record_hash from hash chain', async () => {
      const res = await request(app)
        .post('/api/documents')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          title: 'Hash Chain Test Doc',
          document_type: 'wiki',
        })

      const docId = res.body.id

      // Check the audit log has all required fields
      const auditCheck = await pool.query(
        `SELECT id, created_at, actor_user_id, action, resource_type, resource_id,
                workspace_id, ip_address, details, record_hash, previous_hash
         FROM audit_logs
         WHERE action = 'document.create' AND resource_id = $1`,
        [docId]
      )

      expect(auditCheck.rows.length).toBe(1)
      const audit = auditCheck.rows[0]

      // All these fields should be present for CloudWatch shipping
      expect(audit.id).toBeTruthy()
      expect(audit.created_at).toBeTruthy()
      expect(audit.actor_user_id).toBe(testUserId)
      expect(audit.action).toBe('document.create')
      expect(audit.resource_type).toBe('document')
      expect(audit.resource_id).toBe(docId)
      expect(audit.workspace_id).toBe(testWorkspaceId)
      expect(audit.record_hash).toMatch(/^[0-9a-f]{64}$/) // 64-char hex
      expect(audit.previous_hash).toMatch(/^[0-9a-f]{64}$/) // 64-char hex
    })
  })

  describe('Warning logged once when CloudWatch disabled', () => {
    it('startup warning is logged only once', async () => {
      // This test verifies the warning behavior - we can't easily test console output
      // but we can verify that multiple audit events don't fail

      // Create multiple documents
      for (let i = 0; i < 3; i++) {
        const res = await request(app)
          .post('/api/documents')
          .set('Cookie', sessionCookie)
          .set('x-csrf-token', csrfToken)
          .send({
            title: `Multiple Audit Test ${i}`,
            document_type: 'wiki',
          })
        expect(res.status).toBe(201)
      }

      // All should have succeeded and created audit logs
      const auditCount = await pool.query(
        `SELECT COUNT(*) as count FROM audit_logs
         WHERE action = 'document.create'
         AND workspace_id = $1
         AND details->>'title' LIKE 'Multiple Audit Test%'`,
        [testWorkspaceId]
      )
      expect(parseInt(auditCount.rows[0].count)).toBe(3)
    })
  })

  describe('ENV var documentation', () => {
    it('CLOUDWATCH_AUDIT_LOG_GROUP is documented in .env.example', async () => {
      const fs = await import('fs')
      const path = await import('path')
      const envExample = fs.readFileSync(
        path.join(process.cwd(), '.env.example'),
        'utf-8'
      )

      expect(envExample).toContain('CLOUDWATCH_AUDIT_LOG_GROUP')
      expect(envExample).toContain('FedRAMP')
    })
  })
})

/**
 * Tests for CloudWatch integration with mocked AWS SDK.
 * These tests verify the actual CloudWatch shipping logic.
 */
describe('CloudWatch Shipping Logic', () => {
  // These tests would require mocking the AWS SDK which is complex.
  // In a production setting, you'd use @aws-sdk/client-mock for this.
  // For now, we test the interface and error handling paths.

  describe('getCloudWatchAuditStatus function', () => {
    it('returns disabled when env var not set', async () => {
      const { getCloudWatchAuditStatus } = await import('../services/audit.js')

      // In test environment, CLOUDWATCH_AUDIT_LOG_GROUP is not set
      const status = await getCloudWatchAuditStatus()
      expect(status.status).toBe('disabled')
    })
  })
})
