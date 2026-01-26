/**
 * Accountability Check Service
 *
 * Detects missing accountability items for a user:
 * 1. Missing standups for active sprints
 * 2. Sprints at/past start without hypothesis
 * 3. Sprints at/past start date not 'started'
 * 4. Sprints at/past start with no issues
 * 5. Completed sprints without review (>1 business day)
 * 6. Projects where user is owner without hypothesis
 * 7. Completed projects without retro
 *
 * Creates action_items issues just-in-time when missing is detected.
 */

import { pool } from '../db/client.js';
import { addBusinessDays, isBusinessDay } from '../utils/business-days.js';
import type { AccountabilityType } from '@ship/shared';

// Accountability item returned from check
export interface MissingAccountabilityItem {
  type: AccountabilityType;
  targetId: string;
  targetTitle: string;
  targetType: 'sprint' | 'project';
  dueDate: string | null;
  message: string;
}

// Created accountability issue
export interface AccountabilityIssue {
  id: string;
  title: string;
  ticketNumber: number;
  type: AccountabilityType;
  targetId: string;
  dueDate: string | null;
}

/**
 * Check for missing accountability items for a user in a workspace.
 * Returns list of items that need attention.
 */
export async function checkMissingAccountability(
  userId: string,
  workspaceId: string
): Promise<MissingAccountabilityItem[]> {
  const items: MissingAccountabilityItem[] = [];

  // Get workspace sprint_start_date to calculate sprint dates
  const workspaceResult = await pool.query(
    `SELECT sprint_start_date FROM workspaces WHERE id = $1`,
    [workspaceId]
  );

  if (workspaceResult.rows.length === 0) {
    return items;
  }

  const rawStartDate = workspaceResult.rows[0].sprint_start_date;
  const sprintDuration = 7;

  // Parse workspace start date
  let workspaceStartDate: Date;
  if (rawStartDate instanceof Date) {
    workspaceStartDate = new Date(Date.UTC(rawStartDate.getFullYear(), rawStartDate.getMonth(), rawStartDate.getDate()));
  } else if (typeof rawStartDate === 'string') {
    workspaceStartDate = new Date(rawStartDate + 'T00:00:00Z');
  } else {
    workspaceStartDate = new Date();
  }

  // Calculate today and current sprint
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];
  const daysSinceStart = Math.floor((today.getTime() - workspaceStartDate.getTime()) / (1000 * 60 * 60 * 24));
  const currentSprintNumber = Math.floor(daysSinceStart / sprintDuration) + 1;

  // 1. Check for missing standups
  if (todayStr) {
    const standupItems = await checkMissingStandups(userId, workspaceId, currentSprintNumber, todayStr);
    items.push(...standupItems);
  }

  // 2-4. Check sprint accountability (hypothesis, started, issues)
  const sprintItems = await checkSprintAccountability(userId, workspaceId, workspaceStartDate, sprintDuration, today);
  items.push(...sprintItems);

  // 5. Check for completed sprints without review
  if (todayStr) {
    const reviewItems = await checkMissingSprintReviews(userId, workspaceId, workspaceStartDate, sprintDuration, today, todayStr);
    items.push(...reviewItems);
  }

  // 6. Check for projects without hypothesis
  const projectHypothesisItems = await checkProjectHypothesis(userId, workspaceId);
  items.push(...projectHypothesisItems);

  // 7. Check for completed projects without retro
  const projectRetroItems = await checkProjectRetros(userId, workspaceId);
  items.push(...projectRetroItems);

  return items;
}

/**
 * Check for missing standups for active sprints where user has assigned issues.
 *
 * Note: This query starts from issues assigned to the user and joins to sprints.
 * This effectively SKIPS sprints with no members (no assigned issues) because
 * there are no issue rows to match. Users are only prompted for standups in
 * sprints where they're actually participating (have assigned issues).
 */
async function checkMissingStandups(
  userId: string,
  workspaceId: string,
  currentSprintNumber: number,
  todayStr: string
): Promise<MissingAccountabilityItem[]> {
  const items: MissingAccountabilityItem[] = [];

  // Only check on business days
  if (!isBusinessDay(todayStr)) {
    return items;
  }

  // Find active sprints where user has assigned issues
  // (This inherently skips empty sprints with no members)
  const activeSprintsResult = await pool.query(
    `SELECT DISTINCT s.id, s.title, s.properties
     FROM documents i
     JOIN document_associations da ON da.document_id = i.id AND da.relationship_type = 'sprint'
     JOIN documents s ON s.id = da.related_id AND s.document_type = 'sprint'
     WHERE i.workspace_id = $1
       AND i.document_type = 'issue'
       AND (i.properties->>'assignee_id')::uuid = $2
       AND (s.properties->>'sprint_number')::int = $3
       AND s.deleted_at IS NULL`,
    [workspaceId, userId, currentSprintNumber]
  );

  // Check each sprint for missing standup today
  for (const sprint of activeSprintsResult.rows) {
    const standupResult = await pool.query(
      `SELECT id FROM documents
       WHERE workspace_id = $1
         AND document_type = 'standup'
         AND (properties->>'author_id')::uuid = $2
         AND parent_id = $3
         AND created_at >= $4::date
         AND created_at < ($4::date + interval '1 day')`,
      [workspaceId, userId, sprint.id, todayStr]
    );

    if (standupResult.rows.length === 0) {
      items.push({
        type: 'standup',
        targetId: sprint.id,
        targetTitle: sprint.title || `Sprint ${sprint.properties?.sprint_number || 'N'}`,
        targetType: 'sprint',
        dueDate: todayStr,
        message: `Post standup for ${sprint.title || 'current sprint'}`,
      });
    }
  }

  return items;
}

/**
 * Check sprint accountability: hypothesis, started status, and issues.
 */
async function checkSprintAccountability(
  userId: string,
  workspaceId: string,
  workspaceStartDate: Date,
  sprintDuration: number,
  today: Date
): Promise<MissingAccountabilityItem[]> {
  const items: MissingAccountabilityItem[] = [];

  // Find sprints where user is owner (accountable) and sprint has started
  const sprintsResult = await pool.query(
    `SELECT s.id, s.title, s.properties
     FROM documents s
     WHERE s.workspace_id = $1
       AND s.document_type = 'sprint'
       AND (s.properties->>'owner_id')::uuid = $2
       AND s.deleted_at IS NULL
       AND s.archived_at IS NULL`,
    [workspaceId, userId]
  );

  for (const sprint of sprintsResult.rows) {
    const props = sprint.properties || {};
    const sprintNumber = props.sprint_number || 1;

    // Calculate sprint start date
    const sprintStartDate = new Date(workspaceStartDate);
    sprintStartDate.setUTCDate(sprintStartDate.getUTCDate() + (sprintNumber - 1) * sprintDuration);

    // Skip if sprint hasn't started yet
    if (today < sprintStartDate) {
      continue;
    }

    const sprintTitle = sprint.title || `Sprint ${sprintNumber}`;

    const sprintStartStr = sprintStartDate.toISOString().split('T')[0] || null;

    // Check for missing hypothesis
    if (!props.hypothesis || props.hypothesis.trim() === '') {
      items.push({
        type: 'sprint_hypothesis',
        targetId: sprint.id,
        targetTitle: sprintTitle,
        targetType: 'sprint',
        dueDate: sprintStartStr,
        message: `Write hypothesis for ${sprintTitle}`,
      });
    }

    // Check if sprint hasn't been started (status !== 'active' or 'completed')
    if (props.status !== 'active' && props.status !== 'completed') {
      items.push({
        type: 'sprint_start',
        targetId: sprint.id,
        targetTitle: sprintTitle,
        targetType: 'sprint',
        dueDate: sprintStartStr,
        message: `Start ${sprintTitle}`,
      });
    }

    // Check if sprint has no issues
    const issueCountResult = await pool.query(
      `SELECT COUNT(*) as count
       FROM document_associations da
       JOIN documents d ON d.id = da.document_id
       WHERE da.related_id = $1
         AND da.relationship_type = 'sprint'
         AND d.document_type = 'issue'
         AND d.deleted_at IS NULL`,
      [sprint.id]
    );

    const issueCount = parseInt(issueCountResult.rows[0].count, 10);
    if (issueCount === 0) {
      items.push({
        type: 'sprint_issues',
        targetId: sprint.id,
        targetTitle: sprintTitle,
        targetType: 'sprint',
        dueDate: sprintStartStr,
        message: `Add issues to ${sprintTitle}`,
      });
    }
  }

  return items;
}

/**
 * Check for completed sprints without review (>1 business day since end).
 */
async function checkMissingSprintReviews(
  userId: string,
  workspaceId: string,
  workspaceStartDate: Date,
  sprintDuration: number,
  today: Date,
  todayStr: string
): Promise<MissingAccountabilityItem[]> {
  const items: MissingAccountabilityItem[] = [];

  // Find past sprints where user is owner without review
  const sprintsResult = await pool.query(
    `SELECT s.id, s.title, s.properties
     FROM documents s
     WHERE s.workspace_id = $1
       AND s.document_type = 'sprint'
       AND (s.properties->>'owner_id')::uuid = $2
       AND s.deleted_at IS NULL
       AND s.archived_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM documents r
         JOIN document_associations da ON da.document_id = r.id AND da.related_id = s.id AND da.relationship_type = 'sprint'
         WHERE r.document_type = 'sprint_review'
           AND r.workspace_id = $1
       )`,
    [workspaceId, userId]
  );

  for (const sprint of sprintsResult.rows) {
    const props = sprint.properties || {};
    const sprintNumber = props.sprint_number || 1;

    // Calculate sprint end date
    const sprintStartDate = new Date(workspaceStartDate);
    sprintStartDate.setUTCDate(sprintStartDate.getUTCDate() + (sprintNumber - 1) * sprintDuration);
    const sprintEndDate = new Date(sprintStartDate);
    sprintEndDate.setUTCDate(sprintEndDate.getUTCDate() + sprintDuration - 1);

    // Skip if sprint hasn't ended yet
    if (today <= sprintEndDate) {
      continue;
    }

    // Check if >1 business day has passed since sprint end
    const sprintEndStr = sprintEndDate.toISOString().split('T')[0] ?? '';
    if (!sprintEndStr) continue;
    const reviewDueDate = addBusinessDays(sprintEndStr, 1);

    if (todayStr > reviewDueDate) {
      const sprintTitle = sprint.title || `Sprint ${sprintNumber}`;
      items.push({
        type: 'sprint_review',
        targetId: sprint.id,
        targetTitle: sprintTitle,
        targetType: 'sprint',
        dueDate: reviewDueDate,
        message: `Complete review for ${sprintTitle}`,
      });
    }
  }

  return items;
}

/**
 * Check for projects where user is owner without hypothesis.
 */
async function checkProjectHypothesis(
  userId: string,
  workspaceId: string
): Promise<MissingAccountabilityItem[]> {
  const items: MissingAccountabilityItem[] = [];

  // Find projects where user is owner without hypothesis
  const projectsResult = await pool.query(
    `SELECT p.id, p.title, p.properties
     FROM documents p
     WHERE p.workspace_id = $1
       AND p.document_type = 'project'
       AND (p.properties->>'owner_id')::uuid = $2
       AND p.deleted_at IS NULL
       AND p.archived_at IS NULL
       AND (p.properties->>'hypothesis' IS NULL OR p.properties->>'hypothesis' = '')`,
    [workspaceId, userId]
  );

  for (const project of projectsResult.rows) {
    items.push({
      type: 'project_hypothesis',
      targetId: project.id,
      targetTitle: project.title || 'Untitled Project',
      targetType: 'project',
      dueDate: null, // No specific due date for project hypothesis
      message: `Write hypothesis for ${project.title || 'project'}`,
    });
  }

  return items;
}

/**
 * Check for completed projects without retro.
 * A project is considered completed when all its issues are done.
 */
async function checkProjectRetros(
  userId: string,
  workspaceId: string
): Promise<MissingAccountabilityItem[]> {
  const items: MissingAccountabilityItem[] = [];

  // Find projects where user is owner, have issues, all issues done, but no retro
  const projectsResult = await pool.query(
    `SELECT p.id, p.title, p.properties
     FROM documents p
     WHERE p.workspace_id = $1
       AND p.document_type = 'project'
       AND (p.properties->>'owner_id')::uuid = $2
       AND p.deleted_at IS NULL
       AND p.archived_at IS NULL
       AND (p.properties->>'hypothesis_validated' IS NULL)
       AND EXISTS (
         SELECT 1 FROM document_associations da
         JOIN documents i ON i.id = da.document_id
         WHERE da.related_id = p.id
           AND da.relationship_type = 'project'
           AND i.document_type = 'issue'
           AND i.deleted_at IS NULL
       )
       AND NOT EXISTS (
         SELECT 1 FROM document_associations da
         JOIN documents i ON i.id = da.document_id
         WHERE da.related_id = p.id
           AND da.relationship_type = 'project'
           AND i.document_type = 'issue'
           AND i.deleted_at IS NULL
           AND i.properties->>'state' NOT IN ('done', 'cancelled')
       )`,
    [workspaceId, userId]
  );

  for (const project of projectsResult.rows) {
    items.push({
      type: 'project_retro',
      targetId: project.id,
      targetTitle: project.title || 'Untitled Project',
      targetType: 'project',
      dueDate: null, // No specific due date for project retro
      message: `Complete retro for ${project.title || 'project'}`,
    });
  }

  return items;
}

/**
 * Create an accountability issue for a missing item.
 * Returns null if an issue already exists for this target and type.
 */
export async function createAccountabilityIssue(
  type: AccountabilityType,
  targetId: string,
  userId: string,
  workspaceId: string,
  title: string,
  dueDate: string | null
): Promise<AccountabilityIssue | null> {
  // Check if accountability issue already exists for this target and type
  const existingResult = await pool.query(
    `SELECT id, ticket_number FROM documents
     WHERE workspace_id = $1
       AND document_type = 'issue'
       AND properties->>'accountability_target_id' = $2
       AND properties->>'accountability_type' = $3
       AND properties->>'state' NOT IN ('done', 'cancelled')
       AND deleted_at IS NULL`,
    [workspaceId, targetId, type]
  );

  if (existingResult.rows.length > 0) {
    // Return existing issue info
    return {
      id: existingResult.rows[0].id,
      title,
      ticketNumber: existingResult.rows[0].ticket_number,
      type,
      targetId,
      dueDate,
    };
  }

  // Get next ticket number with advisory lock
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const workspaceIdHex = workspaceId.replace(/-/g, '').substring(0, 15);
    const lockKey = parseInt(workspaceIdHex, 16);
    await client.query('SELECT pg_advisory_xact_lock($1)', [lockKey]);

    const ticketResult = await client.query(
      `SELECT COALESCE(MAX(ticket_number), 0) + 1 as next_number
       FROM documents
       WHERE workspace_id = $1 AND document_type = 'issue'`,
      [workspaceId]
    );
    const ticketNumber = ticketResult.rows[0].next_number;

    // Build properties
    const properties = {
      state: 'todo',
      priority: 'high',
      source: 'action_items',
      assignee_id: userId,
      rejection_reason: null,
      due_date: dueDate,
      is_system_generated: true,
      accountability_target_id: targetId,
      accountability_type: type,
    };

    const result = await client.query(
      `INSERT INTO documents (workspace_id, document_type, title, properties, ticket_number, created_by)
       VALUES ($1, 'issue', $2, $3, $4, $5)
       RETURNING id`,
      [workspaceId, title, JSON.stringify(properties), ticketNumber, userId]
    );

    await client.query('COMMIT');

    return {
      id: result.rows[0].id,
      title,
      ticketNumber,
      type,
      targetId,
      dueDate,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Check accountability and create issues for any missing items.
 * Returns both the missing items found and any issues created.
 */
export async function checkAndCreateAccountabilityIssues(
  userId: string,
  workspaceId: string
): Promise<{
  missingItems: MissingAccountabilityItem[];
  createdIssues: AccountabilityIssue[];
  existingIssues: AccountabilityIssue[];
}> {
  const missingItems = await checkMissingAccountability(userId, workspaceId);
  const createdIssues: AccountabilityIssue[] = [];
  const existingIssues: AccountabilityIssue[] = [];

  for (const item of missingItems) {
    const issue = await createAccountabilityIssue(
      item.type,
      item.targetId,
      userId,
      workspaceId,
      item.message,
      item.dueDate
    );

    if (issue) {
      // Check if this was a newly created issue by comparing if it already existed
      const wasExisting = await pool.query(
        `SELECT created_at FROM documents WHERE id = $1 AND created_at < NOW() - interval '1 second'`,
        [issue.id]
      );

      if (wasExisting.rows.length > 0) {
        existingIssues.push(issue);
      } else {
        createdIssues.push(issue);
      }
    }
  }

  return { missingItems, createdIssues, existingIssues };
}

/**
 * Auto-complete an accountability issue when the underlying task is done.
 * Called when standups, reviews, retros, etc. are created/completed.
 */
export async function autoCompleteAccountabilityIssue(
  targetId: string,
  accountabilityType: AccountabilityType,
  workspaceId: string
): Promise<void> {
  await pool.query(
    `UPDATE documents
     SET properties = jsonb_set(
       jsonb_set(properties, '{state}', '"done"'),
       '{completed_at}', to_jsonb(now())
     ),
     completed_at = NOW(),
     updated_at = NOW()
     WHERE workspace_id = $1
       AND document_type = 'issue'
       AND properties->>'accountability_target_id' = $2
       AND properties->>'accountability_type' = $3
       AND properties->>'state' NOT IN ('done', 'cancelled')
       AND deleted_at IS NULL`,
    [workspaceId, targetId, accountabilityType]
  );
}
