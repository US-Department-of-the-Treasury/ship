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

    // Get all user IDs for assignment
    const allUsersResult = await pool.query(
      'SELECT id, name FROM users WHERE workspace_id = $1',
      [workspaceId]
    );
    const allUsers = allUsersResult.rows;

    // Projects to seed
    const projectsToSeed = [
      { prefix: 'SHIP', name: 'Ship Core', color: '#3B82F6' },
      { prefix: 'AUTH', name: 'Authentication', color: '#8B5CF6' },
      { prefix: 'API', name: 'API Platform', color: '#10B981' },
      { prefix: 'UI', name: 'Design System', color: '#F59E0B' },
      { prefix: 'INFRA', name: 'Infrastructure', color: '#EF4444' },
    ];

    const projects: Array<{ id: string; prefix: string; name: string; color: string }> = [];
    let projectsCreated = 0;

    for (const proj of projectsToSeed) {
      const existingProject = await pool.query(
        'SELECT id FROM documents WHERE workspace_id = $1 AND document_type = $2 AND prefix = $3',
        [workspaceId, 'project', proj.prefix]
      );

      if (existingProject.rows[0]) {
        projects.push({ id: existingProject.rows[0].id, ...proj });
      } else {
        const projectResult = await pool.query(
          `INSERT INTO documents (workspace_id, document_type, title, prefix, color)
           VALUES ($1, 'project', $2, $3, $4)
           RETURNING id`,
          [workspaceId, proj.name, proj.prefix, proj.color]
        );
        projects.push({ id: projectResult.rows[0].id, ...proj });
        projectsCreated++;
      }
    }

    if (projectsCreated > 0) {
      console.log(`✅ Created ${projectsCreated} projects`);
    } else {
      console.log('ℹ️  All projects already exist');
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

    // Create sprints for each project (current-3 to current+3)
    const sprintsToCreate: Array<{ projectId: string; number: number }> = [];
    for (const project of projects) {
      for (let sprintNum = currentSprintNumber - 3; sprintNum <= currentSprintNumber + 3; sprintNum++) {
        if (sprintNum > 0) {
          sprintsToCreate.push({ projectId: project.id, number: sprintNum });
        }
      }
    }

    const sprints: Array<{ id: string; projectId: string; number: number; startDate: string; endDate: string }> = [];
    let sprintsCreated = 0;

    for (const sprint of sprintsToCreate) {
      const sprintStart = new Date(sprintStartDate);
      sprintStart.setDate(sprintStart.getDate() + (sprint.number - 1) * 14);
      const sprintEnd = new Date(sprintStart);
      sprintEnd.setDate(sprintEnd.getDate() + 13);

      const startStr = sprintStart.toISOString().split('T')[0]!;
      const endStr = sprintEnd.toISOString().split('T')[0]!;

      const existingSprint = await pool.query(
        `SELECT id FROM documents WHERE workspace_id = $1 AND document_type = 'sprint'
         AND project_id = $2 AND start_date = $3`,
        [workspaceId, sprint.projectId, startStr]
      );

      if (existingSprint.rows[0]) {
        sprints.push({
          id: existingSprint.rows[0].id,
          projectId: sprint.projectId,
          number: sprint.number,
          startDate: startStr,
          endDate: endStr,
        });
      } else {
        const sprintResult = await pool.query(
          `INSERT INTO documents (workspace_id, document_type, title, project_id, start_date, end_date)
           VALUES ($1, 'sprint', $2, $3, $4, $5)
           RETURNING id`,
          [workspaceId, `Sprint ${sprint.number}`, sprint.projectId, startStr, endStr]
        );
        sprints.push({
          id: sprintResult.rows[0].id,
          projectId: sprint.projectId,
          number: sprint.number,
          startDate: startStr,
          endDate: endStr,
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

    // Get existing max ticket numbers per project
    const maxTickets: Record<string, number> = {};
    for (const project of projects) {
      const maxResult = await pool.query(
        `SELECT COALESCE(MAX(ticket_number), 0) as max_ticket
         FROM documents WHERE workspace_id = $1 AND project_id = $2 AND document_type = 'issue'`,
        [workspaceId, project.id]
      );
      maxTickets[project.id] = maxResult.rows[0].max_ticket;
    }

    for (let i = 0; i < issueTemplates.length; i++) {
      const template = issueTemplates[i]!;
      const project = projects[i % projects.length]!;
      const assignee = allUsers[i % allUsers.length]!;

      // Assign to appropriate sprint based on state
      let sprintId: string | null = null;
      if (template.state === 'done') {
        // Past sprint
        const pastSprint = sprints.find(
          s => s.projectId === project.id && s.number === currentSprintNumber - 1
        );
        sprintId = pastSprint?.id || null;
      } else if (template.state === 'in_progress' || template.state === 'todo') {
        // Current sprint
        const currentSprint = sprints.find(
          s => s.projectId === project.id && s.number === currentSprintNumber
        );
        sprintId = currentSprint?.id || null;
      }
      // backlog issues have no sprint

      // Check if issue already exists (by title + project)
      const existingIssue = await pool.query(
        `SELECT id FROM documents WHERE workspace_id = $1 AND project_id = $2 AND title = $3 AND document_type = 'issue'`,
        [workspaceId, project.id, template.title]
      );

      if (!existingIssue.rows[0]) {
        maxTickets[project.id]!++;
        await pool.query(
          `INSERT INTO documents (workspace_id, document_type, title, project_id, sprint_id, assignee_id, state, ticket_number)
           VALUES ($1, 'issue', $2, $3, $4, $5, $6, $7)`,
          [workspaceId, template.title, project.id, sprintId, assignee.id, template.state, maxTickets[project.id]]
        );
        issuesCreated++;
      }
    }

    if (issuesCreated > 0) {
      console.log(`✅ Created ${issuesCreated} issues`);
    } else {
      console.log('ℹ️  All issues already exist');
    }

    // Wiki documents to seed
    const wikiDocuments = [
      { title: 'Getting Started', children: [
        { title: 'Quick Start Guide' },
        { title: 'Installation' },
        { title: 'Configuration' },
      ]},
      { title: 'Architecture', children: [
        { title: 'System Overview' },
        { title: 'Database Schema' },
        { title: 'API Design' },
      ]},
      { title: 'Development Guide', children: [
        { title: 'Local Setup' },
        { title: 'Testing Strategy' },
        { title: 'Code Style' },
        { title: 'Git Workflow' },
      ]},
      { title: 'Deployment', children: [
        { title: 'AWS Infrastructure' },
        { title: 'CI/CD Pipeline' },
        { title: 'Monitoring & Alerts' },
      ]},
      { title: 'Team Processes', children: [
        { title: 'Sprint Planning' },
        { title: 'Code Review Guidelines' },
        { title: 'On-Call Runbook' },
      ]},
    ];

    let docsCreated = 0;
    const devUser = allUsers.find(u => u.name === 'Dev User');

    for (const doc of wikiDocuments) {
      // Check if parent doc exists
      const existingDoc = await pool.query(
        `SELECT id FROM documents WHERE workspace_id = $1 AND document_type = 'wiki' AND title = $2 AND parent_id IS NULL`,
        [workspaceId, doc.title]
      );

      let parentId: string;
      if (existingDoc.rows[0]) {
        parentId = existingDoc.rows[0].id;
      } else {
        const parentResult = await pool.query(
          `INSERT INTO documents (workspace_id, document_type, title, created_by)
           VALUES ($1, 'wiki', $2, $3)
           RETURNING id`,
          [workspaceId, doc.title, devUser?.id]
        );
        parentId = parentResult.rows[0].id;
        docsCreated++;
      }

      // Create children
      if (doc.children) {
        for (const child of doc.children) {
          const existingChild = await pool.query(
            `SELECT id FROM documents WHERE workspace_id = $1 AND document_type = 'wiki' AND title = $2 AND parent_id = $3`,
            [workspaceId, child.title, parentId]
          );

          if (!existingChild.rows[0]) {
            await pool.query(
              `INSERT INTO documents (workspace_id, document_type, title, parent_id, created_by)
               VALUES ($1, 'wiki', $2, $3, $4)`,
              [workspaceId, child.title, parentId, devUser?.id]
            );
            docsCreated++;
          }
        }
      }
    }

    if (docsCreated > 0) {
      console.log(`✅ Created ${docsCreated} wiki documents`);
    } else {
      console.log('ℹ️  All wiki documents already exist');
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
