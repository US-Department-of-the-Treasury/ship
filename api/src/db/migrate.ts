#!/usr/bin/env npx ts-node
/**
 * Database migration script - runs schema.sql against the database
 * Used by Docker entrypoint for automatic schema setup
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { Pool } from 'pg';
import { loadProductionSecrets } from '../config/ssm.js';

// ESM compatibility - __dirname is not available in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function migrate() {
  // Load secrets from SSM in production
  await loadProductionSecrets();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL environment variable is not set');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  try {
    console.log('Running database migration...');

    // Read and execute schema
    const schemaPath = join(__dirname, 'schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');

    await pool.query(schema);

    console.log('Database migration completed successfully');
  } catch (error) {
    // Check if error is due to table already existing (not a real error)
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('already exists')) {
      console.log('Database schema already exists, skipping migration');
    } else {
      console.error('Database migration failed:', error);
      process.exit(1);
    }
  } finally {
    await pool.end();
  }
}

migrate();
