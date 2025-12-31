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
        'SELECT id FROM documents WHERE workspace_id = $1 AND document_type = $2 AND prefix = $3',
        [workspaceId, 'program', prog.prefix]
      );

      if (existingProgram.rows[0]) {
        programs.push({ id: existingProgram.rows[0].id, ...prog });
      } else {
        const programResult = await pool.query(
          `INSERT INTO documents (workspace_id, document_type, title, prefix, color)
           VALUES ($1, 'program', $2, $3, $4)
           RETURNING id`,
          [workspaceId, prog.name, prog.prefix, prog.color]
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
    const sprintsToCreate: Array<{ programId: string; number: number }> = [];
    for (const program of programs) {
      for (let sprintNum = currentSprintNumber - 3; sprintNum <= currentSprintNumber + 3; sprintNum++) {
        if (sprintNum > 0) {
          sprintsToCreate.push({ programId: program.id, number: sprintNum });
        }
      }
    }

    const sprints: Array<{ id: string; programId: string; number: number; startDate: string; endDate: string }> = [];
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
         AND program_id = $2 AND start_date = $3`,
        [workspaceId, sprint.programId, startStr]
      );

      if (existingSprint.rows[0]) {
        sprints.push({
          id: existingSprint.rows[0].id,
          programId: sprint.programId,
          number: sprint.number,
          startDate: startStr,
          endDate: endStr,
        });
      } else {
        const sprintResult = await pool.query(
          `INSERT INTO documents (workspace_id, document_type, title, program_id, start_date, end_date)
           VALUES ($1, 'sprint', $2, $3, $4, $5)
           RETURNING id`,
          [workspaceId, `Sprint ${sprint.number}`, sprint.programId, startStr, endStr]
        );
        sprints.push({
          id: sprintResult.rows[0].id,
          programId: sprint.programId,
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

    for (let i = 0; i < issueTemplates.length; i++) {
      const template = issueTemplates[i]!;
      const program = programs[i % programs.length]!;
      const assignee = allUsers[i % allUsers.length]!;

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
        await pool.query(
          `INSERT INTO documents (workspace_id, document_type, title, program_id, sprint_id, assignee_id, state, ticket_number)
           VALUES ($1, 'issue', $2, $3, $4, $5, $6, $7)`,
          [workspaceId, template.title, program.id, sprintId, assignee.id, template.state, maxTickets[program.id]]
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
    const tutorialTitle = 'Welcome to Ship';
    const existingTutorial = await pool.query(
      'SELECT id FROM documents WHERE workspace_id = $1 AND document_type = $2 AND title = $3',
      [workspaceId, 'wiki', tutorialTitle]
    );

    if (!existingTutorial.rows[0]) {
      const tutorialContent = {
        type: 'doc',
        content: [
          // Introduction
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Ship helps your team track work, plan sprints, and write documentation—all in one place. Jump to the section that matches your role:' },
            ],
          },
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [{
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'bold' }], text: 'For Developers' },
                    { type: 'text', text: ' — Track issues, manage sprints, update status' },
                  ],
                }],
              },
              {
                type: 'listItem',
                content: [{
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'bold' }], text: 'For Program Managers' },
                    { type: 'text', text: ' — Write specs, organize programs, plan sprints' },
                  ],
                }],
              },
              {
                type: 'listItem',
                content: [{
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'bold' }], text: 'For Executives' },
                    { type: 'text', text: ' — See delivery progress, team workload, and accountability' },
                  ],
                }],
              },
            ],
          },

          // ============ FOR DEVELOPERS ============
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'For Developers' }],
          },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Ship works like Linear: you have issues, sprints, and a board view. Here\'s how to get productive fast.' },
            ],
          },

          // Creating an Issue
          {
            type: 'heading',
            attrs: { level: 3 },
            content: [{ type: 'text', text: 'Creating an Issue' }],
          },
          {
            type: 'orderedList',
            content: [
              {
                type: 'listItem',
                content: [{
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'Click the ' },
                    { type: 'text', marks: [{ type: 'bold' }], text: 'checkbox icon' },
                    { type: 'text', text: ' in the left sidebar to open Issues mode' },
                  ],
                }],
              },
              {
                type: 'listItem',
                content: [{
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'Click the ' },
                    { type: 'text', marks: [{ type: 'bold' }], text: '+ button' },
                    { type: 'text', text: ' in the sidebar header to create a new issue' },
                  ],
                }],
              },
              {
                type: 'listItem',
                content: [{
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'Type a title (e.g., "Add user authentication")' },
                  ],
                }],
              },
              {
                type: 'listItem',
                content: [{
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'In the ' },
                    { type: 'text', marks: [{ type: 'bold' }], text: 'Properties sidebar' },
                    { type: 'text', text: ' (right side), set the Program, Assignee, and Status' },
                  ],
                }],
              },
            ],
          },
          {
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'italic' }], text: '[Screenshot: Issue creation with properties sidebar]' },
            ],
          },

          // Moving Issues Through Status
          {
            type: 'heading',
            attrs: { level: 3 },
            content: [{ type: 'text', text: 'Moving Issues Through Status' }],
          },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Issues flow through four statuses:' },
            ],
          },
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [{
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'bold' }], text: 'Backlog' },
                    { type: 'text', text: ' — Ideas and future work, not yet prioritized' },
                  ],
                }],
              },
              {
                type: 'listItem',
                content: [{
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'bold' }], text: 'Todo' },
                    { type: 'text', text: ' — Prioritized and ready to pick up' },
                  ],
                }],
              },
              {
                type: 'listItem',
                content: [{
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'bold' }], text: 'In Progress' },
                    { type: 'text', text: ' — Someone is actively working on this' },
                  ],
                }],
              },
              {
                type: 'listItem',
                content: [{
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'bold' }], text: 'Done' },
                    { type: 'text', text: ' — Work is complete' },
                  ],
                }],
              },
            ],
          },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'To change status: Open an issue → In the Properties sidebar → Click the ' },
              { type: 'text', marks: [{ type: 'bold' }], text: 'Status dropdown' },
              { type: 'text', text: ' → Select the new status.' },
            ],
          },

          // Sprint Board vs List View
          {
            type: 'heading',
            attrs: { level: 3 },
            content: [{ type: 'text', text: 'Sprint Board vs List View' }],
          },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Ship offers two ways to view your sprint:' },
            ],
          },
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [{
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'bold' }], text: 'Board view' },
                    { type: 'text', text: ' — Kanban-style columns (Backlog | Todo | In Progress | Done). Drag issues between columns to change status.' },
                  ],
                }],
              },
              {
                type: 'listItem',
                content: [{
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'bold' }], text: 'List view' },
                    { type: 'text', text: ' — All issues in a sortable list. Good for triage and bulk status updates.' },
                  ],
                }],
              },
            ],
          },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Toggle between views using the view switcher in the sprint header.' },
            ],
          },
          {
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'italic' }], text: '[Screenshot: Board view with columns]' },
            ],
          },

          // Daily Workflow
          {
            type: 'heading',
            attrs: { level: 3 },
            content: [{ type: 'text', text: 'Daily Workflow' }],
          },
          {
            type: 'orderedList',
            content: [
              {
                type: 'listItem',
                content: [{
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'bold' }], text: 'Start of day:' },
                    { type: 'text', text: ' Go to your current sprint → Check what\'s assigned to you in "Todo"' },
                  ],
                }],
              },
              {
                type: 'listItem',
                content: [{
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'bold' }], text: 'Starting work:' },
                    { type: 'text', text: ' Move your issue to "In Progress" so the team knows' },
                  ],
                }],
              },
              {
                type: 'listItem',
                content: [{
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'bold' }], text: 'Finished:' },
                    { type: 'text', text: ' Move to "Done" and pick up the next Todo item' },
                  ],
                }],
              },
              {
                type: 'listItem',
                content: [{
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'bold' }], text: 'Blocked:' },
                    { type: 'text', text: ' Add a comment to the issue describing what\'s blocking you' },
                  ],
                }],
              },
            ],
          },

          // ============ FOR PROGRAM MANAGERS ============
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'For Program Managers' }],
          },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Ship combines Notion-style docs with Linear-style issues. Write your specs in the same place you track delivery.' },
            ],
          },

          // Writing a PRD
          {
            type: 'heading',
            attrs: { level: 3 },
            content: [{ type: 'text', text: 'Writing a PRD or Spec' }],
          },
          {
            type: 'orderedList',
            content: [
              {
                type: 'listItem',
                content: [{
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'Click the ' },
                    { type: 'text', marks: [{ type: 'bold' }], text: 'document icon' },
                    { type: 'text', text: ' in the left sidebar to open Docs mode' },
                  ],
                }],
              },
              {
                type: 'listItem',
                content: [{
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'Click ' },
                    { type: 'text', marks: [{ type: 'bold' }], text: '+ New Document' },
                    { type: 'text', text: ' in the sidebar' },
                  ],
                }],
              },
              {
                type: 'listItem',
                content: [{
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'Give it a title like "Feature: User Authentication PRD"' },
                  ],
                }],
              },
              {
                type: 'listItem',
                content: [{
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'Use the editor to write your spec. Recommended sections:' },
                  ],
                }],
              },
            ],
          },
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [{
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'bold' }], text: 'Problem' },
                    { type: 'text', text: ' — What problem are we solving?' },
                  ],
                }],
              },
              {
                type: 'listItem',
                content: [{
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'bold' }], text: 'Goals' },
                    { type: 'text', text: ' — What does success look like?' },
                  ],
                }],
              },
              {
                type: 'listItem',
                content: [{
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'bold' }], text: 'Requirements' },
                    { type: 'text', text: ' — What must the solution do?' },
                  ],
                }],
              },
              {
                type: 'listItem',
                content: [{
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'bold' }], text: 'Success Metrics' },
                    { type: 'text', text: ' — How will we measure success?' },
                  ],
                }],
              },
              {
                type: 'listItem',
                content: [{
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'bold' }], text: 'Timeline' },
                    { type: 'text', text: ' — When do we need this by?' },
                  ],
                }],
              },
            ],
          },
          {
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'italic' }], text: '[Screenshot: PRD document with sections]' },
            ],
          },

          // Organizing Programs
          {
            type: 'heading',
            attrs: { level: 3 },
            content: [{ type: 'text', text: 'Organizing Programs and Issues' }],
          },
          {
            type: 'orderedList',
            content: [
              {
                type: 'listItem',
                content: [{
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'Click the ' },
                    { type: 'text', marks: [{ type: 'bold' }], text: 'folder icon' },
                    { type: 'text', text: ' in the left sidebar to open Programs mode' },
                  ],
                }],
              },
              {
                type: 'listItem',
                content: [{
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'Each program has a ' },
                    { type: 'text', marks: [{ type: 'bold' }], text: 'prefix' },
                    { type: 'text', text: ' (e.g., AUTH, API) that appears on all its issues' },
                  ],
                }],
              },
              {
                type: 'listItem',
                content: [{
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'Click a program to see its issues, sprints, and backlog' },
                  ],
                }],
              },
              {
                type: 'listItem',
                content: [{
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'Create issues from within the program to auto-assign them' },
                  ],
                }],
              },
            ],
          },

          // Sprint Planning
          {
            type: 'heading',
            attrs: { level: 3 },
            content: [{ type: 'text', text: 'Setting Up a Sprint' }],
          },
          {
            type: 'orderedList',
            content: [
              {
                type: 'listItem',
                content: [{
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'Open a program → Click the ' },
                    { type: 'text', marks: [{ type: 'bold' }], text: 'Sprints tab' },
                  ],
                }],
              },
              {
                type: 'listItem',
                content: [{
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'Click ' },
                    { type: 'text', marks: [{ type: 'bold' }], text: '+ New Sprint' },
                    { type: 'text', text: ' and set start/end dates (typically 2 weeks)' },
                  ],
                }],
              },
              {
                type: 'listItem',
                content: [{
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'Drag issues from the backlog into the sprint, or set the Sprint property on individual issues' },
                  ],
                }],
              },
            ],
          },

          // Sprint Documentation
          {
            type: 'heading',
            attrs: { level: 3 },
            content: [{ type: 'text', text: 'Sprint Plan and Retro Documents' }],
          },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Ship encourages documenting what you expect ' },
              { type: 'text', marks: [{ type: 'italic' }], text: 'before' },
              { type: 'text', text: ' a sprint and what you learned ' },
              { type: 'text', marks: [{ type: 'italic' }], text: 'after' },
              { type: 'text', text: ':' },
            ],
          },
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [{
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'bold' }], text: 'Sprint Plan' },
                    { type: 'text', text: ' (write at sprint start): What do you expect to accomplish? What\'s the hypothesis?' },
                  ],
                }],
              },
              {
                type: 'listItem',
                content: [{
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'bold' }], text: 'Sprint Retro' },
                    { type: 'text', text: ' (write at sprint end): What actually happened? What did you learn? What will you do differently?' },
                  ],
                }],
              },
            ],
          },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'This creates a learning loop: ' },
              { type: 'text', marks: [{ type: 'bold' }], text: 'plan → execute → reflect → improve' },
              { type: 'text', text: '.' },
            ],
          },

          // ============ FOR EXECUTIVES ============
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'For Executives' }],
          },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Ship gives you visibility into what your teams are delivering and who\'s doing what.' },
            ],
          },

          // Delivery Tracking
          {
            type: 'heading',
            attrs: { level: 3 },
            content: [{ type: 'text', text: 'Are We On Track?' }],
          },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'The ' },
              { type: 'text', marks: [{ type: 'bold' }], text: 'Dashboard' },
              { type: 'text', text: ' shows delivery status across your organization:' },
            ],
          },
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [{
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'bold' }], text: 'Sprint completion rate' },
                    { type: 'text', text: ' — Are teams finishing what they committed to?' },
                  ],
                }],
              },
              {
                type: 'listItem',
                content: [{
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'bold' }], text: 'Velocity trends' },
                    { type: 'text', text: ' — Is delivery speeding up or slowing down?' },
                  ],
                }],
              },
              {
                type: 'listItem',
                content: [{
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'bold' }], text: 'Blockers' },
                    { type: 'text', text: ' — What\'s stuck and needs escalation?' },
                  ],
                }],
              },
              {
                type: 'listItem',
                content: [{
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'bold' }], text: 'Overdue items' },
                    { type: 'text', text: ' — What slipped past its deadline?' },
                  ],
                }],
              },
            ],
          },
          {
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'italic' }], text: '[Screenshot: Executive dashboard with metrics]' },
            ],
          },

          // Organization Views
          {
            type: 'heading',
            attrs: { level: 3 },
            content: [{ type: 'text', text: 'View by Program or Team' }],
          },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Slice your organization\'s work in two ways:' },
            ],
          },
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [{
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'bold' }], text: 'By Program' },
                    { type: 'text', text: ' — See progress on major initiatives across multiple teams' },
                  ],
                }],
              },
              {
                type: 'listItem',
                content: [{
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'bold' }], text: 'By Team' },
                    { type: 'text', text: ' — See what each team is working on and their capacity' },
                  ],
                }],
              },
            ],
          },

          // Staff Accountability
          {
            type: 'heading',
            attrs: { level: 3 },
            content: [{ type: 'text', text: 'Staff Activity and Accountability' }],
          },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'The ' },
              { type: 'text', marks: [{ type: 'bold' }], text: 'Teams view' },
              { type: 'text', text: ' (click the people icon in the sidebar) shows:' },
            ],
          },
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [{
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'bold' }], text: 'What each person is working on' },
                    { type: 'text', text: ' — Their assigned issues and current status' },
                  ],
                }],
              },
              {
                type: 'listItem',
                content: [{
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'bold' }], text: 'Recent activity' },
                    { type: 'text', text: ' — Issues completed, comments added, documents edited' },
                  ],
                }],
              },
              {
                type: 'listItem',
                content: [{
                  type: 'paragraph',
                  content: [
                    { type: 'text', marks: [{ type: 'bold' }], text: 'Workload distribution' },
                    { type: 'text', text: ' — Who\'s overloaded, who has capacity' },
                  ],
                }],
              },
            ],
          },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'This gives you clear visibility into who is contributing what—essential for large organizations where accountability matters.' },
            ],
          },
          {
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'italic' }], text: '[Screenshot: Team member activity view]' },
            ],
          },

          // What Shipped Recently
          {
            type: 'heading',
            attrs: { level: 3 },
            content: [{ type: 'text', text: 'What Shipped Recently?' }],
          },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'The activity feed shows recently completed work across all teams. Filter by:' },
            ],
          },
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [{
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Time period (this week, this month, this quarter)' }],
                }],
              },
              {
                type: 'listItem',
                content: [{
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Program' }],
                }],
              },
              {
                type: 'listItem',
                content: [{
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Team or individual' }],
                }],
              },
            ],
          },

          // ============ GET STARTED ============
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'Get Started Now' }],
          },
          {
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'Developers:' },
              { type: 'text', text: ' Click the checkbox icon → Find an issue → Move it to "In Progress"' },
            ],
          },
          {
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'Program Managers:' },
              { type: 'text', text: ' Click the document icon → Create a new spec → Share it with your team' },
            ],
          },
          {
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'Executives:' },
              { type: 'text', text: ' Click the people icon → See your team\'s current workload' },
            ],
          },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Questions? Add a comment to this document—Ship supports real-time collaboration, so your team can see and respond immediately.' },
            ],
          },
        ],
      };

      // Insert the tutorial document with position=0 to ensure it appears first
      await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, content, position)
         VALUES ($1, 'wiki', $2, $3, 0)`,
        [workspaceId, tutorialTitle, JSON.stringify(tutorialContent)]
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
