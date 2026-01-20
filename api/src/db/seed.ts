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

    // Create projects for each program
    const projectTemplates = [
      { name: 'Core Features', color: '#6366f1', emoji: '🚀' },
      { name: 'Bug Fixes', color: '#ef4444', emoji: '🐛' },
      { name: 'Performance', color: '#22c55e', emoji: '⚡' },
    ];

    const projects: Array<{ id: string; programId: string; title: string }> = [];
    let projectsCreated = 0;

    for (const program of programs) {
      for (const template of projectTemplates) {
        const projectTitle = `${program.name} - ${template.name}`;

        // Check if project already exists
        const existingProject = await pool.query(
          `SELECT id FROM documents WHERE workspace_id = $1 AND document_type = 'project'
           AND title = $2 AND program_id = $3`,
          [workspaceId, projectTitle, program.id]
        );

        if (existingProject.rows[0]) {
          projects.push({
            id: existingProject.rows[0].id,
            programId: program.id,
            title: projectTitle,
          });
        } else {
          const projectProperties = {
            color: template.color,
            emoji: template.emoji,
          };
          const projectResult = await pool.query(
            `INSERT INTO documents (workspace_id, document_type, title, program_id, properties)
             VALUES ($1, 'project', $2, $3, $4)
             RETURNING id`,
            [workspaceId, projectTitle, program.id, JSON.stringify(projectProperties)]
          );
          projects.push({
            id: projectResult.rows[0].id,
            programId: program.id,
            title: projectTitle,
          });
          projectsCreated++;
        }
      }
    }

    if (projectsCreated > 0) {
      console.log(`✅ Created ${projectsCreated} projects`);
    } else {
      console.log('ℹ️  All projects already exist');
    }

    // Get workspace sprint start date and calculate current sprint (1-week sprints)
    const wsResult = await pool.query(
      'SELECT sprint_start_date FROM workspaces WHERE id = $1',
      [workspaceId]
    );
    const sprintStartDate = new Date(wsResult.rows[0].sprint_start_date);
    const today = new Date();
    const daysSinceStart = Math.floor((today.getTime() - sprintStartDate.getTime()) / (1000 * 60 * 60 * 24));
    const currentSprintNumber = Math.max(1, Math.floor(daysSinceStart / 7) + 1);

    // Create sprints for each program (current-3 to current+3)
    // Each sprint gets assigned an owner from the team (rotating assignment)
    // Sprints are distributed among the program's projects
    const sprintsToCreate: Array<{ programId: string; projectId: string; number: number; ownerIdx: number }> = [];
    let ownerRotation = 0;
    for (const program of programs) {
      // Get projects for this program to distribute sprints among them
      const programProjects = projects.filter(p => p.programId === program.id);
      let projectIdx = 0;
      for (let sprintNum = currentSprintNumber - 3; sprintNum <= currentSprintNumber + 3; sprintNum++) {
        if (sprintNum > 0) {
          // Round-robin assign sprints to projects within the program
          const project = programProjects[projectIdx % programProjects.length]!;
          sprintsToCreate.push({
            programId: program.id,
            projectId: project.id,
            number: sprintNum,
            ownerIdx: ownerRotation % allUsers.length
          });
          ownerRotation++;
          projectIdx++;
        }
      }
    }

    const sprints: Array<{ id: string; programId: string; projectId: string; number: number }> = [];
    let sprintsCreated = 0;

    for (const sprint of sprintsToCreate) {
      const owner = allUsers[sprint.ownerIdx]!;

      // Check for existing sprint by sprint_number and project (new model)
      const existingSprint = await pool.query(
        `SELECT id FROM documents WHERE workspace_id = $1 AND document_type = 'sprint'
         AND project_id = $2 AND (properties->>'sprint_number')::int = $3`,
        [workspaceId, sprint.projectId, sprint.number]
      );

      if (existingSprint.rows[0]) {
        sprints.push({
          id: existingSprint.rows[0].id,
          programId: sprint.programId,
          projectId: sprint.projectId,
          number: sprint.number,
        });
      } else {
        // New sprint properties: only sprint_number and assignee_ids
        // Dates and status are computed at runtime from sprint_number + workspace.sprint_start_date
        const sprintProperties = {
          sprint_number: sprint.number,
          assignee_ids: [owner.id],
        };
        // Sprints belong to projects (project_id), and inherit program context from the project
        const sprintResult = await pool.query(
          `INSERT INTO documents (workspace_id, document_type, title, project_id, properties)
           VALUES ($1, 'sprint', $2, $3, $4)
           RETURNING id`,
          [workspaceId, `Sprint ${sprint.number}`, sprint.projectId, JSON.stringify(sprintProperties)]
        );
        sprints.push({
          id: sprintResult.rows[0].id,
          programId: sprint.programId,
          projectId: sprint.projectId,
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

    // Get Ship Core program for comprehensive sprint testing
    const shipCoreProgram = programs.find(p => p.prefix === 'SHIP')!;

    // Comprehensive issue templates for Ship Core covering all sprint/state combinations
    // This gives us realistic data to test all views
    // estimate_hours added for sprint planning features (progress graph, accountability)
    const shipCoreIssues = [
      // Sprint -3 (completed, older history): All done
      { title: 'Initial project setup', state: 'done', sprintOffset: -3, priority: 'high', estimate: 8 },
      { title: 'Database schema design', state: 'done', sprintOffset: -3, priority: 'high', estimate: 6 },
      { title: 'Set up development environment', state: 'done', sprintOffset: -3, priority: 'medium', estimate: 4 },
      { title: 'Create basic API structure', state: 'done', sprintOffset: -3, priority: 'medium', estimate: 4 },

      // Sprint -2 (completed): Mostly done, some incomplete (tests pattern alert)
      { title: 'Implement user authentication', state: 'done', sprintOffset: -2, priority: 'high', estimate: 8 },
      { title: 'Add password hashing', state: 'done', sprintOffset: -2, priority: 'high', estimate: 4 },
      { title: 'Create session management', state: 'todo', sprintOffset: -2, priority: 'medium', estimate: 6 },
      { title: 'Build login/logout endpoints', state: 'done', sprintOffset: -2, priority: 'medium', estimate: 4 },
      { title: 'Add CSRF protection', state: 'todo', sprintOffset: -2, priority: 'medium', estimate: 4 },
      { title: 'Write auth unit tests', state: 'todo', sprintOffset: -2, priority: 'low', estimate: 3 },

      // Sprint -1 (completed): Low completion (tests pattern alert - 2 consecutive)
      { title: 'Create document model', state: 'done', sprintOffset: -1, priority: 'high', estimate: 8 },
      { title: 'Implement CRUD operations', state: 'todo', sprintOffset: -1, priority: 'high', estimate: 6 },
      { title: 'Add real-time collaboration', state: 'todo', sprintOffset: -1, priority: 'high', estimate: 8 },
      { title: 'Build WebSocket server', state: 'done', sprintOffset: -1, priority: 'medium', estimate: 6 },
      { title: 'Integrate Yjs for CRDT', state: 'todo', sprintOffset: -1, priority: 'medium', estimate: 6 },
      { title: 'Add offline support', state: 'cancelled', sprintOffset: -1, priority: 'low', estimate: 4 },

      // Current sprint: Mix of done, in_progress, todo
      { title: 'Implement sprint management', state: 'done', sprintOffset: 0, priority: 'high', estimate: 8 },
      { title: 'Create sprint timeline UI', state: 'done', sprintOffset: 0, priority: 'high', estimate: 6 },
      { title: 'Add sprint progress chart', state: 'done', sprintOffset: 0, priority: 'medium', estimate: 4 },
      { title: 'Build issue assignment flow', state: 'in_progress', sprintOffset: 0, priority: 'high', estimate: 6 },
      { title: 'Add bulk issue operations', state: 'in_progress', sprintOffset: 0, priority: 'medium', estimate: 4 },
      { title: 'Create sprint retrospective view', state: 'in_progress', sprintOffset: 0, priority: 'medium', estimate: 4 },
      { title: 'Add sprint velocity metrics', state: 'todo', sprintOffset: 0, priority: 'medium', estimate: 4 },
      { title: 'Implement burndown chart', state: 'todo', sprintOffset: 0, priority: 'medium', estimate: 6 },
      { title: 'Add sprint completion notifications', state: 'todo', sprintOffset: 0, priority: 'low', estimate: 2 },

      // Sprint +1 (upcoming): Some planned todo items
      { title: 'Add team workload view', state: 'todo', sprintOffset: 1, priority: 'high', estimate: 8 },
      { title: 'Create capacity planning', state: 'todo', sprintOffset: 1, priority: 'high', estimate: 6 },
      { title: 'Build resource allocation UI', state: 'todo', sprintOffset: 1, priority: 'medium', estimate: 4 },
      { title: 'Add team availability calendar', state: 'backlog', sprintOffset: 1, priority: 'low', estimate: 3 },

      // Sprint +2 (upcoming): Fewer planned items
      { title: 'Implement reporting dashboard', state: 'todo', sprintOffset: 2, priority: 'medium', estimate: 6 },
      { title: 'Add export to PDF', state: 'backlog', sprintOffset: 2, priority: 'low', estimate: 4 },

      // Sprint +3 (upcoming): Empty - no issues assigned

      // Backlog (no sprint): Ideas for future (no estimates - tests estimate required modal)
      { title: 'Add dark mode support', state: 'backlog', sprintOffset: null, priority: 'low', estimate: null },
      { title: 'Implement keyboard shortcuts', state: 'backlog', sprintOffset: null, priority: 'low', estimate: null },
      { title: 'Create mobile app', state: 'backlog', sprintOffset: null, priority: 'low', estimate: null },
      { title: 'Add AI-powered suggestions', state: 'backlog', sprintOffset: null, priority: 'low', estimate: null },
      { title: 'Build integration with Slack', state: 'backlog', sprintOffset: null, priority: 'medium', estimate: null },
    ];

    // Generic issues for other programs (less comprehensive)
    const genericIssueTemplates = [
      { title: 'Set up project structure', state: 'done', estimate: 4 },
      { title: 'Create initial documentation', state: 'done', estimate: 3 },
      { title: 'Implement core features', state: 'in_progress', estimate: 8 },
      { title: 'Add unit tests', state: 'todo', estimate: 4 },
      { title: 'Performance optimization', state: 'backlog', estimate: 6 },
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

    // Seed Ship Core issues with comprehensive sprint coverage
    for (let i = 0; i < shipCoreIssues.length; i++) {
      const issue = shipCoreIssues[i]!;
      const assignee = allUsers[i % allUsers.length]!;

      // Find the sprint based on offset
      let sprintId: string | null = null;
      if (issue.sprintOffset !== null) {
        const targetSprintNumber = currentSprintNumber + issue.sprintOffset;
        const sprint = sprints.find(
          s => s.programId === shipCoreProgram.id && s.number === targetSprintNumber
        );
        sprintId = sprint?.id || null;
      }

      // Check if issue already exists
      const existingIssue = await pool.query(
        `SELECT id FROM documents WHERE workspace_id = $1 AND program_id = $2 AND title = $3 AND document_type = 'issue'`,
        [workspaceId, shipCoreProgram.id, issue.title]
      );

      if (!existingIssue.rows[0]) {
        maxTickets[shipCoreProgram.id]!++;
        const issueProperties: Record<string, unknown> = {
          state: issue.state,
          priority: issue.priority,
          source: 'internal',
          assignee_id: assignee.id,
          feedback_status: null,
          rejection_reason: null,
        };
        // Add estimate_hours if provided (backlog items have null to test estimate modal)
        if (issue.estimate !== null) {
          issueProperties.estimate_hours = issue.estimate;
        }
        await pool.query(
          `INSERT INTO documents (workspace_id, document_type, title, program_id, sprint_id, properties, ticket_number)
           VALUES ($1, 'issue', $2, $3, $4, $5, $6)`,
          [workspaceId, issue.title, shipCoreProgram.id, sprintId, JSON.stringify(issueProperties), maxTickets[shipCoreProgram.id]]
        );
        issuesCreated++;
      }
    }

    // Seed generic issues for other programs
    const otherPrograms = programs.filter(p => p.prefix !== 'SHIP');
    for (const program of otherPrograms) {
      for (let i = 0; i < genericIssueTemplates.length; i++) {
        const template = genericIssueTemplates[i]!;
        const assignee = allUsers[(i + otherPrograms.indexOf(program)) % allUsers.length]!;

        // Assign to appropriate sprint based on state
        let sprintId: string | null = null;
        if (template.state === 'done') {
          const pastSprint = sprints.find(
            s => s.programId === program.id && s.number === currentSprintNumber - 1
          );
          sprintId = pastSprint?.id || null;
        } else if (template.state === 'in_progress' || template.state === 'todo') {
          const currentSprint = sprints.find(
            s => s.programId === program.id && s.number === currentSprintNumber
          );
          sprintId = currentSprint?.id || null;
        }

        // Check if issue already exists
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
            estimate_hours: template.estimate,
          };
          await pool.query(
            `INSERT INTO documents (workspace_id, document_type, title, program_id, sprint_id, properties, ticket_number)
             VALUES ($1, 'issue', $2, $3, $4, $5, $6)`,
            [workspaceId, template.title, program.id, sprintId, JSON.stringify(issueProperties), maxTickets[program.id]]
          );
          issuesCreated++;
        }
      }
    }

    if (issuesCreated > 0) {
      console.log(`✅ Created ${issuesCreated} issues`);
    } else {
      console.log('ℹ️  All issues already exist');
    }

    // Sync sprint_id column to junction table (document_associations)
    // The junction table is the canonical source for associations; this ensures
    // newly seeded issues have their sprint relationships in both places
    const sprintAssocResult = await pool.query(`
      INSERT INTO document_associations (document_id, related_id, relationship_type, metadata)
      SELECT
        id AS document_id,
        sprint_id AS related_id,
        'sprint'::relationship_type AS relationship_type,
        jsonb_build_object('migrated_from', 'seed_sprint_id', 'migrated_at', NOW())
      FROM documents
      WHERE sprint_id IS NOT NULL
        AND workspace_id = $1
        AND document_type = 'issue'
      ON CONFLICT (document_id, related_id, relationship_type) DO NOTHING
    `, [workspaceId]);
    if (sprintAssocResult.rowCount && sprintAssocResult.rowCount > 0) {
      console.log(`✅ Created ${sprintAssocResult.rowCount} sprint associations in junction table`);
    }

    // Sync project associations to junction table (document_associations)
    // Issues inherit project association from their sprint's project
    const projectAssocResult = await pool.query(`
      INSERT INTO document_associations (document_id, related_id, relationship_type, metadata)
      SELECT
        issue.id AS document_id,
        sprint.project_id AS related_id,
        'project'::relationship_type AS relationship_type,
        jsonb_build_object('migrated_from', 'seed_sprint_project', 'migrated_at', NOW())
      FROM documents issue
      JOIN documents sprint ON sprint.id = issue.sprint_id AND sprint.document_type = 'sprint'
      WHERE issue.sprint_id IS NOT NULL
        AND sprint.project_id IS NOT NULL
        AND issue.workspace_id = $1
        AND issue.document_type = 'issue'
      ON CONFLICT (document_id, related_id, relationship_type) DO NOTHING
    `, [workspaceId]);
    if (projectAssocResult.rowCount && projectAssocResult.rowCount > 0) {
      console.log(`✅ Created ${projectAssocResult.rowCount} project associations in junction table`);
    }

    // Create welcome/tutorial wiki document
    const existingTutorial = await pool.query(
      'SELECT id FROM documents WHERE workspace_id = $1 AND document_type = $2 AND title = $3',
      [workspaceId, 'wiki', WELCOME_DOCUMENT_TITLE]
    );

    let tutorialDocId: string;
    if (!existingTutorial.rows[0]) {
      // Insert the tutorial document with position=0 to ensure it appears first
      const tutorialResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, content, position)
         VALUES ($1, 'wiki', $2, $3, 0)
         RETURNING id`,
        [workspaceId, WELCOME_DOCUMENT_TITLE, JSON.stringify(WELCOME_DOCUMENT_CONTENT)]
      );
      tutorialDocId = tutorialResult.rows[0].id;
      console.log('✅ Created welcome tutorial document');
    } else {
      tutorialDocId = existingTutorial.rows[0].id;
      console.log('ℹ️  Welcome tutorial already exists');
    }

    // Create nested wiki documents for tree navigation testing (Section 508 accessibility)
    const nestedDocs = [
      { title: 'Getting Started', parentId: tutorialDocId },
      { title: 'Advanced Topics', parentId: tutorialDocId },
    ];

    let nestedDocsCreated = 0;
    for (const doc of nestedDocs) {
      const existingDoc = await pool.query(
        'SELECT id FROM documents WHERE workspace_id = $1 AND document_type = $2 AND title = $3 AND parent_id = $4',
        [workspaceId, 'wiki', doc.title, doc.parentId]
      );

      if (!existingDoc.rows[0]) {
        await pool.query(
          `INSERT INTO documents (workspace_id, document_type, title, parent_id)
           VALUES ($1, 'wiki', $2, $3)`,
          [workspaceId, doc.title, doc.parentId]
        );
        nestedDocsCreated++;
      }
    }

    if (nestedDocsCreated > 0) {
      console.log(`✅ Created ${nestedDocsCreated} nested wiki documents`);
    }

    // Create additional standalone wiki documents for e2e testing
    // These ensure tests that require multiple documents don't skip
    const standaloneWikiDocs = [
      { title: 'Project Overview', content: 'Overview of the Ship project and its goals.' },
      { title: 'Architecture Guide', content: 'Technical architecture and design decisions.' },
      { title: 'API Reference', content: 'API endpoints and usage documentation.' },
      { title: 'Development Setup', content: 'How to set up your local development environment.' },
    ];

    let standaloneDocsCreated = 0;
    for (let i = 0; i < standaloneWikiDocs.length; i++) {
      const doc = standaloneWikiDocs[i]!;
      const existingDoc = await pool.query(
        'SELECT id FROM documents WHERE workspace_id = $1 AND document_type = $2 AND title = $3 AND parent_id IS NULL',
        [workspaceId, 'wiki', doc.title]
      );

      if (!existingDoc.rows[0]) {
        const contentJson = {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: doc.content }] }]
        };
        await pool.query(
          `INSERT INTO documents (workspace_id, document_type, title, content, position)
           VALUES ($1, 'wiki', $2, $3, $4)`,
          [workspaceId, doc.title, JSON.stringify(contentJson), i + 1]
        );
        standaloneDocsCreated++;
      }
    }

    if (standaloneDocsCreated > 0) {
      console.log(`✅ Created ${standaloneDocsCreated} standalone wiki documents`);
    }

    // Create sample standups for Ship Core sprints (tests the standup feed feature)
    const shipCoreSprints = sprints.filter(s => s.programId === shipCoreProgram.id);
    let standupsCreated = 0;

    // Add standups to current and recent sprints
    for (const sprint of shipCoreSprints) {
      if (sprint.number >= currentSprintNumber - 1 && sprint.number <= currentSprintNumber) {
        // Check if standups already exist for this sprint
        const existingStandups = await pool.query(
          `SELECT id FROM documents WHERE workspace_id = $1 AND document_type = 'standup' AND sprint_id = $2`,
          [workspaceId, sprint.id]
        );

        if (existingStandups.rows.length === 0) {
          // Create 2-3 standups per sprint from different team members
          const standupAuthors = allUsers.slice(0, 3);
          const standupMessages = [
            {
              content: {
                type: 'doc',
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: 'Yesterday: Finished implementing the sprint timeline UI component.' }] },
                  { type: 'paragraph', content: [{ type: 'text', text: 'Today: Working on the progress chart integration.' }] },
                  { type: 'paragraph', content: [{ type: 'text', text: 'Blockers: None' }] },
                ],
              },
            },
            {
              content: {
                type: 'doc',
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: 'Yesterday: Code review and bug fixes.' }] },
                  { type: 'paragraph', content: [{ type: 'text', text: 'Today: Starting on issue assignment flow.' }] },
                  { type: 'paragraph', content: [{ type: 'text', text: 'Blockers: Waiting on API spec clarification.' }] },
                ],
              },
            },
            {
              content: {
                type: 'doc',
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: 'Yesterday: Team sync and planning session.' }] },
                  { type: 'paragraph', content: [{ type: 'text', text: 'Today: Documentation and testing.' }] },
                  { type: 'paragraph', content: [{ type: 'text', text: 'Blockers: None' }] },
                ],
              },
            },
          ];

          for (let i = 0; i < standupAuthors.length; i++) {
            const author = standupAuthors[i]!;
            const message = standupMessages[i]!;
            const daysAgo = i; // Stagger the standups over recent days
            const properties = { author_id: author.id };

            await pool.query(
              `INSERT INTO documents (workspace_id, document_type, title, parent_id, content, created_by, properties, created_at)
               VALUES ($1, 'standup', $2, $3, $4, $5, $6, NOW() - INTERVAL '${daysAgo} days')`,
              [workspaceId, `Standup - ${author.name}`, sprint.id, JSON.stringify(message.content), author.id, JSON.stringify(properties)]
            );
            standupsCreated++;
          }
        }
      }
    }

    if (standupsCreated > 0) {
      console.log(`✅ Created ${standupsCreated} standups`);
    } else {
      console.log('ℹ️  All standups already exist');
    }

    // Create sample sprint reviews for completed sprints
    let sprintReviewsCreated = 0;

    for (const sprint of shipCoreSprints) {
      // Only add reviews to completed sprints (before current)
      if (sprint.number < currentSprintNumber && sprint.number >= currentSprintNumber - 2) {
        const existingReview = await pool.query(
          `SELECT id FROM documents WHERE workspace_id = $1 AND document_type = 'sprint_review' AND sprint_id = $2`,
          [workspaceId, sprint.id]
        );

        if (!existingReview.rows[0]) {
          const reviewContent = {
            type: 'doc',
            content: [
              { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'What went well' }] },
              { type: 'bulletList', content: [
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Team collaboration was excellent' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Met most of our sprint goals' }] }] },
              ]},
              { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'What could be improved' }] },
              { type: 'bulletList', content: [
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Better estimation on complex tasks' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'More frequent check-ins' }] }] },
              ]},
            ],
          };

          const owner = allUsers[sprint.number % allUsers.length]!;
          await pool.query(
            `INSERT INTO documents (workspace_id, document_type, title, sprint_id, content, created_by)
             VALUES ($1, 'sprint_review', $2, $3, $4, $5)`,
            [workspaceId, `Sprint ${sprint.number} Review`, sprint.id, JSON.stringify(reviewContent), owner.id]
          );
          sprintReviewsCreated++;
        }
      }
    }

    if (sprintReviewsCreated > 0) {
      console.log(`✅ Created ${sprintReviewsCreated} sprint reviews`);
    } else {
      console.log('ℹ️  All sprint reviews already exist');
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
