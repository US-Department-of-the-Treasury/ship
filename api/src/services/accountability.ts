/**
 * Accountability Check Service
 *
 * Detects missing accountability items for a user:
 * 1. Missing standups for active sprints
 * 2. Sprints at/past start without plan
 * 3. Sprints at/past start date not 'started'
 * 4. Sprints at/past start with no issues
 * 5. Completed sprints without review (>1 business day)
 * 6. Projects where user is owner without plan
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
  daysSinceLastStandup?: number; // Only set for standup type
  issueCount?: number; // Number of issues assigned to user (for standup type)
  // Additional metadata for weekly_plan/weekly_review navigation
  personId?: string; // Current user's person document ID
  projectId?: string; // Project associated with the sprint
  weekNumber?: number; // Sprint/week number
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

  // Get current user's person document ID for weekly_plan navigation
  const personResult = await pool.query(
    `SELECT id FROM documents
     WHERE workspace_id = $1
       AND document_type = 'person'
       AND (properties->>'user_id')::uuid = $2`,
    [workspaceId, userId]
  );
  const personId = personResult.rows[0]?.id || null;

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
  const sprintItems = await checkSprintAccountability(userId, workspaceId, workspaceStartDate, sprintDuration, today, personId);
  items.push(...sprintItems);

  // 5. Check for completed sprints without review
  if (todayStr) {
    const reviewItems = await checkMissingSprintReviews(userId, workspaceId, workspaceStartDate, sprintDuration, today, todayStr);
    items.push(...reviewItems);
  }

  // 6. Check for projects without plan
  const projectPlanItems = await checkProjectPlan(userId, workspaceId);
  items.push(...projectPlanItems);

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

  // Find active sprints where user has assigned issues with count
  // (This inherently skips empty sprints with no members)
  const activeSprintsResult = await pool.query(
    `SELECT s.id, s.title, s.properties, COUNT(i.id) as issue_count
     FROM documents i
     JOIN document_associations da ON da.document_id = i.id AND da.relationship_type = 'sprint'
     JOIN documents s ON s.id = da.related_id AND s.document_type = 'sprint'
     WHERE i.workspace_id = $1
       AND i.document_type = 'issue'
       AND (i.properties->>'assignee_id')::uuid = $2
       AND (s.properties->>'sprint_number')::int = $3
       AND s.deleted_at IS NULL
     GROUP BY s.id, s.title, s.properties`,
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
      // Calculate days since last standup
      const lastStandupResult = await pool.query(
        `SELECT MAX(created_at::date) as last_standup_date
         FROM documents
         WHERE workspace_id = $1
           AND document_type = 'standup'
           AND (properties->>'author_id')::uuid = $2
           AND parent_id = $3`,
        [workspaceId, userId, sprint.id]
      );

      const lastStandupDate = lastStandupResult.rows[0]?.last_standup_date;
      let daysSinceLastStandup = 0;
      const sprintTitle = sprint.title || `Week ${sprint.properties?.sprint_number || 'N'}`;
      const issueCount = parseInt(sprint.issue_count, 10) || 0;

      // Format: "Post standup for {sprint_title} ({issue_count} issues)"
      let message = `Post standup for ${sprintTitle}`;
      if (issueCount > 0) {
        message += ` (${issueCount} issue${issueCount === 1 ? '' : 's'} assigned)`;
      }

      if (lastStandupDate) {
        const lastDate = new Date(lastStandupDate);
        const todayDate = new Date(todayStr);
        daysSinceLastStandup = Math.floor((todayDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
        if (daysSinceLastStandup > 1) {
          message += ` - ${daysSinceLastStandup} days since last`;
        }
      }

      items.push({
        type: 'standup',
        targetId: sprint.id,
        targetTitle: sprintTitle,
        targetType: 'sprint',
        dueDate: todayStr,
        message,
        daysSinceLastStandup,
        issueCount,
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
  today: Date,
  personId: string | null
): Promise<MissingAccountabilityItem[]> {
  const items: MissingAccountabilityItem[] = [];

  // Find sprints where user is owner (accountable) and sprint has started
  // Also get the project associated with each sprint (via document_associations)
  const sprintsResult = await pool.query(
    `SELECT s.id, s.title, s.properties, da.related_id as project_id
     FROM documents s
     LEFT JOIN document_associations da ON da.document_id = s.id AND da.relationship_type = 'project'
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
    const projectId = sprint.project_id || null;

    // Calculate sprint start date
    const sprintStartDate = new Date(workspaceStartDate);
    sprintStartDate.setUTCDate(sprintStartDate.getUTCDate() + (sprintNumber - 1) * sprintDuration);

    // Skip if sprint hasn't started yet
    if (today < sprintStartDate) {
      continue;
    }

    const sprintTitle = sprint.title || `Week ${sprintNumber}`;

    const sprintStartStr = sprintStartDate.toISOString().split('T')[0] || null;

    // Check for missing plan
    if (!props.plan || props.plan.trim() === '') {
      items.push({
        type: 'weekly_plan',
        targetId: sprint.id,
        targetTitle: sprintTitle,
        targetType: 'sprint',
        dueDate: sprintStartStr,
        message: `Write plan for ${sprintTitle}`,
        // Include metadata for weekly_plan document navigation
        personId: personId || undefined,
        projectId: projectId || undefined,
        weekNumber: sprintNumber,
      });
    }

    // Check if sprint hasn't been started (status !== 'active' or 'completed')
    if (props.status !== 'active' && props.status !== 'completed') {
      items.push({
        type: 'week_start',
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
        type: 'week_issues',
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
         WHERE r.document_type = 'weekly_review'
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
      const sprintTitle = sprint.title || `Week ${sprintNumber}`;
      items.push({
        type: 'weekly_review',
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
 * Check for projects where user is owner without plan.
 */
async function checkProjectPlan(
  userId: string,
  workspaceId: string
): Promise<MissingAccountabilityItem[]> {
  const items: MissingAccountabilityItem[] = [];

  // Find projects where user is owner without plan
  const projectsResult = await pool.query(
    `SELECT p.id, p.title, p.properties
     FROM documents p
     WHERE p.workspace_id = $1
       AND p.document_type = 'project'
       AND (p.properties->>'owner_id')::uuid = $2
       AND p.deleted_at IS NULL
       AND p.archived_at IS NULL
       AND (p.properties->>'plan' IS NULL OR p.properties->>'plan' = '')`,
    [workspaceId, userId]
  );

  for (const project of projectsResult.rows) {
    items.push({
      type: 'project_plan',
      targetId: project.id,
      targetTitle: project.title || 'Untitled Project',
      targetType: 'project',
      dueDate: null, // No specific due date for project plan
      message: `Write plan for ${project.title || 'project'}`,
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
       AND (p.properties->>'plan_validated' IS NULL)
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

// NOTE: createAccountabilityIssue, checkAndCreateAccountabilityIssues, and
// autoCompleteAccountabilityIssue have been removed. Accountability is now
// computed via inference using checkMissingAccountability() - no issues are
// created or completed.
