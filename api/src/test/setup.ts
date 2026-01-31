import { beforeAll, afterAll } from 'vitest'
import { pool } from '../db/client.js'

// Test setup for API integration tests
// This runs before all tests in each test file

beforeAll(async () => {
  // Ensure test environment
  process.env.NODE_ENV = 'test'

  // Clean up test data from previous runs to prevent duplicate key errors
  // Order matters due to foreign key constraints
  await pool.query('DELETE FROM workspace_invites WHERE 1=1')
  await pool.query('DELETE FROM sessions WHERE 1=1')
  await pool.query('DELETE FROM files WHERE 1=1')
  await pool.query('DELETE FROM document_links WHERE 1=1')
  await pool.query('DELETE FROM document_history WHERE 1=1')
  await pool.query('DELETE FROM documents WHERE 1=1')
  // audit_logs has immutability triggers - disable them for test cleanup only
  // This is safe because: (1) tests need clean slate, (2) production doesn't have this code
  // Must disable BOTH triggers because FK constraints trigger UPDATE (SET NULL) and DELETE (CASCADE)
  await pool.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_no_update')
  await pool.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_no_delete')
  await pool.query('DELETE FROM audit_logs WHERE 1=1')
  await pool.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_no_delete')
  await pool.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_no_update')
  await pool.query('DELETE FROM workspace_memberships WHERE 1=1')
  await pool.query('DELETE FROM users WHERE 1=1')
  await pool.query('DELETE FROM workspaces WHERE 1=1')
})

afterAll(async () => {
  // Close pool only at the very end - vitest handles this via globalTeardown
})
