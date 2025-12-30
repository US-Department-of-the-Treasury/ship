import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import pg from 'pg';
import bcrypt from 'bcrypt';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment
config({ path: join(__dirname, '../../.env.local') });
config({ path: join(__dirname, '../../.env') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function seed() {
  console.log('🌱 Starting database seed...');
  console.log(`   Database: ${process.env.DATABASE_URL}`);

  try {
    // Run schema
    const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
    await pool.query(schema);
    console.log('✅ Schema created');

    // Check if workspace exists
    const existingWorkspace = await pool.query(
      'SELECT id FROM workspaces WHERE name = $1',
      ['Ship Workspace']
    );

    let workspaceId: string;

    if (existingWorkspace.rows[0]) {
      workspaceId = existingWorkspace.rows[0].id;
      console.log('ℹ️  Workspace already exists');
    } else {
      // Create workspace with sprint_start_date 3 months ago
      // This gives us historical sprint data to display
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      const workspaceResult = await pool.query(
        `INSERT INTO workspaces (name, sprint_start_date)
         VALUES ($1, $2)
         RETURNING id`,
        ['Ship Workspace', threeMonthsAgo.toISOString().split('T')[0]]
      );
      workspaceId = workspaceResult.rows[0].id;
      console.log('✅ Workspace created');
    }

    // Team members to seed (dev user + 10 fake users)
    const teamMembers = [
      { email: 'dev@ship.local', name: 'Dev User' },
      { email: 'alice.chen@ship.local', name: 'Alice Chen' },
      { email: 'bob.martinez@ship.local', name: 'Bob Martinez' },
      { email: 'carol.williams@ship.local', name: 'Carol Williams' },
      { email: 'david.kim@ship.local', name: 'David Kim' },
      { email: 'emma.johnson@ship.local', name: 'Emma Johnson' },
      { email: 'frank.garcia@ship.local', name: 'Frank Garcia' },
      { email: 'grace.lee@ship.local', name: 'Grace Lee' },
      { email: 'henry.patel@ship.local', name: 'Henry Patel' },
      { email: 'iris.nguyen@ship.local', name: 'Iris Nguyen' },
      { email: 'jack.brown@ship.local', name: 'Jack Brown' },
    ];

    const passwordHash = await bcrypt.hash('admin123', 10);
    let usersCreated = 0;

    for (const member of teamMembers) {
      const existingUser = await pool.query(
        'SELECT id FROM users WHERE email = $1',
        [member.email]
      );

      if (!existingUser.rows[0]) {
        await pool.query(
          `INSERT INTO users (workspace_id, email, password_hash, name)
           VALUES ($1, $2, $3, $4)`,
          [workspaceId, member.email, passwordHash, member.name]
        );
        usersCreated++;
      }
    }

    if (usersCreated > 0) {
      console.log(`✅ Created ${usersCreated} users (all use password: admin123)`);
    } else {
      console.log('ℹ️  All users already exist');
    }

    console.log('');
    console.log('🎉 Seed complete!');
    console.log('');
    console.log('Login credentials:');
    console.log('  Email: dev@ship.local');
    console.log('  Password: admin123');
  } catch (error) {
    console.error('❌ Seed failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seed();
