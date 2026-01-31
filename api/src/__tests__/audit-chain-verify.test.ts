import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { pool } from '../db/client.js'

describe('Audit Chain Verification', () => {
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  let testUserId: string
  let testWorkspaceId: string
  let auditRecordIds: string[] = []

  beforeAll(async () => {
    // Create test workspace
    const workspaceResult = await pool.query(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
      [`Chain Verify Test ${testRunId}`]
    )
    testWorkspaceId = workspaceResult.rows[0].id

    // Create test user
    const userResult = await pool.query(
      `INSERT INTO users (email, name) VALUES ($1, 'Chain Verify Test User') RETURNING id`,
      [`chain-verify-test-${testRunId}@ship.local`]
    )
    testUserId = userResult.rows[0].id

    // Clean up any existing test records
    await pool.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_no_delete')
    await pool.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_no_update')
    await pool.query("DELETE FROM audit_logs WHERE action LIKE 'test.verify.%'")
    await pool.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_no_update')
    await pool.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_no_delete')

    // Create test audit records
    for (let i = 0; i < 5; i++) {
      const result = await pool.query(
        `INSERT INTO audit_logs (actor_user_id, workspace_id, action, details, ip_address, user_agent, created_at)
         VALUES ($1, $2, $3, '{}', '127.0.0.1', 'verify-test', NOW() + interval '${i} milliseconds')
         RETURNING id`,
        [testUserId, testWorkspaceId, `test.verify.${i}`]
      )
      auditRecordIds.push(result.rows[0].id)
    }
  })

  afterAll(async () => {
    // Clean up test records
    await pool.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_no_delete')
    await pool.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_no_update')
    await pool.query("DELETE FROM audit_logs WHERE action LIKE 'test.verify.%'")
    await pool.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_no_update')
    await pool.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_no_delete')

    // Clean up archive checkpoints (use workspace_id since we don't have created_by values)
    await pool.query('DELETE FROM archive_checkpoint WHERE workspace_id = $1', [testWorkspaceId])

    // Clean up test user and workspace
    await pool.query('DELETE FROM users WHERE id = $1', [testUserId])
    await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId])
  })

  it('returns empty result for valid chain', async () => {
    // Use workspace-scoped verification to avoid pollution from other tests
    const result = await pool.query(
      `SELECT * FROM verify_audit_chain(p_workspace_id := $1)`,
      [testWorkspaceId]
    )
    expect(result.rows.length).toBe(0)
  })

  it('detects hash tampering', async () => {
    // Temporarily disable trigger to tamper with record
    await pool.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_no_update')

    // Tamper with a record's record_hash
    const recordId = auditRecordIds[2]
    await pool.query(
      `UPDATE audit_logs SET record_hash = 'bad0000000000000000000000000000000000000000000000000000000000000' WHERE id = $1`,
      [recordId]
    )

    // Verify detection (workspace-scoped)
    const result = await pool.query(
      `SELECT * FROM verify_audit_chain(p_workspace_id := $1)`,
      [testWorkspaceId]
    )
    const tamperedRecord = result.rows.find(r => r.id === recordId)
    expect(tamperedRecord).toBeDefined()
    expect(tamperedRecord.is_valid).toBe(false)
    expect(tamperedRecord.error_message).toContain('Record hash mismatch')

    // Restore the record by re-computing hash
    const rec = await pool.query(
      `SELECT previous_hash, created_at, actor_user_id, action, resource_type, resource_id, workspace_id
       FROM audit_logs WHERE id = $1`,
      [recordId]
    )
    const r = rec.rows[0]
    await pool.query(
      `UPDATE audit_logs SET record_hash = compute_audit_record_hash($1, $2, $3, $4, $5, $6, $7) WHERE id = $8`,
      [
        r.previous_hash,
        r.created_at,
        r.actor_user_id,
        r.action,
        r.resource_type,
        r.resource_id,
        r.workspace_id,
        recordId,
      ]
    )

    await pool.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_no_update')

    // Verify chain is valid again (workspace-scoped)
    const verifyResult = await pool.query(
      `SELECT * FROM verify_audit_chain(p_workspace_id := $1)`,
      [testWorkspaceId]
    )
    expect(verifyResult.rows.length).toBe(0)
  })

  it('detects previous_hash tampering (chain break)', async () => {
    await pool.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_no_update')

    // Store original values for restoration
    const recordId = auditRecordIds[3]
    const original = await pool.query(
      `SELECT previous_hash FROM audit_logs WHERE id = $1`,
      [recordId]
    )
    const originalPrevHash = original.rows[0].previous_hash

    // Tamper with previous_hash
    await pool.query(
      `UPDATE audit_logs SET previous_hash = 'bad0000000000000000000000000000000000000000000000000000000000000' WHERE id = $1`,
      [recordId]
    )

    // Verify detection (workspace-scoped)
    const result = await pool.query(
      `SELECT * FROM verify_audit_chain(p_workspace_id := $1)`,
      [testWorkspaceId]
    )
    const brokenRecord = result.rows.find(r => r.id === recordId)
    expect(brokenRecord).toBeDefined()
    expect(brokenRecord.is_valid).toBe(false)
    expect(brokenRecord.error_message).toContain('Previous hash mismatch')

    // Restore original value
    await pool.query(
      `UPDATE audit_logs SET previous_hash = $1 WHERE id = $2`,
      [originalPrevHash, recordId]
    )

    await pool.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_no_update')
  })

  it('filters by workspace_id', async () => {
    // Create a record in a different workspace
    const otherWorkspaceResult = await pool.query(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
      [`Other Workspace ${testRunId}`]
    )
    const otherWorkspaceId = otherWorkspaceResult.rows[0].id

    await pool.query(
      `INSERT INTO audit_logs (actor_user_id, workspace_id, action, details, ip_address, user_agent, created_at)
       VALUES ($1, $2, 'test.verify.other', '{}', '127.0.0.1', 'verify-test', NOW())`,
      [testUserId, otherWorkspaceId]
    )

    // Verify with workspace filter returns empty for our test workspace
    const result = await pool.query(
      `SELECT * FROM verify_audit_chain(p_workspace_id := $1)`,
      [testWorkspaceId]
    )
    expect(result.rows.length).toBe(0)

    // Clean up
    await pool.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_no_delete')
    await pool.query(`DELETE FROM audit_logs WHERE action = 'test.verify.other'`)
    await pool.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_no_delete')
    await pool.query('DELETE FROM workspaces WHERE id = $1', [otherWorkspaceId])
  })

  it('respects limit parameter', async () => {
    // Create more records to test limit
    const moreRecords: string[] = []
    for (let i = 0; i < 10; i++) {
      const result = await pool.query(
        `INSERT INTO audit_logs (actor_user_id, workspace_id, action, details, ip_address, user_agent, created_at)
         VALUES ($1, $2, $3, '{}', '127.0.0.1', 'verify-test', NOW() + interval '${100 + i} milliseconds')
         RETURNING id`,
        [testUserId, testWorkspaceId, `test.verify.limit.${i}`]
      )
      moreRecords.push(result.rows[0].id)
    }

    // Tamper with a record that should be outside the limit
    await pool.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_no_update')
    const lastRecordId = moreRecords[moreRecords.length - 1]
    await pool.query(
      `UPDATE audit_logs SET record_hash = 'bad0000000000000000000000000000000000000000000000000000000000000' WHERE id = $1`,
      [lastRecordId]
    )

    // With a small limit, the tampered record should not be found (workspace-scoped)
    const limitResult = await pool.query(
      `SELECT * FROM verify_audit_chain(p_workspace_id := $1, p_limit := 5)`,
      [testWorkspaceId]
    )
    const tamperedInLimit = limitResult.rows.find(r => r.id === lastRecordId)
    expect(tamperedInLimit).toBeUndefined()

    // Without limit, it should be found (workspace-scoped)
    const fullResult = await pool.query(
      `SELECT * FROM verify_audit_chain(p_workspace_id := $1)`,
      [testWorkspaceId]
    )
    const tamperedInFull = fullResult.rows.find(r => r.id === lastRecordId)
    expect(tamperedInFull).toBeDefined()

    // Clean up
    await pool.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_no_delete')
    await pool.query("DELETE FROM audit_logs WHERE action LIKE 'test.verify.limit.%'")
    await pool.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_no_delete')
    await pool.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_no_update')
  })

  it('handles partial chain with archive checkpoint', async () => {
    // Get the first test record
    const firstRecord = await pool.query(
      `SELECT id, previous_hash FROM audit_logs WHERE action = 'test.verify.0' ORDER BY created_at LIMIT 1`
    )
    const firstRecordId = firstRecord.rows[0].id
    const firstPrevHash = firstRecord.rows[0].previous_hash

    // Simulate archival: delete first record and create checkpoint
    await pool.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_no_delete')
    await pool.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_no_update')

    // Get the first record's hash before deleting
    const hashResult = await pool.query(
      `SELECT record_hash FROM audit_logs WHERE id = $1`,
      [firstRecordId]
    )
    const firstRecordHash = hashResult.rows[0].record_hash

    // Delete the first record
    await pool.query(`DELETE FROM audit_logs WHERE id = $1`, [firstRecordId])

    // Initially, verification should fail because the second record's previous_hash
    // points to the deleted first record's hash which no longer exists
    // We need to verify globally since the deleted record affected the global chain
    const failResult = await pool.query(`SELECT * FROM verify_audit_chain()`)
    const missingCheckpoint = failResult.rows.find(r => r.error_message?.includes('Chain origin not found'))
    expect(missingCheckpoint).toBeDefined()

    // Add archive checkpoint with the deleted record's hash
    await pool.query(
      `INSERT INTO archive_checkpoint (last_record_id, last_record_created_at, last_record_hash, records_archived, workspace_id)
       VALUES ($1, NOW(), $2, 1, $3)`,
      [firstRecordId, firstRecordHash, testWorkspaceId]
    )

    // Now verification should pass (workspace-scoped to avoid other test pollution)
    const passResult = await pool.query(
      `SELECT * FROM verify_audit_chain(p_workspace_id := $1)`,
      [testWorkspaceId]
    )
    expect(passResult.rows.length).toBe(0)

    // Clean up - restore the deleted record (for other tests)
    // Note: We'll skip restoring since the record is gone and we cleaned up checkpoint
    await pool.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_no_update')
    await pool.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_no_delete')

    // Remove from our tracking (it's deleted)
    auditRecordIds = auditRecordIds.filter(id => id !== firstRecordId)
  })
})
