import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { tmpdir } from 'os'
import pg from 'pg'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Temp file to share connection URI between globalSetup and test processes
export const TEST_DB_URI_FILE = join(tmpdir(), 'ship-test-db-uri')

// Set USE_DOCKER_DB=true to use testcontainers instead of local PostgreSQL
const useDockerDb = process.env.USE_DOCKER_DB === 'true'

export async function setup() {
  if (!useDockerDb) {
    // Local PostgreSQL mode - do nothing, tests will use DATABASE_URL from .env.local
    console.log('Using local PostgreSQL (set USE_DOCKER_DB=true for containerized DB)')
    return
  }

  // Docker mode - start a PostgreSQL container
  console.log('Starting PostgreSQL container for tests...')

  // Dynamic import to avoid loading testcontainers when not needed
  const { PostgreSqlContainer } = await import('@testcontainers/postgresql')

  const container = await new PostgreSqlContainer('postgres:16')
    .withDatabase('ship_test')
    .withUsername('test')
    .withPassword('test')
    .start()

  const connectionUri = container.getConnectionUri()

  // Write connection URI to temp file for test processes to read
  writeFileSync(TEST_DB_URI_FILE, connectionUri)

  // Also write container ID so teardown can stop it
  writeFileSync(`${TEST_DB_URI_FILE}.container`, container.getId())

  console.log(`PostgreSQL container started: ${connectionUri}`)

  // Run schema setup
  const pool = new pg.Pool({ connectionString: connectionUri })

  try {
    // Load and run schema
    const schemaPath = join(__dirname, '../db/schema.sql')
    const schema = readFileSync(schemaPath, 'utf-8')
    await pool.query(schema)
    console.log('Database schema initialized')

    // Run migrations
    const { runMigrations } = await import('../db/migrate.js')
    await runMigrations(pool)
    console.log('Migrations completed')
  } finally {
    await pool.end()
  }
}

export async function teardown() {
  if (!useDockerDb) {
    // Local PostgreSQL mode - nothing to clean up
    return
  }

  console.log('Stopping PostgreSQL container...')

  // Read container ID from temp file
  const containerIdFile = `${TEST_DB_URI_FILE}.container`
  if (existsSync(containerIdFile)) {
    const containerId = readFileSync(containerIdFile, 'utf-8').trim()

    // Stop container using docker CLI (testcontainers doesn't persist container reference)
    const { execSync } = await import('child_process')
    try {
      execSync(`docker stop ${containerId}`, { stdio: 'inherit' })
      execSync(`docker rm ${containerId}`, { stdio: 'inherit' })
    } catch {
      // Container may already be stopped/removed
    }

    // Clean up temp files
    unlinkSync(containerIdFile)
  }

  if (existsSync(TEST_DB_URI_FILE)) {
    unlinkSync(TEST_DB_URI_FILE)
  }

  console.log('PostgreSQL container stopped')
}
