import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { loadProductionSecrets } from '../config/ssm.js';
import { WELCOME_DOCUMENT_TITLE, WELCOME_DOCUMENT_CONTENT } from './welcomeDocument.js';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment (local dev only - production uses SSM)
config({ path: join(__dirname, '../../.env.local') });
config({ path: join(__dirname, '../../.env') });

async function seed() {
  // Load secrets from SSM in production (must happen before Pool creation)
  await loadProductionSecrets();

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });
  console.log('🌱 Starting database seed...');
  // Only log hostname, never full connection string (contains credentials)
  const dbHost = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).hostname : 'unknown';
  console.log(`   Database host: ${dbHost}`);

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
          `INSERT INTO users (email, password_hash, name, last_workspace_id)
           VALUES ($1, $2, $3, $4)`,
          [member.email, passwordHash, member.name, workspaceId]
        );
        usersCreated++;
      }
    }

    if (usersCreated > 0) {
      console.log(`✅ Created ${usersCreated} users (all use password: admin123)`);
    } else {
      console.log('ℹ️  All users already exist');
    }

    // Set dev user as super-admin and set their last workspace
    await pool.query(
      `UPDATE users SET is_super_admin = true, last_workspace_id = $1 WHERE email = 'dev@ship.local'`,
      [workspaceId]
    );
    console.log('✅ Set dev@ship.local as super-admin');

    // Create workspace memberships and Person documents for all users
    // Note: These are independent - no coupling via person_document_id
    let membershipsCreated = 0;
    let personDocsCreated = 0;
    const allUsersForMembership = await pool.query(
      'SELECT id, email, name FROM users'
    );

    for (const user of allUsersForMembership.rows) {
      // Check for existing membership
      const existingMembership = await pool.query(
        'SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
        [workspaceId, user.id]
      );

      if (!existingMembership.rows[0]) {
        // Make dev user an admin, others are members
        const role = user.email === 'dev@ship.local' ? 'admin' : 'member';
        await pool.query(
          `INSERT INTO workspace_memberships (workspace_id, user_id, role)
           VALUES ($1, $2, $3)`,
          [workspaceId, user.id, role]
        );
        membershipsCreated++;
      }

      // Check for existing person document (via properties.user_id)
      const existingPersonDoc = await pool.query(
        `SELECT id FROM documents
         WHERE workspace_id = $1 AND document_type = 'person' AND properties->>'user_id' = $2`,
        [workspaceId, user.id]
      );

      if (!existingPersonDoc.rows[0]) {
        // Create Person document with properties.user_id
        await pool.query(
          `INSERT INTO documents (workspace_id, document_type, title, properties, created_by)
           VALUES ($1, 'person', $2, $3, $4)`,
          [workspaceId, user.name, JSON.stringify({ user_id: user.id, email: user.email }), user.id]
        );
        personDocsCreated++;
      }
    }

    if (membershipsCreated > 0) {
      console.log(`✅ Created ${membershipsCreated} workspace memberships`);
    } else {
      console.log('ℹ️  All workspace memberships already exist');
    }

    if (personDocsCreated > 0) {
      console.log(`✅ Created ${personDocsCreated} Person documents`);
    }

    // Get all user IDs for assignment (join through workspace_memberships)
    const allUsersResult = await pool.query(
      `SELECT u.id, u.name FROM users u
       JOIN workspace_memberships wm ON wm.user_id = u.id
       WHERE wm.workspace_id = $1`,
      [workspaceId]
    );
    const allUsers = allUsersResult.rows;

    // Programs to seed
    const programsToSeed = [
      { prefix: 'SHIP', name: 'Ship Core', color: '#3B82F6' },
      { prefix: 'AUTH', name: 'Authentication', color: '#8B5CF6' },
      { prefix: 'API', name: 'API Platform', color: '#10B981' },
      { prefix: 'UI', name: 'Design System', color: '#F59E0B' },
      { prefix: 'INFRA', name: 'Infrastructure', color: '#EF4444' },
    ];

    const programs: Array<{ id: string; prefix: string; name: string; color: string }> = [];
    let programsCreated = 0;

    for (const prog of programsToSeed) {
      const existingProgram = await pool.query(
        `SELECT id FROM documents WHERE workspace_id = $1 AND document_type = $2 AND properties->>'prefix' = $3`,
        [workspaceId, 'program', prog.prefix]
      );

      if (existingProgram.rows[0]) {
        programs.push({ id: existingProgram.rows[0].id, ...prog });
      } else {
        const properties = { prefix: prog.prefix, color: prog.color };
        const programResult = await pool.query(
          `INSERT INTO documents (workspace_id, document_type, title, properties)
           VALUES ($1, 'program', $2, $3)
           RETURNING id`,
          [workspaceId, prog.name, JSON.stringify(properties)]
        );
        programs.push({ id: programResult.rows[0].id, ...prog });
        programsCreated++;
      }
    }

    if (programsCreated > 0) {
      console.log(`✅ Created ${programsCreated} programs`);
    } else {
      console.log('ℹ️  All programs already exist');
    }

    // Get workspace sprint start date and calculate current sprint
    const wsResult = await pool.query(
      'SELECT sprint_start_date FROM workspaces WHERE id = $1',
      [workspaceId]
    );
    const sprintStartDate = new Date(wsResult.rows[0].sprint_start_date);
    const today = new Date();
    const daysSinceStart = Math.floor((today.getTime() - sprintStartDate.getTime()) / (1000 * 60 * 60 * 24));
    const currentSprintNumber = Math.max(1, Math.floor(daysSinceStart / 14) + 1);

    // Create sprints for each program (current-3 to current+3)
    // Each sprint gets assigned an owner from the team (rotating assignment)
    const sprintsToCreate: Array<{ programId: string; number: number; ownerIdx: number }> = [];
    let ownerRotation = 0;
    for (const program of programs) {
      for (let sprintNum = currentSprintNumber - 3; sprintNum <= currentSprintNumber + 3; sprintNum++) {
        if (sprintNum > 0) {
          sprintsToCreate.push({ programId: program.id, number: sprintNum, ownerIdx: ownerRotation % allUsers.length });
          ownerRotation++;
        }
      }
    }

    const sprints: Array<{ id: string; programId: string; number: number }> = [];
    let sprintsCreated = 0;

    for (const sprint of sprintsToCreate) {
      const owner = allUsers[sprint.ownerIdx]!;

      // Check for existing sprint by sprint_number (new model)
      const existingSprint = await pool.query(
        `SELECT id FROM documents WHERE workspace_id = $1 AND document_type = 'sprint'
         AND program_id = $2 AND (properties->>'sprint_number')::int = $3`,
        [workspaceId, sprint.programId, sprint.number]
      );

      if (existingSprint.rows[0]) {
        sprints.push({
          id: existingSprint.rows[0].id,
          programId: sprint.programId,
          number: sprint.number,
        });
      } else {
        // New sprint properties: only sprint_number and owner_id
        // Dates and status are computed at runtime from sprint_number + workspace.sprint_start_date
        const sprintProperties = {
          sprint_number: sprint.number,
          owner_id: owner.id,
        };
        const sprintResult = await pool.query(
          `INSERT INTO documents (workspace_id, document_type, title, program_id, properties)
           VALUES ($1, 'sprint', $2, $3, $4)
           RETURNING id`,
          [workspaceId, `Sprint ${sprint.number}`, sprint.programId, JSON.stringify(sprintProperties)]
        );
        sprints.push({
          id: sprintResult.rows[0].id,
          programId: sprint.programId,
          number: sprint.number,
        });
        sprintsCreated++;
      }
    }

    if (sprintsCreated > 0) {
      console.log(`✅ Created ${sprintsCreated} sprints`);
    } else {
      console.log('ℹ️  All sprints already exist');
    }

    // Issues to seed with different states
    const issueTemplates = [
      { title: 'Implement user authentication flow', state: 'done' },
      { title: 'Add password reset functionality', state: 'done' },
      { title: 'Create login page UI', state: 'done' },
      { title: 'Set up OAuth integration', state: 'in_progress' },
      { title: 'Add rate limiting to API', state: 'in_progress' },
      { title: 'Implement document versioning', state: 'in_progress' },
      { title: 'Create team management endpoints', state: 'todo' },
      { title: 'Add search functionality', state: 'todo' },
      { title: 'Implement notifications system', state: 'todo' },
      { title: 'Create dashboard widgets', state: 'todo' },
      { title: 'Add export to PDF feature', state: 'backlog' },
      { title: 'Implement dark mode', state: 'backlog' },
      { title: 'Add keyboard shortcuts', state: 'backlog' },
      { title: 'Create mobile responsive layouts', state: 'backlog' },
      { title: 'Set up CI/CD pipeline', state: 'done' },
      { title: 'Configure monitoring alerts', state: 'in_progress' },
      { title: 'Add database backups', state: 'todo' },
      { title: 'Implement audit logging', state: 'in_progress' },
      { title: 'Create API documentation', state: 'todo' },
      { title: 'Add input validation', state: 'done' },
      { title: 'Fix session timeout handling', state: 'in_progress' },
      { title: 'Optimize database queries', state: 'todo' },
    ];

    let issuesCreated = 0;

    // Get existing max ticket numbers per program
    const maxTickets: Record<string, number> = {};
    for (const program of programs) {
      const maxResult = await pool.query(
        `SELECT COALESCE(MAX(ticket_number), 0) as max_ticket
         FROM documents WHERE workspace_id = $1 AND program_id = $2 AND document_type = 'issue'`,
        [workspaceId, program.id]
      );
      maxTickets[program.id] = maxResult.rows[0].max_ticket;
    }

    // Create a stable user -> program assignment (one program per user per sprint)
    // This ensures the team allocation constraint is respected in seed data
    const userProgramAssignments: Record<string, string> = {};
    allUsers.forEach((user, idx) => {
      userProgramAssignments[user.id] = programs[idx % programs.length]!.id;
    });

    for (let i = 0; i < issueTemplates.length; i++) {
      const template = issueTemplates[i]!;
      const assignee = allUsers[i % allUsers.length]!;
      // Use the user's assigned program (one program per user)
      const program = programs.find(p => p.id === userProgramAssignments[assignee.id])!;

      // Assign to appropriate sprint based on state
      let sprintId: string | null = null;
      if (template.state === 'done') {
        // Past sprint
        const pastSprint = sprints.find(
          s => s.programId === program.id && s.number === currentSprintNumber - 1
        );
        sprintId = pastSprint?.id || null;
      } else if (template.state === 'in_progress' || template.state === 'todo') {
        // Current sprint
        const currentSprint = sprints.find(
          s => s.programId === program.id && s.number === currentSprintNumber
        );
        sprintId = currentSprint?.id || null;
      }
      // backlog issues have no sprint

      // Check if issue already exists (by title + program)
      const existingIssue = await pool.query(
        `SELECT id FROM documents WHERE workspace_id = $1 AND program_id = $2 AND title = $3 AND document_type = 'issue'`,
        [workspaceId, program.id, template.title]
      );

      if (!existingIssue.rows[0]) {
        maxTickets[program.id]!++;
        const issueProperties = {
          state: template.state,
          priority: 'medium',
          source: 'internal',
          assignee_id: assignee.id,
          feedback_status: null,
          rejection_reason: null,
        };
        await pool.query(
          `INSERT INTO documents (workspace_id, document_type, title, program_id, sprint_id, properties, ticket_number)
           VALUES ($1, 'issue', $2, $3, $4, $5, $6)`,
          [workspaceId, template.title, program.id, sprintId, JSON.stringify(issueProperties), maxTickets[program.id]]
        );
        issuesCreated++;
      }
    }

    if (issuesCreated > 0) {
      console.log(`✅ Created ${issuesCreated} issues`);
    } else {
      console.log('ℹ️  All issues already exist');
    }

    // Create welcome/tutorial wiki document
    const existingTutorial = await pool.query(
      'SELECT id FROM documents WHERE workspace_id = $1 AND document_type = $2 AND title = $3',
      [workspaceId, 'wiki', WELCOME_DOCUMENT_TITLE]
    );

    if (!existingTutorial.rows[0]) {
      // Insert the tutorial document with position=0 to ensure it appears first
      await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, content, position)
         VALUES ($1, 'wiki', $2, $3, 0)`,
        [workspaceId, WELCOME_DOCUMENT_TITLE, JSON.stringify(WELCOME_DOCUMENT_CONTENT)]
      );
      console.log('✅ Created welcome tutorial document');
    } else {
      console.log('ℹ️  Welcome tutorial already exists');
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
