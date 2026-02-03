import { beforeAll, afterAll } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Test setup for API integration tests
// This runs before all tests in each test file

// Read DATABASE_URL from temp file created by globalSetup (testcontainers)
const TEST_DB_URI_FILE = join(tmpdir(), 'ship-test-db-uri')
if (existsSync(TEST_DB_URI_FILE)) {
  process.env.DATABASE_URL = readFileSync(TEST_DB_URI_FILE, 'utf-8').trim()
}

// Import pool AFTER setting DATABASE_URL
const { pool } = await import('../db/client.js')

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
  await pool.query('DELETE FROM audit_logs WHERE 1=1')
  await pool.query('DELETE FROM workspace_memberships WHERE 1=1')
  await pool.query('DELETE FROM users WHERE 1=1')
  await pool.query('DELETE FROM workspaces WHERE 1=1')
})

afterAll(async () => {
  // Close pool only at the very end - vitest handles this via globalTeardown
})
