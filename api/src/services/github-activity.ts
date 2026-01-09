/**
 * GitHub Activity Service
 *
 * Stores and retrieves GitHub PR/commit events from the github_activity table.
 */

import { pool } from '../db/client.js';
import { extractPRIssueReferences } from './github-reference-detection.js';

export type GitHubEventType = 'pr_opened' | 'pr_merged' | 'pr_closed' | 'commit';

export interface GitHubActivityRecord {
  id: string;
  workspace_id: string;
  repo_owner: string;
  repo_name: string;
  event_type: GitHubEventType;
  github_id: number;
  title: string;
  url: string;
  author_login: string | null;
  author_avatar_url: string | null;
  issue_ids: number[];
  created_at: Date;
  github_created_at: Date | null;
  raw_payload: unknown;
}

export interface CreateActivityInput {
  workspace_id: string;
  repo_owner: string;
  repo_name: string;
  event_type: GitHubEventType;
  github_id: number;
  title: string;
  url: string;
  author_login?: string | null;
  author_avatar_url?: string | null;
  issue_ids: number[];
  github_created_at?: Date | null;
  raw_payload?: unknown;
}

/**
 * Store a GitHub activity record.
 * Uses upsert to handle duplicate events (updates existing record).
 */
export async function storeGitHubActivity(input: CreateActivityInput): Promise<GitHubActivityRecord> {
  const result = await pool.query(
    `INSERT INTO github_activity (
      workspace_id, repo_owner, repo_name, event_type, github_id,
      title, url, author_login, author_avatar_url, issue_ids,
      github_created_at, raw_payload
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    ON CONFLICT (workspace_id, repo_owner, repo_name, github_id, event_type)
    DO UPDATE SET
      title = EXCLUDED.title,
      url = EXCLUDED.url,
      author_login = EXCLUDED.author_login,
      author_avatar_url = EXCLUDED.author_avatar_url,
      issue_ids = EXCLUDED.issue_ids,
      raw_payload = EXCLUDED.raw_payload
    RETURNING *`,
    [
      input.workspace_id,
      input.repo_owner,
      input.repo_name,
      input.event_type,
      input.github_id,
      input.title,
      input.url,
      input.author_login || null,
      input.author_avatar_url || null,
      input.issue_ids,
      input.github_created_at || null,
      input.raw_payload ? JSON.stringify(input.raw_payload) : null,
    ]
  );

  return result.rows[0] as GitHubActivityRecord;
}

/**
 * Find workspace IDs that have linked the given repo.
 * Used to determine which workspace to store activity for.
 */
export async function findWorkspacesForRepo(
  repoOwner: string,
  repoName: string
): Promise<string[]> {
  // Query programs that have this repo linked in their properties
  const result = await pool.query(
    `SELECT DISTINCT d.workspace_id
     FROM documents d
     WHERE d.document_type = 'program'
       AND d.properties->'githubRepos' @> $1::jsonb`,
    [JSON.stringify([{ owner: repoOwner, repo: repoName }])]
  );

  return result.rows.map((row) => row.workspace_id);
}

/**
 * GitHub PR webhook payload types
 */
interface GitHubPRPayload {
  action: string;
  pull_request: {
    id: number;
    number: number;
    title: string;
    body: string | null;
    html_url: string;
    state: 'open' | 'closed';
    merged: boolean;
    merged_at: string | null;
    created_at: string;
    user: {
      login: string;
      avatar_url: string;
    };
  };
  repository: {
    owner: {
      login: string;
    };
    name: string;
  };
}

/**
 * Map PR state to event type
 */
function getPREventType(pr: GitHubPRPayload['pull_request']): GitHubEventType {
  if (pr.merged) {
    return 'pr_merged';
  }
  if (pr.state === 'closed') {
    return 'pr_closed';
  }
  return 'pr_opened';
}

/**
 * Handle a pull_request webhook event.
 * Extracts issue references and stores the activity.
 * Optionally updates issue status on merge if program has autoStatusOnMerge enabled.
 */
export async function handlePullRequestEvent(payload: unknown): Promise<void> {
  const pr = payload as GitHubPRPayload;

  // Validate payload structure
  if (!pr.pull_request || !pr.repository) {
    console.warn('[GitHub Activity] Invalid PR payload - missing required fields');
    return;
  }

  const repoOwner = pr.repository.owner.login;
  const repoName = pr.repository.name;

  // Find workspaces that have linked this repo
  const workspaceIds = await findWorkspacesForRepo(repoOwner, repoName);

  if (workspaceIds.length === 0) {
    console.log(`[GitHub Activity] No workspaces linked to ${repoOwner}/${repoName}`);
    return;
  }

  // Extract issue references from title and body
  const issueIds = extractPRIssueReferences(pr.pull_request.title, pr.pull_request.body);

  const eventType = getPREventType(pr.pull_request);

  console.log(`[GitHub Activity] Processing PR #${pr.pull_request.number} (${eventType})`, {
    repo: `${repoOwner}/${repoName}`,
    issueIds,
    workspaces: workspaceIds.length,
  });

  // Store activity for each workspace
  for (const workspaceId of workspaceIds) {
    await storeGitHubActivity({
      workspace_id: workspaceId,
      repo_owner: repoOwner,
      repo_name: repoName,
      event_type: eventType,
      github_id: pr.pull_request.id,
      title: pr.pull_request.title,
      url: pr.pull_request.html_url,
      author_login: pr.pull_request.user.login,
      author_avatar_url: pr.pull_request.user.avatar_url,
      issue_ids: issueIds,
      github_created_at: new Date(pr.pull_request.created_at),
      raw_payload: payload,
    });

    // Auto-update issue status on PR merge if enabled
    if (eventType === 'pr_merged' && issueIds.length > 0) {
      await handleAutoStatusUpdate(workspaceId, repoOwner, repoName, issueIds);
    }
  }

  console.log(`[GitHub Activity] Stored PR #${pr.pull_request.number} for ${workspaceIds.length} workspace(s)`);
}

/**
 * Handle automatic issue status update when a PR is merged.
 * Checks if any linked program has autoStatusOnMerge enabled and updates issues accordingly.
 */
async function handleAutoStatusUpdate(
  workspaceId: string,
  repoOwner: string,
  repoName: string,
  issueTicketNumbers: number[]
): Promise<void> {
  // Find programs with autoStatusOnMerge enabled that have this repo linked
  const programsResult = await pool.query(
    `SELECT d.id, d.properties
     FROM documents d
     WHERE d.workspace_id = $1
       AND d.document_type = 'program'
       AND d.properties->'githubRepos' @> $2::jsonb
       AND (d.properties->'autoStatusOnMerge'->>'enabled')::boolean = true`,
    [workspaceId, JSON.stringify([{ owner: repoOwner, repo: repoName }])]
  );

  if (programsResult.rows.length === 0) {
    console.log(`[GitHub Activity] No programs with autoStatusOnMerge enabled for ${repoOwner}/${repoName}`);
    return;
  }

  // For each program with auto-status enabled, update linked issues
  for (const program of programsResult.rows) {
    const targetStatus = program.properties?.autoStatusOnMerge?.targetStatus;
    if (!targetStatus) continue;

    // Update issues that:
    // 1. Belong to this workspace
    // 2. Have matching ticket_number
    // 3. Are linked to this program
    // 4. Are not already in the target status
    const updateResult = await pool.query(
      `UPDATE documents
       SET properties = jsonb_set(properties, '{state}', $1::jsonb),
           updated_at = NOW()
       WHERE workspace_id = $2
         AND document_type = 'issue'
         AND ticket_number = ANY($3::int[])
         AND program_id = $4
         AND properties->>'state' != $5
       RETURNING id, ticket_number`,
      [JSON.stringify(targetStatus), workspaceId, issueTicketNumbers, program.id, targetStatus]
    );

    if (updateResult.rows.length > 0) {
      const updatedTickets = updateResult.rows.map((r) => r.ticket_number);
      console.log(
        `[GitHub Activity] Auto-updated ${updateResult.rows.length} issue(s) to '${targetStatus}':`,
        updatedTickets
      );
    }
  }
}
