/**
 * End-to-end test for leak investigation workflow.
 *
 * This is the acceptance test for the audit logging feature.
 * It validates the entire workflow an investigator would use
 * to determine who accessed a leaked document.
 *
 * Scenario:
 * 1. User A creates confidential document
 * 2. User B (same workspace) views it
 * 3. User C (different workspace) attempts to view - denied
 * 4. User D (admin) views it
 * 5. Super-admin queries audit logs and finds all access events
 * 6. Super-admin verifies chain integrity
 * 7. CloudWatch verification (if configured)
 */

import { test, expect } from './fixtures/isolated-env';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

// Test data created in beforeAll
let workspace1Id: string;
let workspace2Id: string;
let userAId: string;
let userBId: string;
let userCId: string;
let userDId: string;  // Super-admin
let documentId: string;
let pool: Pool;

// Session cookies for each user
let userASessionCookie: string;
let userBSessionCookie: string;
let userCSessionCookie: string;
let userDSessionCookie: string;  // Super-admin

test.describe('Audit Leak Investigation', () => {
  // Tests must run serially because later tests depend on audit logs created by earlier tests
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ dbContainer, apiServer }) => {
    // Connect to the test database
    pool = new Pool({ connectionString: dbContainer.getConnectionUri() });

    const passwordHash = await bcrypt.hash('testpassword', 10);
    const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    // Create Workspace 1
    const ws1Result = await pool.query(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
      [`Leak Test Workspace 1 ${testRunId}`]
    );
    workspace1Id = ws1Result.rows[0].id;

    // Create Workspace 2 (separate workspace for User C)
    const ws2Result = await pool.query(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
      [`Leak Test Workspace 2 ${testRunId}`]
    );
    workspace2Id = ws2Result.rows[0].id;

    // Create User A (document creator in Workspace 1)
    const userAResult = await pool.query(
      `INSERT INTO users (email, name, password_hash, last_workspace_id)
       VALUES ($1, 'User A - Creator', $2, $3) RETURNING id`,
      [`userA-${testRunId}@ship.local`, passwordHash, workspace1Id]
    );
    userAId = userAResult.rows[0].id;

    // Create User B (viewer in Workspace 1)
    const userBResult = await pool.query(
      `INSERT INTO users (email, name, password_hash, last_workspace_id)
       VALUES ($1, 'User B - Viewer', $2, $3) RETURNING id`,
      [`userB-${testRunId}@ship.local`, passwordHash, workspace1Id]
    );
    userBId = userBResult.rows[0].id;

    // Create User C (different workspace - should be denied)
    const userCResult = await pool.query(
      `INSERT INTO users (email, name, password_hash, last_workspace_id)
       VALUES ($1, 'User C - Other WS', $2, $3) RETURNING id`,
      [`userC-${testRunId}@ship.local`, passwordHash, workspace2Id]
    );
    userCId = userCResult.rows[0].id;

    // Create User D (super-admin for investigation)
    const userDResult = await pool.query(
      `INSERT INTO users (email, name, password_hash, is_super_admin, last_workspace_id)
       VALUES ($1, 'User D - Super Admin', $2, true, $3) RETURNING id`,
      [`userD-${testRunId}@ship.local`, passwordHash, workspace1Id]
    );
    userDId = userDResult.rows[0].id;

    // Create workspace memberships
    // User A, B, D in Workspace 1
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'member')`,
      [workspace1Id, userAId]
    );
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'member')`,
      [workspace1Id, userBId]
    );
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'admin')`,
      [workspace1Id, userDId]
    );

    // User C in Workspace 2
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'member')`,
      [workspace2Id, userCId]
    );

    // Create sessions for each user
    async function createSession(userId: string, workspaceId: string): Promise<string> {
      const sessionId = crypto.randomBytes(32).toString('hex');
      await pool.query(
        `INSERT INTO sessions (id, user_id, workspace_id, expires_at, last_activity, created_at)
         VALUES ($1, $2, $3, now() + interval '1 hour', now(), now())`,
        [sessionId, userId, workspaceId]
      );
      return `session_id=${sessionId}`;
    }

    userASessionCookie = await createSession(userAId, workspace1Id);
    userBSessionCookie = await createSession(userBId, workspace1Id);
    userCSessionCookie = await createSession(userCId, workspace2Id);
    userDSessionCookie = await createSession(userDId, workspace1Id);

    // User A creates the confidential document
    // This will log a document.create event
    const apiUrl = apiServer.url;

    // Get CSRF token for User A
    const csrfResA = await fetch(`${apiUrl}/api/csrf-token`, {
      headers: { Cookie: userASessionCookie }
    });
    const csrfDataA = await csrfResA.json();
    const csrfTokenA = csrfDataA.token;
    // Extract connect.sid cookie if set
    const setCookieHeader = csrfResA.headers.get('set-cookie');
    if (setCookieHeader) {
      const connectSid = setCookieHeader.split(';')[0];
      userASessionCookie = `${userASessionCookie}; ${connectSid}`;
    }

    // Create the confidential document
    const createDocRes = await fetch(`${apiUrl}/api/documents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userASessionCookie,
        'x-csrf-token': csrfTokenA,
      },
      body: JSON.stringify({
        title: 'Confidential Report',
        document_type: 'wiki'
      })
    });

    expect(createDocRes.ok).toBe(true);
    const docData = await createDocRes.json();
    documentId = docData.id;
  });

  test.afterAll(async () => {
    // Clean up test data
    if (pool) {
      await pool.query('DELETE FROM sessions WHERE user_id IN ($1, $2, $3, $4)', [userAId, userBId, userCId, userDId]);
      await pool.query('DELETE FROM documents WHERE workspace_id IN ($1, $2)', [workspace1Id, workspace2Id]);
      await pool.query('DELETE FROM workspace_memberships WHERE workspace_id IN ($1, $2)', [workspace1Id, workspace2Id]);
      await pool.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_no_update');
      await pool.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_no_delete');
      await pool.query('DELETE FROM audit_logs WHERE workspace_id IN ($1, $2)', [workspace1Id, workspace2Id]);
      await pool.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_no_update');
      await pool.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_no_delete');
      await pool.query('DELETE FROM users WHERE id IN ($1, $2, $3, $4)', [userAId, userBId, userCId, userDId]);
      await pool.query('DELETE FROM workspaces WHERE id IN ($1, $2)', [workspace1Id, workspace2Id]);
      await pool.end();
    }
  });

  test('User B can view document and creates audit log', async ({ apiServer }) => {
    const apiUrl = apiServer.url;

    // Get CSRF token for User B
    const csrfRes = await fetch(`${apiUrl}/api/csrf-token`, {
      headers: { Cookie: userBSessionCookie }
    });
    const csrfData = await csrfRes.json();
    const setCookieHeader = csrfRes.headers.get('set-cookie');
    if (setCookieHeader) {
      const connectSid = setCookieHeader.split(';')[0];
      userBSessionCookie = `${userBSessionCookie}; ${connectSid}`;
    }

    // User B views the document content (this creates document.view audit log)
    const viewRes = await fetch(`${apiUrl}/api/documents/${documentId}/content`, {
      headers: { Cookie: userBSessionCookie }
    });

    expect(viewRes.status).toBe(200);

    // Wait for audit log to be written
    await new Promise(r => setTimeout(r, 100));

    // Verify audit log was created
    const auditResult = await pool.query(
      `SELECT * FROM audit_logs
       WHERE resource_id = $1 AND actor_user_id = $2 AND action = 'document.view'
       ORDER BY created_at DESC LIMIT 1`,
      [documentId, userBId]
    );

    expect(auditResult.rows.length).toBe(1);
    expect(auditResult.rows[0].action).toBe('document.view');
  });

  test('User C is denied access and creates document.view_denied audit log', async ({ apiServer }) => {
    const apiUrl = apiServer.url;

    // Get CSRF token for User C
    const csrfRes = await fetch(`${apiUrl}/api/csrf-token`, {
      headers: { Cookie: userCSessionCookie }
    });
    const setCookieHeader = csrfRes.headers.get('set-cookie');
    if (setCookieHeader) {
      const connectSid = setCookieHeader.split(';')[0];
      userCSessionCookie = `${userCSessionCookie}; ${connectSid}`;
    }

    // User C attempts to view document content from different workspace
    // This should be denied and create document.view_denied audit log
    const viewRes = await fetch(`${apiUrl}/api/documents/${documentId}/content`, {
      headers: { Cookie: userCSessionCookie }
    });

    // Should be denied (403 or 404)
    expect([403, 404]).toContain(viewRes.status);

    // Wait for audit log to be written
    await new Promise(r => setTimeout(r, 100));

    // Verify denial was logged
    const auditResult = await pool.query(
      `SELECT * FROM audit_logs
       WHERE resource_id = $1 AND actor_user_id = $2 AND action = 'document.view_denied'
       ORDER BY created_at DESC LIMIT 1`,
      [documentId, userCId]
    );

    expect(auditResult.rows.length).toBe(1);
    expect(auditResult.rows[0].action).toBe('document.view_denied');
  });

  test('User D (admin) views document and creates audit log', async ({ apiServer }) => {
    const apiUrl = apiServer.url;

    // Get CSRF token for User D
    const csrfRes = await fetch(`${apiUrl}/api/csrf-token`, {
      headers: { Cookie: userDSessionCookie }
    });
    const csrfData = await csrfRes.json();
    const setCookieHeader = csrfRes.headers.get('set-cookie');
    if (setCookieHeader) {
      const connectSid = setCookieHeader.split(';')[0];
      userDSessionCookie = `${userDSessionCookie}; ${connectSid}`;
    }

    // User D views the document content
    const viewRes = await fetch(`${apiUrl}/api/documents/${documentId}/content`, {
      headers: { Cookie: userDSessionCookie }
    });

    expect(viewRes.status).toBe(200);

    // Wait for audit log to be written
    await new Promise(r => setTimeout(r, 100));

    // Verify audit log was created
    const auditResult = await pool.query(
      `SELECT * FROM audit_logs
       WHERE resource_id = $1 AND actor_user_id = $2 AND action = 'document.view'
       ORDER BY created_at DESC LIMIT 1`,
      [documentId, userDId]
    );

    expect(auditResult.rows.length).toBe(1);
    expect(auditResult.rows[0].action).toBe('document.view');
  });

  test('Super-admin can query audit logs for document access investigation', async ({ apiServer }) => {
    const apiUrl = apiServer.url;

    // Super-admin queries cross-workspace audit logs for the document
    const auditRes = await fetch(`${apiUrl}/api/audit-logs?resource_id=${documentId}`, {
      headers: { Cookie: userDSessionCookie }
    });

    expect(auditRes.status).toBe(200);
    const auditData = await auditRes.json();

    // Find all relevant events
    const createEvents = auditData.data.logs.filter((l: any) =>
      l.action === 'document.create' && l.resourceId === documentId
    );
    const viewEvents = auditData.data.logs.filter((l: any) =>
      l.action === 'document.view' && l.resourceId === documentId
    );
    const deniedEvents = auditData.data.logs.filter((l: any) =>
      l.action === 'document.view_denied' && l.resourceId === documentId
    );

    // User A created the document
    expect(createEvents.length).toBeGreaterThanOrEqual(1);

    // User B and D viewed the document
    expect(viewEvents.length).toBeGreaterThanOrEqual(2);

    // User C was denied
    expect(deniedEvents.length).toBeGreaterThanOrEqual(1);

    // Verify we can identify who accessed the document
    const allActors = new Set(auditData.data.logs.map((l: any) => l.actorEmail));
    expect(allActors.size).toBeGreaterThanOrEqual(3); // A, B, C, D at minimum
  });

  test('Super-admin can verify audit chain integrity', async ({ apiServer }) => {
    const apiUrl = apiServer.url;

    // Get CSRF token for super-admin
    const csrfRes = await fetch(`${apiUrl}/api/csrf-token`, {
      headers: { Cookie: userDSessionCookie }
    });
    const csrfData = await csrfRes.json();

    // Verify the audit chain
    const verifyRes = await fetch(`${apiUrl}/api/audit-logs/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userDSessionCookie,
        'x-csrf-token': csrfData.token,
      },
      body: JSON.stringify({ workspace_id: workspace1Id })
    });

    expect(verifyRes.status).toBe(200);
    const verifyData = await verifyRes.json();

    expect(verifyData.success).toBe(true);
    expect(verifyData.data.valid).toBe(true);
    expect(verifyData.data.records_checked).toBeGreaterThan(0);
  });

  test('Audit logs include record_hash for tamper-evidence', async ({ apiServer }) => {
    const apiUrl = apiServer.url;

    // Query audit logs
    const auditRes = await fetch(`${apiUrl}/api/audit-logs?resource_id=${documentId}`, {
      headers: { Cookie: userDSessionCookie }
    });

    expect(auditRes.status).toBe(200);
    const auditData = await auditRes.json();

    // All records should have record_hash
    const logsWithHash = auditData.data.logs.filter((l: any) => l.recordHash);
    expect(logsWithHash.length).toBe(auditData.data.logs.length);

    // Hashes should be 64-character hex strings
    for (const log of auditData.data.logs) {
      expect(log.recordHash).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  test('CloudWatch integration (skipped if not configured)', async ({ apiServer }) => {
    // Skip if CloudWatch is not configured
    if (!process.env.CLOUDWATCH_AUDIT_LOG_GROUP) {
      test.skip(true, 'CloudWatch not configured - skipping CloudWatch verification');
      return;
    }

    // This test would verify CloudWatch has the same events as DB
    // For now, we verify health check reports CloudWatch status
    const apiUrl = apiServer.url;
    const healthRes = await fetch(`${apiUrl}/health`);
    const healthData = await healthRes.json();

    expect(healthData.cloudwatch_audit_status).toBeDefined();
  });

  test('Complete leak investigation produces evidence trail', async ({ apiServer }) => {
    const apiUrl = apiServer.url;

    // Final verification: query all events for the document
    const auditRes = await fetch(`${apiUrl}/api/audit-logs?resource_id=${documentId}`, {
      headers: { Cookie: userDSessionCookie }
    });

    expect(auditRes.status).toBe(200);
    const auditData = await auditRes.json();

    // Build the investigation report
    const events = auditData.data.logs;

    // Evidence: Who created the document?
    const creators = events
      .filter((e: any) => e.action === 'document.create')
      .map((e: any) => e.actorEmail);
    expect(creators.length).toBeGreaterThanOrEqual(1);

    // Evidence: Who viewed the document successfully?
    const viewers = events
      .filter((e: any) => e.action === 'document.view')
      .map((e: any) => e.actorEmail);
    expect(viewers.length).toBeGreaterThanOrEqual(2); // B and D

    // Evidence: Who was denied access?
    const denied = events
      .filter((e: any) => e.action === 'document.view_denied')
      .map((e: any) => e.actorEmail);
    expect(denied.length).toBeGreaterThanOrEqual(1); // C

    // Evidence: All events are timestamped in ISO 8601 format
    for (const event of events) {
      expect(event.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }

    // Evidence: All events have tamper-evident hash chain
    for (const event of events) {
      expect(event.recordHash).toMatch(/^[a-f0-9]{64}$/);
    }

    console.log(`
    ====== LEAK INVESTIGATION COMPLETE ======
    Document: Confidential Report (${documentId})

    Created by: ${creators.join(', ')}
    Viewed by: ${viewers.join(', ')}
    Denied to: ${denied.join(', ')}

    Total audit records: ${events.length}
    All records have tamper-evident hashes: YES
    Chain integrity: VERIFIED
    =========================================
    `);
  });
});
