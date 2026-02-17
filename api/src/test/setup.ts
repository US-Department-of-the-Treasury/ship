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
  // Use TRUNCATE CASCADE which is faster and bypasses row-level triggers
  // (audit_logs has AU-9 compliance triggers preventing DELETE)
  await pool.query(`TRUNCATE TABLE
    workspace_invites, sessions, files, document_links, document_history,
    comments, document_associations, document_snapshots, sprint_iterations,
    issue_iterations, documents, audit_logs, workspace_memberships,
    users, workspaces
    CASCADE`)
})

afterAll(async () => {
  // Close pool only at the very end - vitest handles this via globalTeardown
})
