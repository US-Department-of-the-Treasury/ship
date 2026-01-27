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

/**
 * Helper to create document associations in the junction table
 * This replaces the legacy program_id, project_id, sprint_id columns
 */
async function createAssociation(
  pool: pg.Pool,
  documentId: string,
  relatedId: string,
  relationshipType: 'program' | 'project' | 'sprint',
  metadata?: Record<string, unknown>
): Promise<void> {
  await pool.query(
    `INSERT INTO document_associations (document_id, related_id, relationship_type, metadata)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (document_id, related_id, relationship_type) DO NOTHING`,
    [documentId, relatedId, relationshipType, JSON.stringify(metadata || { created_via: 'seed' })]
  );
}

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
        'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
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
        'SELECT id, role FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
        [workspaceId, user.id]
      );

      // Determine expected role
      const expectedRole = user.email === 'dev@ship.local' ? 'admin' : 'member';

      if (!existingMembership.rows[0]) {
        // Create new membership
        await pool.query(
          `INSERT INTO workspace_memberships (workspace_id, user_id, role)
           VALUES ($1, $2, $3)`,
          [workspaceId, user.id, expectedRole]
        );
        membershipsCreated++;
      } else if (existingMembership.rows[0].role !== expectedRole && user.email === 'dev@ship.local') {
        // Update dev user to admin if they're not already
        await pool.query(
          `UPDATE workspace_memberships SET role = $1 WHERE workspace_id = $2 AND user_id = $3`,
          [expectedRole, workspaceId, user.id]
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
    // Each project has ICE scores (Impact, Confidence, Ease) for prioritization (1-5 scale)
    const projectTemplates = [
      {
        name: 'Core Features',
        color: '#6366f1',
        emoji: '🚀',
        impact: 5,
        confidence: 4,
        ease: 3,
        hypothesis: 'Building core features will establish the product foundation and attract early adopters.',
        monetary_impact_expected: 50000,
      },
      {
        name: 'Bug Fixes',
        color: '#ef4444',
        emoji: '🐛',
        impact: 4,
        confidence: 5,
        ease: 4,
        hypothesis: 'Fixing bugs will improve user retention and reduce support costs.',
        monetary_impact_expected: 15000,
      },
      {
        name: 'Performance',
        color: '#22c55e',
        emoji: '⚡',
        impact: 4,
        confidence: 3,
        ease: 2,
        hypothesis: 'Performance improvements will increase user satisfaction and enable scale.',
        monetary_impact_expected: 25000,
      },
    ];

    const projects: Array<{ id: string; programId: string; title: string }> = [];
    let projectsCreated = 0;

    for (const program of programs) {
      for (const template of projectTemplates) {
        const projectTitle = `${program.name} - ${template.name}`;

        // Check if project already exists (via junction table association to program)
        const existingProject = await pool.query(
          `SELECT d.id FROM documents d
           JOIN document_associations da ON da.document_id = d.id
             AND da.related_id = $3 AND da.relationship_type = 'program'
           WHERE d.workspace_id = $1 AND d.document_type = 'project' AND d.title = $2`,
          [workspaceId, projectTitle, program.id]
        );

        if (existingProject.rows[0]) {
          projects.push({
            id: existingProject.rows[0].id,
            programId: program.id,
            title: projectTitle,
          });
        } else {
          // Assign owner rotating through team members
          const ownerIdx = (programs.indexOf(program) * projectTemplates.length + projectTemplates.indexOf(template)) % allUsers.length;
          const owner = allUsers[ownerIdx]!;

          // Calculate target date (2-4 weeks from now based on project type)
          const targetDate = new Date();
          targetDate.setDate(targetDate.getDate() + (projectTemplates.indexOf(template) + 2) * 7);

          const projectProperties = {
            color: template.color,
            emoji: template.emoji,
            owner_id: owner.id,
            // ICE scores (1-5 scale)
            impact: template.impact,
            confidence: template.confidence,
            ease: template.ease,
            hypothesis: template.hypothesis,
            monetary_impact_expected: template.monetary_impact_expected,
            target_date: targetDate.toISOString().split('T')[0],
          };
          // Create project document without legacy program_id column
          const projectResult = await pool.query(
            `INSERT INTO documents (workspace_id, document_type, title, properties)
             VALUES ($1, 'project', $2, $3)
             RETURNING id`,
            [workspaceId, projectTitle, JSON.stringify(projectProperties)]
          );
          const projectId = projectResult.rows[0].id;

          // Create association to program via junction table
          await createAssociation(pool, projectId, program.id, 'program');

          projects.push({
            id: projectId,
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

    // Create stable person-to-program assignments
    // People generally stay on the same program, with occasional switches
    // This creates more realistic team structures
    const personProgramAssignments: Record<string, string[]> = {};
    const programIds = programs.map(p => p.id);

    for (let i = 0; i < allUsers.length; i++) {
      const user = allUsers[i]!;
      // Primary program assignment (most people stay on one program)
      const primaryProgramIdx = i % programs.length;
      const primaryProgram = programIds[primaryProgramIdx]!;

      // 30% of people work on a secondary program occasionally
      const hasSecondaryProgram = i % 3 === 0;
      const secondaryProgramIdx = (primaryProgramIdx + 1) % programs.length;
      const secondaryProgram = programIds[secondaryProgramIdx]!;

      personProgramAssignments[user.id] = hasSecondaryProgram
        ? [primaryProgram, secondaryProgram]
        : [primaryProgram];
    }

    // Create sprints for each program (current-6 to current+10 for better historical data)
    // Each sprint gets assigned people who belong to that program
    // Sprints are distributed among the program's projects
    interface SprintToCreate {
      programId: string;
      projectId: string;
      number: number;
      assigneeIds: string[];
    }
    const sprintsToCreate: SprintToCreate[] = [];

    for (const program of programs) {
      // Get projects for this program to distribute sprints among them
      const programProjects = projects.filter(p => p.programId === program.id);

      // Get people assigned to this program
      const programPeople = allUsers.filter(u =>
        personProgramAssignments[u.id]?.includes(program.id)
      );

      let projectIdx = 0;
      for (let sprintNum = currentSprintNumber - 6; sprintNum <= currentSprintNumber + 10; sprintNum++) {
        if (sprintNum > 0) {
          // Round-robin assign sprints to projects within the program
          const project = programProjects[projectIdx % programProjects.length]!;

          // Assign 2-4 people to each sprint from those in this program
          // People tend to stay on the same project within a program
          const numAssignees = 2 + (sprintNum % 3); // 2-4 people
          const sprintAssignees: string[] = [];

          for (let i = 0; i < Math.min(numAssignees, programPeople.length); i++) {
            // Rotate through program people, but with some consistency
            // (same person tends to be on consecutive sprints)
            const personIdx = (projectIdx + i) % programPeople.length;
            const person = programPeople[personIdx];
            if (person && !sprintAssignees.includes(person.id)) {
              sprintAssignees.push(person.id);
            }
          }

          sprintsToCreate.push({
            programId: program.id,
            projectId: project.id,
            number: sprintNum,
            assigneeIds: sprintAssignees,
          });
          projectIdx++;
        }
      }
    }

    const sprints: Array<{ id: string; programId: string; projectId: string; number: number }> = [];
    let sprintsCreated = 0;

    for (const sprint of sprintsToCreate) {
      // Pick an owner from the assignees
      const owner = allUsers.find(u => sprint.assigneeIds.includes(u.id)) || allUsers[0]!;

      // Check for existing sprint by sprint_number and project (via junction table)
      const existingSprint = await pool.query(
        `SELECT d.id FROM documents d
         JOIN document_associations da ON da.document_id = d.id
           AND da.related_id = $2 AND da.relationship_type = 'project'
         WHERE d.workspace_id = $1 AND d.document_type = 'sprint'
           AND (d.properties->>'sprint_number')::int = $3`,
        [workspaceId, sprint.projectId, sprint.number]
      );

      if (existingSprint.rows[0]) {
        // Existing sprint - ALWAYS update to ensure correct state
        const existingId = existingSprint.rows[0].id;

        // Get current properties
        const currentDoc = await pool.query(
          `SELECT properties, content FROM documents WHERE id = $1`,
          [existingId]
        );
        const currentProps = currentDoc.rows[0]?.properties || {};

        // Calculate what properties should be for this sprint
        const sprintOffset = sprint.number - currentSprintNumber;
        const thisSprintStart = new Date(sprintStartDate);
        thisSprintStart.setDate(thisSprintStart.getDate() + (sprint.number - 1) * 7);

        const sprintHypotheses = [
          'If we complete these features, we will unblock the next milestone.',
          'Fixing these issues will reduce user-reported problems by 50%.',
          'Performance gains will improve user engagement metrics.',
          'New features will increase user activation rate.',
          'These changes will enable the team to move faster.',
          'Better docs will reduce onboarding time for new developers.',
          'Incremental shipping will maintain momentum and user trust.',
        ];

        // Determine state, hypothesis, and approval based on offset
        let expectedState: 'completed' | 'in_progress' | 'planning' = 'planning';
        let hasHypothesis = false;
        let hypothesisApproval: { state: string; approved_by?: string; approved_at?: string } | null = null;
        let reviewApproval: { state: string; approved_by?: string; approved_at?: string } | null = null;
        let hasReview = false;

        if (sprintOffset < -1) {
          // Past sprints: completed with approved hypotheses and reviews
          expectedState = 'completed';
          hasHypothesis = sprint.number % 5 !== 0;
          hasReview = sprint.number % 7 !== 0;
          if (hasHypothesis) {
            // Some have changed_since_approved to test the warning UI
            if (sprint.number % 8 === 0) {
              hypothesisApproval = { state: 'changed_since_approved', approved_by: owner.id, approved_at: thisSprintStart.toISOString() };
            } else {
              hypothesisApproval = { state: 'approved', approved_by: owner.id, approved_at: thisSprintStart.toISOString() };
            }
          }
          if (hasReview) {
            reviewApproval = { state: 'approved', approved_by: owner.id, approved_at: new Date(thisSprintStart.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString() };
          }
        } else if (sprintOffset === -1) {
          // Just completed sprint
          expectedState = 'completed';
          hasHypothesis = true;
          hasReview = sprint.number % 3 !== 0;
          // Some have hypothesis that changed since approval (to test manager warning)
          if (sprint.number % 4 === 0) {
            hypothesisApproval = { state: 'changed_since_approved', approved_by: owner.id, approved_at: thisSprintStart.toISOString() };
          } else {
            hypothesisApproval = { state: 'approved', approved_by: owner.id, approved_at: thisSprintStart.toISOString() };
          }
          if (hasReview) {
            reviewApproval = { state: 'pending' };
          }
        } else if (sprintOffset === 0) {
          const variant = sprint.number % 4;
          expectedState = variant === 3 ? 'planning' : 'in_progress';
          hasHypothesis = variant < 2;
          if (hasHypothesis) {
            // One variant has changed_since_approved for current sprint
            if (variant === 0 && sprint.number % 3 === 0) {
              hypothesisApproval = { state: 'changed_since_approved', approved_by: owner.id, approved_at: thisSprintStart.toISOString() };
            } else if (variant === 0) {
              hypothesisApproval = { state: 'approved', approved_by: owner.id, approved_at: thisSprintStart.toISOString() };
            } else {
              hypothesisApproval = { state: 'pending' };
            }
          }
        } else if (sprintOffset === 1) {
          hasHypothesis = sprint.number % 5 < 2;
          if (hasHypothesis) {
            hypothesisApproval = { state: 'pending' };
          }
        } else if (sprintOffset <= 3) {
          hasHypothesis = sprint.number % 5 === 0;
          if (hasHypothesis) {
            hypothesisApproval = { state: 'pending' };
          }
        }

        // Build updated properties
        const updatedProps: Record<string, unknown> = {
          ...currentProps,
          state: expectedState,
        };

        if (hasHypothesis) {
          updatedProps.hypothesis = sprintHypotheses[sprint.number % sprintHypotheses.length];
        }

        if (expectedState === 'in_progress' || expectedState === 'completed') {
          updatedProps.started_at = thisSprintStart.toISOString();
        }

        if (hypothesisApproval) {
          updatedProps.hypothesis_approval = hypothesisApproval;
        }

        if (reviewApproval) {
          updatedProps.review_approval = reviewApproval;
        }

        // Build content with hypothesisBlock if needed
        const updatedContent = hasHypothesis ? {
          type: 'doc',
          content: [
            {
              type: 'hypothesisBlock',
              attrs: { placeholder: 'What will get done this sprint?' },
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: updatedProps.hypothesis as string }],
                },
              ],
            },
            { type: 'paragraph', content: [] },
          ],
        } : { type: 'doc', content: [{ type: 'paragraph', content: [] }] };

        await pool.query(
          `UPDATE documents SET properties = $1, content = $2 WHERE id = $3`,
          [JSON.stringify(updatedProps), JSON.stringify(updatedContent), existingId]
        );
        sprintsCreated++;

        sprints.push({
          id: existingId,
          programId: sprint.programId,
          projectId: sprint.projectId,
          number: sprint.number,
        });
      } else {
        // Sprint properties with full planning details
        // Dates and status are computed at runtime from sprint_number + workspace.sprint_start_date
        // Confidence is 0-100 scale (different from project ICE scores which are 1-10)
        const sprintHypotheses = [
          'If we complete these features, we will unblock the next milestone.',
          'Fixing these issues will reduce user-reported problems by 50%.',
          'Performance gains will improve user engagement metrics.',
          'New features will increase user activation rate.',
          'These changes will enable the team to move faster.',
          'Better docs will reduce onboarding time for new developers.',
          'Incremental shipping will maintain momentum and user trust.',
        ];
        const sprintSuccessCriteria = [
          'All planned stories marked done, tests passing',
          'Bug count reduced by at least 10, no P0 issues remaining',
          'Load time under 2 seconds, memory usage stable',
          'Feature flags enabled for 100% of users',
          'All integrations passing health checks',
          'README and API docs up to date',
          'User feedback incorporated in next sprint planning',
        ];

        // Calculate sprint offset from current
        const sprintOffset = sprint.number - currentSprintNumber;

        // Determine sprint state and hypothesis/review presence based on timing
        // This creates realistic data for testing the accountability grid
        let state: 'completed' | 'in_progress' | 'planning' = 'planning';
        let started_at: string | null = null;
        let hasHypothesis = false;
        let hasReview = false;
        let hypothesisApproval: { state: string; approved_by?: string; approved_at?: string } | null = null;
        let reviewApproval: { state: string; approved_by?: string; approved_at?: string } | null = null;

        // Calculate sprint start date for this sprint
        const thisSprintStart = new Date(sprintStartDate);
        thisSprintStart.setDate(thisSprintStart.getDate() + (sprint.number - 1) * 7);

        if (sprintOffset < -1) {
          // Past sprints (more than 1 sprint ago): mostly completed with hypothesis + review
          state = 'completed';
          started_at = thisSprintStart.toISOString();

          // 80% of past sprints have hypothesis, 20% missing for testing
          hasHypothesis = sprint.number % 5 !== 0; // Every 5th sprint missing hypothesis
          // 85% of past sprints have review, 15% missing for testing
          hasReview = sprint.number % 7 !== 0; // Every 7th sprint missing review

          // If they have hypothesis/review, most are approved
          if (hasHypothesis) {
            // 90% approved, 10% pending
            hypothesisApproval = sprint.number % 10 === 0
              ? { state: 'pending' }
              : { state: 'approved', approved_by: owner.id, approved_at: thisSprintStart.toISOString() };
          }
          if (hasReview) {
            // 85% approved, 15% pending
            reviewApproval = sprint.number % 7 === 1
              ? { state: 'pending' }
              : { state: 'approved', approved_by: owner.id, approved_at: new Date(thisSprintStart.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString() };
          }
        } else if (sprintOffset === -1) {
          // Just completed sprint: should have hypothesis, review may be missing
          state = 'completed';
          started_at = thisSprintStart.toISOString();
          hasHypothesis = true;
          // 60% have review (some people are behind)
          hasReview = sprint.number % 3 !== 0;
          hypothesisApproval = { state: 'approved', approved_by: owner.id, approved_at: thisSprintStart.toISOString() };
          if (hasReview) {
            reviewApproval = { state: 'pending' }; // Recently submitted, not yet approved
          }
        } else if (sprintOffset === 0) {
          // Current sprint: mix of states for testing
          // Use sprint number to create variety across programs
          const currentSprintVariant = sprint.number % 4;
          if (currentSprintVariant === 0) {
            // Started with hypothesis and approved
            state = 'in_progress';
            started_at = thisSprintStart.toISOString();
            hasHypothesis = true;
            hypothesisApproval = { state: 'approved', approved_by: owner.id, approved_at: thisSprintStart.toISOString() };
          } else if (currentSprintVariant === 1) {
            // Started with hypothesis pending approval
            state = 'in_progress';
            started_at = thisSprintStart.toISOString();
            hasHypothesis = true;
            hypothesisApproval = { state: 'pending' };
          } else if (currentSprintVariant === 2) {
            // Started but no hypothesis (should show warning/error)
            state = 'in_progress';
            started_at = thisSprintStart.toISOString();
            hasHypothesis = false;
          } else {
            // Not yet started (should show "not started" indicator)
            state = 'planning';
            hasHypothesis = false;
          }
        } else if (sprintOffset === 1) {
          // Next sprint: some proactive teams have hypothesis already
          state = 'planning';
          // 40% have hypothesis written early
          hasHypothesis = sprint.number % 5 < 2;
          if (hasHypothesis) {
            hypothesisApproval = { state: 'pending' };
          }
        } else if (sprintOffset <= 3) {
          // Near future (2-3 sprints out): occasional early planning
          state = 'planning';
          // 20% have hypothesis
          hasHypothesis = sprint.number % 5 === 0;
          if (hasHypothesis) {
            hypothesisApproval = { state: 'pending' };
          }
        } else {
          // Far future: no hypothesis yet (normal)
          state = 'planning';
          hasHypothesis = false;
        }

        // Calculate confidence based on sprint timing
        let baseConfidence = 80;
        if (sprintOffset < 0) baseConfidence = 95; // Past sprints - high confidence (actual results)
        else if (sprintOffset === 0) baseConfidence = 75; // Current sprint - medium-high
        else if (sprintOffset === 1) baseConfidence = 60; // Next sprint - medium
        else baseConfidence = 40; // Future sprints - lower confidence

        const sprintProperties: Record<string, unknown> = {
          sprint_number: sprint.number,
          owner_id: owner.id,
          assignee_ids: sprint.assigneeIds,
          state: state,
          success_criteria: sprintSuccessCriteria[sprint.number % sprintSuccessCriteria.length],
          confidence: baseConfidence + (Math.random() * 10 - 5), // Add some variance
        };

        // Add started_at if sprint was started
        if (started_at) {
          sprintProperties.started_at = started_at;
        }

        // Add hypothesis if present
        if (hasHypothesis) {
          sprintProperties.hypothesis = sprintHypotheses[sprint.number % sprintHypotheses.length];
        }

        // Add approval states
        if (hypothesisApproval) {
          sprintProperties.hypothesis_approval = hypothesisApproval;
        }
        if (reviewApproval) {
          sprintProperties.review_approval = reviewApproval;
        }

        // Build document content - include hypothesisBlock if sprint has hypothesis
        // This is important because the editor syncs hypothesis from content to properties
        // If we only set properties.hypothesis but not content, it gets overwritten to null
        const hypothesisText = hasHypothesis
          ? sprintHypotheses[sprint.number % sprintHypotheses.length]
          : null;

        const sprintContent: Record<string, unknown> = {
          type: 'doc',
          content: hasHypothesis ? [
            {
              type: 'hypothesisBlock',
              attrs: { placeholder: 'What will get done this sprint?' },
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: hypothesisText }],
                },
              ],
            },
            {
              type: 'paragraph',
              content: [],
            },
          ] : [
            {
              type: 'paragraph',
              content: [],
            },
          ],
        };

        // Create sprint document without legacy project_id and program_id columns
        const sprintResult = await pool.query(
          `INSERT INTO documents (workspace_id, document_type, title, properties, content)
           VALUES ($1, 'sprint', $2, $3, $4)
           RETURNING id`,
          [workspaceId, `Sprint ${sprint.number}`, JSON.stringify(sprintProperties), JSON.stringify(sprintContent)]
        );
        const sprintId = sprintResult.rows[0].id;

        // Create associations via junction table (sprint belongs to project AND program)
        await createAssociation(pool, sprintId, sprint.projectId, 'project');
        await createAssociation(pool, sprintId, sprint.programId, 'program');

        sprints.push({
          id: sprintId,
          programId: sprint.programId,
          projectId: sprint.projectId,
          number: sprint.number,
        });
        sprintsCreated++;
      }
    }

    if (sprintsCreated > 0) {
      console.log(`✅ Created/updated ${sprintsCreated} sprints`);
    } else {
      console.log('ℹ️  All sprints already exist and up to date');
    }

    // Get Ship Core program for comprehensive sprint testing
    const shipCoreProgram = programs.find(p => p.prefix === 'SHIP')!;

    // Comprehensive issue templates for Ship Core covering all sprint/state combinations
    // This gives us realistic data to test all views
    // estimate added for sprint planning features (progress graph, accountability)
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

      // Backlog (no sprint): Ideas for future
      { title: 'Add dark mode support', state: 'backlog', sprintOffset: null, priority: 'low', estimate: 4 },
      { title: 'Implement keyboard shortcuts', state: 'backlog', sprintOffset: null, priority: 'low', estimate: 3 },
      { title: 'Create mobile app', state: 'backlog', sprintOffset: null, priority: 'low', estimate: 40 },
      { title: 'Add AI-powered suggestions', state: 'backlog', sprintOffset: null, priority: 'low', estimate: 16 },
      { title: 'Build integration with Slack', state: 'backlog', sprintOffset: null, priority: 'medium', estimate: 8 },
    ];

    // Generic issues for other programs - expanded for better testing
    const genericIssueTemplates = [
      // Completed issues (past sprints)
      { title: 'Set up project structure', state: 'done', estimate: 4, sprintOffset: -2, priority: 'high' },
      { title: 'Create initial documentation', state: 'done', estimate: 3, sprintOffset: -2, priority: 'medium' },
      { title: 'Define coding standards', state: 'done', estimate: 2, sprintOffset: -2, priority: 'low' },
      { title: 'Configure CI/CD pipeline', state: 'done', estimate: 6, sprintOffset: -1, priority: 'high' },
      { title: 'Set up staging environment', state: 'done', estimate: 4, sprintOffset: -1, priority: 'medium' },
      // Current sprint - mix of states
      { title: 'Implement core features', state: 'done', estimate: 8, sprintOffset: 0, priority: 'high' },
      { title: 'Add input validation', state: 'done', estimate: 4, sprintOffset: 0, priority: 'high' },
      { title: 'Create error handling', state: 'in_progress', estimate: 5, sprintOffset: 0, priority: 'high' },
      { title: 'Build user interface', state: 'in_progress', estimate: 6, sprintOffset: 0, priority: 'medium' },
      { title: 'Add unit tests', state: 'todo', estimate: 4, sprintOffset: 0, priority: 'medium' },
      { title: 'Write integration tests', state: 'todo', estimate: 5, sprintOffset: 0, priority: 'low' },
      // Upcoming sprint
      { title: 'Performance optimization', state: 'todo', estimate: 6, sprintOffset: 1, priority: 'medium' },
      { title: 'Add caching layer', state: 'todo', estimate: 4, sprintOffset: 1, priority: 'medium' },
      { title: 'Security audit fixes', state: 'todo', estimate: 8, sprintOffset: 1, priority: 'high' },
      // Backlog
      { title: 'Implement analytics', state: 'backlog', estimate: 6, sprintOffset: null, priority: 'low' },
      { title: 'Add export functionality', state: 'backlog', estimate: 4, sprintOffset: null, priority: 'low' },
      { title: 'Create admin dashboard', state: 'backlog', estimate: 10, sprintOffset: null, priority: 'medium' },
    ];

    let issuesCreated = 0;

    // Get existing max ticket numbers per program (via junction table)
    const maxTickets: Record<string, number> = {};
    for (const program of programs) {
      const maxResult = await pool.query(
        `SELECT COALESCE(MAX(d.ticket_number), 0) as max_ticket
         FROM documents d
         JOIN document_associations da ON da.document_id = d.id
           AND da.related_id = $2 AND da.relationship_type = 'program'
         WHERE d.workspace_id = $1 AND d.document_type = 'issue'`,
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

      // Check if issue already exists (via junction table association to program)
      const existingIssue = await pool.query(
        `SELECT d.id FROM documents d
         JOIN document_associations da ON da.document_id = d.id
           AND da.related_id = $2 AND da.relationship_type = 'program'
         WHERE d.workspace_id = $1 AND d.title = $3 AND d.document_type = 'issue'`,
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
        // Add estimate if provided
        if (issue.estimate !== null) {
          issueProperties.estimate = issue.estimate;
        }
        // Create issue document without legacy program_id and sprint_id columns
        const issueResult = await pool.query(
          `INSERT INTO documents (workspace_id, document_type, title, properties, ticket_number)
           VALUES ($1, 'issue', $2, $3, $4)
           RETURNING id`,
          [workspaceId, issue.title, JSON.stringify(issueProperties), maxTickets[shipCoreProgram.id]]
        );
        const issueId = issueResult.rows[0].id;

        // Create associations via junction table
        await createAssociation(pool, issueId, shipCoreProgram.id, 'program');
        if (sprintId) {
          await createAssociation(pool, issueId, sprintId, 'sprint');
          // Also associate with the project that the sprint belongs to
          const sprintData = sprints.find(s => s.id === sprintId);
          if (sprintData?.projectId) {
            await createAssociation(pool, issueId, sprintData.projectId, 'project');
          }
        } else {
          // For backlog issues without sprints, assign to a random project in the program
          const programProjects = projects.filter(p => p.programId === shipCoreProgram.id);
          if (programProjects.length > 0) {
            const randomProject = programProjects[issuesCreated % programProjects.length]!;
            await createAssociation(pool, issueId, randomProject.id, 'project');
          }
        }

        issuesCreated++;
      }
    }

    // Seed generic issues for other programs
    const otherPrograms = programs.filter(p => p.prefix !== 'SHIP');
    for (const program of otherPrograms) {
      for (let i = 0; i < genericIssueTemplates.length; i++) {
        const template = genericIssueTemplates[i]!;
        const assignee = allUsers[(i + otherPrograms.indexOf(program)) % allUsers.length]!;

        // Find the sprint based on offset (same pattern as Ship Core issues)
        let sprintId: string | null = null;
        if (template.sprintOffset !== null) {
          const targetSprintNumber = currentSprintNumber + template.sprintOffset;
          const sprint = sprints.find(
            s => s.programId === program.id && s.number === targetSprintNumber
          );
          sprintId = sprint?.id || null;
        }

        // Check if issue already exists (via junction table association to program)
        const existingIssue = await pool.query(
          `SELECT d.id FROM documents d
           JOIN document_associations da ON da.document_id = d.id
             AND da.related_id = $2 AND da.relationship_type = 'program'
           WHERE d.workspace_id = $1 AND d.title = $3 AND d.document_type = 'issue'`,
          [workspaceId, program.id, template.title]
        );

        if (!existingIssue.rows[0]) {
          maxTickets[program.id]!++;
          const issueProperties = {
            state: template.state,
            priority: template.priority,
            source: 'internal',
            assignee_id: assignee.id,
            feedback_status: null,
            rejection_reason: null,
            estimate: template.estimate,
          };
          // Create issue document without legacy program_id and sprint_id columns
          const issueResult = await pool.query(
            `INSERT INTO documents (workspace_id, document_type, title, properties, ticket_number)
             VALUES ($1, 'issue', $2, $3, $4)
             RETURNING id`,
            [workspaceId, template.title, JSON.stringify(issueProperties), maxTickets[program.id]]
          );
          const issueId = issueResult.rows[0].id;

          // Create associations via junction table
          await createAssociation(pool, issueId, program.id, 'program');
          if (sprintId) {
            await createAssociation(pool, issueId, sprintId, 'sprint');
            // Also associate with the project that the sprint belongs to
            const sprintData = sprints.find(s => s.id === sprintId);
            if (sprintData?.projectId) {
              await createAssociation(pool, issueId, sprintData.projectId, 'project');
            }
          } else {
            // For backlog issues without sprints, assign to a random project in the program
            const programProjects = projects.filter(p => p.programId === program.id);
            if (programProjects.length > 0) {
              const randomProject = programProjects[issuesCreated % programProjects.length]!;
              await createAssociation(pool, issueId, randomProject.id, 'project');
            }
          }

          issuesCreated++;
        }
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

    // Create sample standups for current and recent sprints across all programs
    // Standups are realistic: people on a sprint post standups during that sprint
    let standupsCreated = 0;

    const standupMessages = [
      { yesterday: 'Finished implementing the sprint timeline UI component.', today: 'Working on the progress chart integration.', blockers: 'None' },
      { yesterday: 'Code review and bug fixes.', today: 'Starting on issue assignment flow.', blockers: 'Waiting on API spec clarification.' },
      { yesterday: 'Team sync and planning session.', today: 'Documentation and testing.', blockers: 'None' },
      { yesterday: 'Completed authentication flow.', today: 'Working on error handling.', blockers: 'Need design review.' },
      { yesterday: 'Fixed critical bug in data sync.', today: 'Adding unit tests.', blockers: 'None' },
      { yesterday: 'Set up monitoring dashboard.', today: 'Investigating performance issue.', blockers: 'Waiting on prod access.' },
      { yesterday: 'Reviewed PRs and merged features.', today: 'Starting new feature work.', blockers: 'None' },
    ];

    // Add standups to current and recent sprints (across all programs)
    for (const sprint of sprints) {
      if (sprint.number >= currentSprintNumber - 1 && sprint.number <= currentSprintNumber) {
        // Check if standups already exist for this sprint (via junction table)
        const existingStandups = await pool.query(
          `SELECT d.id FROM documents d
           JOIN document_associations da ON da.document_id = d.id
             AND da.related_id = $2 AND da.relationship_type = 'sprint'
           WHERE d.workspace_id = $1 AND d.document_type = 'standup'`,
          [workspaceId, sprint.id]
        );

        if (existingStandups.rows.length === 0) {
          // Get sprint properties to find assignees
          const sprintDoc = await pool.query(
            `SELECT properties FROM documents WHERE id = $1`,
            [sprint.id]
          );
          const sprintProps = sprintDoc.rows[0]?.properties || {};
          const assigneeIds = sprintProps.assignee_ids || [];

          // Create standups from people assigned to this sprint
          // Not everyone posts every day (realistic)
          const numStandups = Math.min(assigneeIds.length, 2 + (sprint.number % 2)); // 2-3 standups

          for (let i = 0; i < numStandups; i++) {
            const authorId = assigneeIds[i];
            if (!authorId) continue;

            const author = allUsers.find(u => u.id === authorId);
            if (!author) continue;

            const messageTemplate = standupMessages[(sprint.number + i) % standupMessages.length]!;
            const content = {
              type: 'doc',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: `Yesterday: ${messageTemplate.yesterday}` }] },
                { type: 'paragraph', content: [{ type: 'text', text: `Today: ${messageTemplate.today}` }] },
                { type: 'paragraph', content: [{ type: 'text', text: `Blockers: ${messageTemplate.blockers}` }] },
              ],
            };

            const daysAgo = i; // Stagger the standups over recent days
            const properties = { author_id: author.id };

            // Create standup document
            const standupResult = await pool.query(
              `INSERT INTO documents (workspace_id, document_type, title, content, created_by, properties, created_at)
               VALUES ($1, 'standup', $2, $3, $4, $5, NOW() - INTERVAL '${daysAgo} days')
               RETURNING id`,
              [workspaceId, `Standup - ${author.name}`, JSON.stringify(content), author.id, JSON.stringify(properties)]
            );
            const standupId = standupResult.rows[0].id;

            // Create association to sprint via junction table
            await createAssociation(pool, standupId, sprint.id, 'sprint');

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

    // Create sample sprint reviews for completed sprints across ALL programs
    // Reviews are created based on realistic patterns:
    // - Past sprints (>1 ago): ~85% have reviews
    // - Just completed (-1): ~60% have reviews
    // - Current and future: no reviews yet
    let sprintReviewsCreated = 0;

    for (const sprint of sprints) {
      const sprintOffset = sprint.number - currentSprintNumber;

      // Determine if this sprint should have a review based on timing
      let shouldHaveReview = false;
      if (sprintOffset < -1) {
        // Past sprints: 85% have review (every 7th missing)
        shouldHaveReview = sprint.number % 7 !== 0;
      } else if (sprintOffset === -1) {
        // Just completed: 60% have review
        shouldHaveReview = sprint.number % 3 !== 0;
      }

      if (shouldHaveReview) {
        // Check if review exists (via junction table)
        const existingReview = await pool.query(
          `SELECT d.id FROM documents d
           JOIN document_associations da ON da.document_id = d.id
             AND da.related_id = $2 AND da.relationship_type = 'sprint'
           WHERE d.workspace_id = $1 AND d.document_type = 'sprint_review'`,
          [workspaceId, sprint.id]
        );

        if (!existingReview.rows[0]) {
          // Variety of review content based on sprint number
          const reviewVariants = [
            {
              wentWell: ['Team collaboration was excellent', 'Met most of our sprint goals', 'Good code review coverage'],
              toImprove: ['Better estimation on complex tasks', 'More frequent check-ins'],
            },
            {
              wentWell: ['Shipped all planned features', 'Zero production incidents', 'Great testing coverage'],
              toImprove: ['Documentation could be more thorough', 'Need more pair programming'],
            },
            {
              wentWell: ['Successfully integrated new API', 'Performance improvements measurable', 'Strong stakeholder communication'],
              toImprove: ['Technical debt accumulating', 'Need dedicated refactoring time'],
            },
            {
              wentWell: ['User feedback incorporated quickly', 'Team morale is high', 'Good velocity this sprint'],
              toImprove: ['Some scope creep occurred', 'Need clearer acceptance criteria upfront'],
            },
          ];

          const variant = reviewVariants[sprint.number % reviewVariants.length]!;

          const reviewContent = {
            type: 'doc',
            content: [
              { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'What went well' }] },
              { type: 'bulletList', content: variant.wentWell.map(item => ({
                type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: item }] }]
              }))},
              { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'What could be improved' }] },
              { type: 'bulletList', content: variant.toImprove.map(item => ({
                type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: item }] }]
              }))},
            ],
          };

          const owner = allUsers[sprint.number % allUsers.length]!;
          // Create sprint review document
          const reviewResult = await pool.query(
            `INSERT INTO documents (workspace_id, document_type, title, content, created_by)
             VALUES ($1, 'sprint_review', $2, $3, $4)
             RETURNING id`,
            [workspaceId, `Sprint ${sprint.number} Review`, JSON.stringify(reviewContent), owner.id]
          );
          const reviewId = reviewResult.rows[0].id;

          // Create association to sprint via junction table
          await createAssociation(pool, reviewId, sprint.id, 'sprint');

          // Update sprint to set has_review flag
          await pool.query(
            `UPDATE documents SET properties = properties || '{"has_review": true}'::jsonb WHERE id = $1`,
            [sprint.id]
          );

          sprintReviewsCreated++;
        } else {
          // Review exists - ensure sprint has has_review flag
          await pool.query(
            `UPDATE documents SET properties = properties || '{"has_review": true}'::jsonb WHERE id = $1`,
            [sprint.id]
          );
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
