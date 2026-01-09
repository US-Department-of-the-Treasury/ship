-- Create github_activity table for storing GitHub PR/commit events
-- This enables the activity feed and issue-PR linking features

CREATE TABLE IF NOT EXISTS github_activity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

    -- Repository info
    repo_owner VARCHAR(100) NOT NULL,
    repo_name VARCHAR(100) NOT NULL,

    -- Event info
    event_type VARCHAR(50) NOT NULL CHECK (event_type IN ('pr_opened', 'pr_merged', 'pr_closed', 'commit')),
    github_id BIGINT NOT NULL, -- GitHub's numeric ID for the PR/commit

    -- PR/Commit details
    title TEXT NOT NULL,
    url TEXT NOT NULL,

    -- Author info from GitHub
    author_login VARCHAR(100),
    author_avatar_url TEXT,

    -- Linked Ship issues (extracted from PR title/body, stored as ticket_numbers)
    issue_ids INTEGER[] DEFAULT '{}',

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    github_created_at TIMESTAMPTZ, -- When the PR/commit was created on GitHub

    -- Store full payload for future reference and debugging
    raw_payload JSONB,

    -- Unique constraint to prevent duplicate entries
    UNIQUE(workspace_id, repo_owner, repo_name, github_id, event_type)
);

-- Index for activity feed queries (sorted by time, filtered by workspace)
CREATE INDEX IF NOT EXISTS idx_github_activity_workspace_created
    ON github_activity(workspace_id, created_at DESC);

-- GIN index for efficient issue lookups (find all PRs referencing a specific issue)
CREATE INDEX IF NOT EXISTS idx_github_activity_issue_ids
    ON github_activity USING GIN(issue_ids);

-- Index for repo-based queries (activity for a specific repo)
CREATE INDEX IF NOT EXISTS idx_github_activity_repo
    ON github_activity(workspace_id, repo_owner, repo_name, created_at DESC);

COMMENT ON TABLE github_activity IS 'Stores GitHub PR and commit events for activity feeds and issue linking';
COMMENT ON COLUMN github_activity.issue_ids IS 'Ship issue ticket_numbers referenced in PR title/body (e.g., #123)';
COMMENT ON COLUMN github_activity.event_type IS 'Type of GitHub event: pr_opened, pr_merged, pr_closed, or commit';
