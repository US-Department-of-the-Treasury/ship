import pg from 'pg';
import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables before creating pool
config({ path: join(__dirname, '../../.env.local') });
config({ path: join(__dirname, '../../.env') });

const { Pool } = pg;

// Lazy-initialized pool to allow tests to set DATABASE_URL before first use
let _pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!_pool) {
    const isProduction = process.env.NODE_ENV === 'production';

    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Production-ready pool configuration
      max: isProduction ? 20 : 10, // Max connections (default is 10)
      idleTimeoutMillis: 30000, // Close idle connections after 30 seconds
      connectionTimeoutMillis: 2000, // Fail fast if can't connect in 2 seconds
      maxUses: 7500, // Recycle connections after 7500 queries to prevent memory leaks
      // DDoS protection: Terminate queries running longer than 30 seconds
      statement_timeout: 30000, // 30 seconds max query duration
    });
  }
  return _pool;
}

// Proxy object that forwards all calls to the lazy-initialized pool
const pool = new Proxy({} as pg.Pool, {
  get(_target, prop: keyof pg.Pool) {
    const realPool = getPool();
    const value = realPool[prop];
    if (typeof value === 'function') {
      return value.bind(realPool);
    }
    return value;
  },
});

// Graceful shutdown - close pool connections on process termination
process.on('SIGTERM', async () => {
  if (_pool) {
    console.log('SIGTERM received, closing database pool...');
    await _pool.end();
    console.log('Database pool closed');
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  if (_pool) {
    console.log('SIGINT received, closing database pool...');
    await _pool.end();
    console.log('Database pool closed');
  }
  process.exit(0);
});

export { pool };
