/**
 * Isolated E2E Test Environment
 *
 * Each Playwright worker gets its own:
 * - PostgreSQL container (via testcontainers)
 * - API server instance (dynamic port)
 * - Vite preview server (dynamic port, lightweight static server)
 *
 * CRITICAL: We use `vite preview` instead of `vite dev` because:
 * - vite dev starts HMR, file watchers, and uses 300-500MB per instance
 * - vite preview is a lightweight static server using ~30-50MB
 * - Running 8 vite dev servers caused 90GB memory explosion and system crash
 *
 * This eliminates flakiness from shared database state.
 */

import { test as base } from '@playwright/test';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { spawn, ChildProcess } from 'child_process';
import { Pool } from 'pg';
import { readdirSync, readFileSync, existsSync } from 'fs';
import path from 'path';
import getPort, { portNumbers } from 'get-port';
import bcrypt from 'bcryptjs';
import os from 'os';

/**
 * Get port for a worker with collision avoidance.
 *
 * Each worker gets its own port range to avoid race conditions when
 * multiple workers call getPort() simultaneously. Uses a base port of 50000
 * with 100-port ranges per worker:
 * - Worker 0: 50000-50099
 * - Worker 1: 50100-50199
 * - etc.
 */
async function getWorkerPort(workerIndex: number): Promise<number> {
  const BASE_PORT = 50000;
  const PORTS_PER_WORKER = 100;
  const startPort = BASE_PORT + workerIndex * PORTS_PER_WORKER;
  const endPort = startPort + PORTS_PER_WORKER - 1;

  return getPort({ port: portNumbers(startPort, endPort) });
}

// Get project root (fixtures is at e2e/fixtures/, so go up 2 levels)
const PROJECT_ROOT = path.resolve(__dirname, '../..');

/**
 * Get available system memory in GB.
 * Used to warn if running too many workers.
 */
function getAvailableMemoryGB(): number {
  const freeMem = os.freemem();
  return freeMem / (1024 * 1024 * 1024);
}

/**
 * Calculate safe number of workers based on available memory.
 * Each worker needs roughly: 150MB (Postgres) + 100MB (API) + 50MB (preview) = ~300MB minimum
 * Add buffer for tests, browser, etc = ~500MB per worker safe estimate
 */
function getSafeWorkerCount(): number {
  const availableGB = getAvailableMemoryGB();
  const memPerWorker = 0.5; // 500MB per worker
  const reserveGB = 2; // Keep 2GB free for OS and other processes
  const safeCount = Math.max(1, Math.floor((availableGB - reserveGB) / memPerWorker));
  return Math.min(safeCount, 8); // Cap at 8 regardless
}

// Only warn if memory is critically low (config handles worker calculation)
const availableMem = getAvailableMemoryGB();
if (availableMem < 4) {
  console.warn(`⚠️  Low memory (${availableMem.toFixed(1)}GB). Consider reducing workers.`);
}

// Types for our worker-scoped fixtures
type WorkerFixtures = {
  dbContainer: StartedPostgreSqlContainer;
  apiServer: { url: string; process: ChildProcess };
  webServer: { url: string; process: ChildProcess };
};

// Extend the base test with our isolated environment
// Worker fixtures are accessible in tests but live at worker scope
export const test = base.extend<
  { apiServer: { url: string; process: ChildProcess } },
  WorkerFixtures
>({
  // PostgreSQL container - one per worker, starts fresh for each test run
  dbContainer: [
    async ({}, use, workerInfo) => {
      const workerTag = `[Worker ${workerInfo.workerIndex}]`;
      const debug = process.env.DEBUG === '1';
      if (debug) console.log(`${workerTag} Starting PostgreSQL container...`);

      const container = await new PostgreSqlContainer('postgres:15')
        .withDatabase('ship_test')
        .withUsername('test')
        .withPassword('test')
        .start();

      const dbUrl = container.getConnectionUri();
      if (debug) console.log(`${workerTag} PostgreSQL ready on port ${container.getMappedPort(5432)}`);

      // Run schema and migrations
      if (debug) console.log(`${workerTag} Running migrations...`);
      await runMigrations(dbUrl);
      if (debug) console.log(`${workerTag} Migrations complete`);

      await use(container);

      if (debug) console.log(`${workerTag} Stopping PostgreSQL container...`);
      await container.stop();
    },
    { scope: 'worker' },
  ],

  // API server - one per worker
  apiServer: [
    async ({ dbContainer }, use, workerInfo) => {
      const workerTag = `[Worker ${workerInfo.workerIndex}]`;
      const debug = process.env.DEBUG === '1';
      // Use worker-specific port range to avoid collisions between parallel workers
      const port = await getWorkerPort(workerInfo.workerIndex);
      const dbUrl = dbContainer.getConnectionUri();

      if (debug) console.log(`${workerTag} Starting API server on port ${port}...`);

      // Use the built API (faster than dev server)
      const proc = spawn('node', ['dist/index.js'], {
        cwd: path.join(PROJECT_ROOT, 'api'),
        env: {
          ...process.env,
          PORT: String(port),
          DATABASE_URL: dbUrl,
          CORS_ORIGIN: '*', // Allow any origin during tests
          NODE_ENV: 'test',
          // Prevent dotenv from overriding our DATABASE_URL
          DOTENV_CONFIG_PATH: '/dev/null',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Log server output for debugging
      proc.stdout?.on('data', (data) => {
        if (process.env.DEBUG) {
          console.log(`${workerTag} API: ${data.toString().trim()}`);
        }
      });
      proc.stderr?.on('data', (data) => {
        console.error(`${workerTag} API ERROR: ${data.toString().trim()}`);
      });

      // Wait for server to be ready
      const apiUrl = `http://localhost:${port}`;
      await waitForServer(`${apiUrl}/health`, 30000);
      if (debug) console.log(`${workerTag} API server ready at ${apiUrl}`);

      await use({ url: apiUrl, process: proc });

      if (debug) console.log(`${workerTag} Stopping API server...`);
      proc.kill('SIGTERM');
    },
    { scope: 'worker' },
  ],

  // Vite preview server - one per worker (lightweight static server, NOT dev server)
  // CRITICAL: We use vite preview instead of vite dev to avoid memory explosion
  // vite dev = 300-500MB per instance (HMR, file watchers, dependency graph)
  // vite preview = 30-50MB per instance (simple static file server)
  webServer: [
    async ({ apiServer }, use, workerInfo) => {
      const workerTag = `[Worker ${workerInfo.workerIndex}]`;
      const debug = process.env.DEBUG === '1';
      // Use worker-specific port range (separate from API port)
      const port = await getWorkerPort(workerInfo.workerIndex);

      // Extract API port from URL
      const apiPort = new URL(apiServer.url).port;

      // Verify web dist exists (globalSetup should have built it)
      const distPath = path.join(PROJECT_ROOT, 'web/dist');
      if (!existsSync(distPath)) {
        throw new Error(
          `${workerTag} Web dist not found at ${distPath}. ` +
          `globalSetup should build it. Run: pnpm build:web`
        );
      }

      if (debug) console.log(`${workerTag} Starting Vite preview server on port ${port} (API proxy to ${apiPort})...`);

      // Use vite preview instead of vite dev - much lighter weight
      // We pass the API port via env var so vite.config.ts can set up the proxy
      const proc = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
        cwd: path.join(PROJECT_ROOT, 'web'),
        env: {
          ...process.env,
          API_PORT: apiPort, // Our env var for Vite proxy
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Log output for debugging
      proc.stdout?.on('data', (data) => {
        if (process.env.DEBUG) {
          console.log(`${workerTag} Preview: ${data.toString().trim()}`);
        }
      });
      proc.stderr?.on('data', (data) => {
        // Vite uses stderr for some normal output
        if (process.env.DEBUG) {
          console.log(`${workerTag} Preview: ${data.toString().trim()}`);
        }
      });

      const webUrl = `http://localhost:${port}`;
      await waitForServer(webUrl, 30000); // Preview starts much faster than dev
      if (debug) console.log(`${workerTag} Vite preview server ready at ${webUrl}`);

      await use({ url: webUrl, process: proc });

      if (debug) console.log(`${workerTag} Stopping Vite preview server...`);
      proc.kill('SIGTERM');
    },
    { scope: 'worker' },
  ],

  // Override baseURL to use our isolated web server
  baseURL: async ({ webServer }, use) => {
    await use(webServer.url);
  },
});

/**
 * Run database schema, migrations, and seed minimal test data
 */
async function runMigrations(dbUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: dbUrl });

  try {
    // Step 1: Run schema.sql for initial setup
    const schemaPath = path.join(PROJECT_ROOT, 'api/src/db/schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');
    await pool.query(schema);

    // Step 2: Create migrations tracking table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT now()
      )
    `);

    // Step 3: Get list of already-applied migrations
    const appliedResult = await pool.query('SELECT version FROM schema_migrations ORDER BY version');
    const appliedMigrations = new Set(appliedResult.rows.map((r) => r.version));

    // Step 4: Find and run pending migrations
    const migrationsDir = path.join(PROJECT_ROOT, 'api/src/db/migrations');
    let migrationFiles: string[] = [];

    try {
      migrationFiles = readdirSync(migrationsDir)
        .filter((f) => f.endsWith('.sql'))
        .sort();
    } catch {
      // No migrations directory
    }

    for (const file of migrationFiles) {
      const version = file.replace('.sql', '');

      if (appliedMigrations.has(version)) {
        continue;
      }

      const migrationPath = path.join(migrationsDir, file);
      const migrationSql = readFileSync(migrationPath, 'utf-8');

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(migrationSql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    // Step 5: Seed minimal test data
    await seedMinimalTestData(pool);
  } finally {
    await pool.end();
  }
}

/**
 * Seed comprehensive test data matching the full seed script:
 * - 1 workspace with sprint_start_date 3 months ago
 * - 1 user (dev@ship.local / admin123)
 * - workspace membership + person document
 * - 5 programs (Ship Core, Authentication, API Platform, Design System, Infrastructure)
 * - Sprints for each program
 * - Issues with various states
 */
async function seedMinimalTestData(pool: Pool): Promise<void> {
  // Hash the test password
  const passwordHash = await bcrypt.hash('admin123', 10);

  // Create workspace with sprint_start_date 3 months ago (matches full seed)
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const workspaceResult = await pool.query(
    `INSERT INTO workspaces (name, sprint_start_date)
     VALUES ('Test Workspace', $1)
     RETURNING id`,
    [threeMonthsAgo.toISOString().split('T')[0]]
  );
  const workspaceId = workspaceResult.rows[0].id;

  // Create test user
  const userResult = await pool.query(
    `INSERT INTO users (email, password_hash, name, is_super_admin, last_workspace_id)
     VALUES ('dev@ship.local', $1, 'Dev User', true, $2)
     RETURNING id`,
    [passwordHash, workspaceId]
  );
  const userId = userResult.rows[0].id;

  // Create workspace membership
  await pool.query(
    `INSERT INTO workspace_memberships (workspace_id, user_id, role)
     VALUES ($1, $2, 'admin')`,
    [workspaceId, userId]
  );

  // Create person document for user
  await pool.query(
    `INSERT INTO documents (workspace_id, document_type, title, properties, created_by)
     VALUES ($1, 'person', 'Dev User', $2, $3)`,
    [workspaceId, JSON.stringify({ user_id: userId, email: 'dev@ship.local' }), userId]
  );

  // Create a member user (non-admin) for authorization tests
  const memberResult = await pool.query(
    `INSERT INTO users (email, password_hash, name, is_super_admin, last_workspace_id)
     VALUES ('bob.martinez@ship.local', $1, 'Bob Martinez', false, $2)
     RETURNING id`,
    [passwordHash, workspaceId]
  );
  const memberId = memberResult.rows[0].id;

  // Create workspace membership as regular member (not admin)
  await pool.query(
    `INSERT INTO workspace_memberships (workspace_id, user_id, role)
     VALUES ($1, $2, 'member')`,
    [workspaceId, memberId]
  );

  // Create person document for member
  await pool.query(
    `INSERT INTO documents (workspace_id, document_type, title, properties, created_by)
     VALUES ($1, 'person', 'Bob Martinez', $2, $3)`,
    [workspaceId, JSON.stringify({ user_id: memberId, email: 'bob.martinez@ship.local' }), userId]
  );

  // Create programs (matching full seed)
  // 'key' is used for test referencing only, not stored in database
  const programs = [
    { key: 'SHIP', name: 'Ship Core', color: '#3B82F6' },
    { key: 'AUTH', name: 'Authentication', color: '#8B5CF6' },
    { key: 'API', name: 'API Platform', color: '#10B981' },
    { key: 'UI', name: 'Design System', color: '#F59E0B' },
    { key: 'INFRA', name: 'Infrastructure', color: '#EF4444' },
  ];

  const programIds: Record<string, string> = {};
  for (const prog of programs) {
    const result = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, properties, created_by)
       VALUES ($1, 'program', $2, $3, $4)
       RETURNING id`,
      [workspaceId, prog.name, JSON.stringify({ color: prog.color }), userId]
    );
    programIds[prog.key] = result.rows[0].id;
  }

  // Calculate current sprint number
  const today = new Date();
  const daysSinceStart = Math.floor((today.getTime() - threeMonthsAgo.getTime()) / (1000 * 60 * 60 * 24));
  const currentSprintNumber = Math.max(1, Math.floor(daysSinceStart / 14) + 1);

  // Create sprints for each program (current-2 to current+2)
  const sprintIds: Record<string, Record<number, string>> = {};
  for (const prog of programs) {
    sprintIds[prog.key] = {};
    for (let sprintNum = currentSprintNumber - 2; sprintNum <= currentSprintNumber + 2; sprintNum++) {
      if (sprintNum > 0) {
        const result = await pool.query(
          `INSERT INTO documents (workspace_id, document_type, title, program_id, properties, created_by)
           VALUES ($1, 'sprint', $2, $3, $4, $5)
           RETURNING id`,
          [
            workspaceId,
            `Sprint ${sprintNum}`,
            programIds[prog.key],
            JSON.stringify({ sprint_number: sprintNum, owner_id: userId }),
            userId,
          ]
        );
        sprintIds[prog.key][sprintNum] = result.rows[0].id;
      }
    }
  }

  // Create issues for Ship Core with various states
  const shipCoreIssues = [
    // Done issues (past sprint)
    { title: 'Initial project setup', state: 'done', priority: 'high', sprintOffset: -1 },
    { title: 'Database schema design', state: 'done', priority: 'high', sprintOffset: -1 },
    // Current sprint - mixed states
    { title: 'Implement sprint management', state: 'done', priority: 'high', sprintOffset: 0 },
    { title: 'Build issue assignment flow', state: 'in_progress', priority: 'high', sprintOffset: 0 },
    { title: 'Add sprint velocity metrics', state: 'todo', priority: 'medium', sprintOffset: 0 },
    { title: 'Implement burndown chart', state: 'todo', priority: 'medium', sprintOffset: 0 },
    // Future sprint
    { title: 'Add team workload view', state: 'todo', priority: 'high', sprintOffset: 1 },
    // Backlog (no sprint)
    { title: 'Add dark mode support', state: 'backlog', priority: 'low', sprintOffset: null },
    { title: 'Create mobile app', state: 'backlog', priority: 'low', sprintOffset: null },
  ];

  let ticketNumber = 0;
  for (const issue of shipCoreIssues) {
    ticketNumber++;
    const sprintId = issue.sprintOffset !== null
      ? sprintIds['SHIP'][currentSprintNumber + issue.sprintOffset] || null
      : null;

    await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, program_id, sprint_id, properties, ticket_number, created_by)
       VALUES ($1, 'issue', $2, $3, $4, $5, $6, $7)`,
      [
        workspaceId,
        issue.title,
        programIds['SHIP'],
        sprintId,
        JSON.stringify({
          state: issue.state,
          priority: issue.priority,
          source: 'internal',
          assignee_id: userId,
        }),
        ticketNumber,
        userId,
      ]
    );
  }

  // Create a few issues for other programs too
  for (const prog of programs.filter(p => p.key !== 'SHIP')) {
    ticketNumber++;
    await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, program_id, sprint_id, properties, ticket_number, created_by)
       VALUES ($1, 'issue', $2, $3, $4, $5, $6, $7)`,
      [
        workspaceId,
        `${prog.name} initial setup`,
        programIds[prog.key],
        sprintIds[prog.key][currentSprintNumber] || null,
        JSON.stringify({ state: 'in_progress', priority: 'medium', source: 'internal', assignee_id: userId }),
        ticketNumber,
        userId,
      ]
    );
  }

  // Create external issues for feedback consolidation testing
  const externalIssues = [
    // Issue in triage (awaiting review)
    { title: 'External feature request from user', state: 'triage', rejection_reason: null },
    { title: 'Bug report from customer', state: 'triage', rejection_reason: null },
    // Accepted external feedback (moved to backlog)
    { title: 'Accepted user suggestion', state: 'backlog', rejection_reason: null },
    // Rejected external feedback
    { title: 'Rejected spam submission', state: 'cancelled', rejection_reason: 'Not relevant to product' },
  ];

  for (const issue of externalIssues) {
    ticketNumber++;
    const properties: Record<string, unknown> = {
      state: issue.state,
      priority: 'medium',
      source: 'external',
    };
    if (issue.rejection_reason) {
      properties.rejection_reason = issue.rejection_reason;
    }
    await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, program_id, properties, ticket_number, created_by)
       VALUES ($1, 'issue', $2, $3, $4, $5, $6)`,
      [workspaceId, issue.title, programIds['SHIP'], JSON.stringify(properties), ticketNumber, userId]
    );
  }

  // Create wiki documents with nested structure for tree testing
  const parentDocResult = await pool.query(
    `INSERT INTO documents (workspace_id, document_type, title, created_by)
     VALUES ($1, 'wiki', 'Welcome to Ship', $2)
     RETURNING id`,
    [workspaceId, userId]
  );
  const parentDocId = parentDocResult.rows[0].id;

  // Create child documents to enable tree expand/collapse testing
  const childDocs = [
    { title: 'Getting Started' },
    { title: 'Advanced Topics' },
  ];

  for (const child of childDocs) {
    await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, parent_id, created_by)
       VALUES ($1, 'wiki', $2, $3, $4)`,
      [workspaceId, child.title, parentDocId, userId]
    );
  }
}

/**
 * Wait for a server to respond successfully
 */
async function waitForServer(url: string, timeout: number): Promise<void> {
  const start = Date.now();
  let lastError: Error | null = null;

  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 401 || res.status === 403) {
        // 401/403 means server is running, just needs auth
        return;
      }
    } catch (err) {
      lastError = err as Error;
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  throw new Error(`Server at ${url} did not start within ${timeout}ms. Last error: ${lastError?.message}`);
}

// Re-export expect for convenience
export { expect } from '@playwright/test';
