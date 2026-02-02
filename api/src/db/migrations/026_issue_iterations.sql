-- Issue iterations table for tracking work progress on individual issues
-- Records each iteration attempt (pass/fail/in_progress) directly on issues
-- Replaces sprint-level iteration tracking for more granular observability
CREATE TABLE IF NOT EXISTS issue_iterations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- Status of this iteration attempt
  status TEXT NOT NULL CHECK (status IN ('pass', 'fail', 'in_progress')),
  -- Details about what was attempted
  what_attempted TEXT,
  blockers_encountered TEXT,
  -- Attribution
  author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_issue_iterations_issue_id ON issue_iterations(issue_id);
CREATE INDEX IF NOT EXISTS idx_issue_iterations_workspace_id ON issue_iterations(workspace_id);
CREATE INDEX IF NOT EXISTS idx_issue_iterations_status ON issue_iterations(status);
CREATE INDEX IF NOT EXISTS idx_issue_iterations_created_at ON issue_iterations(created_at DESC);

-- Composite index for aggregating iterations by project/sprint via document_associations
-- This enables queries like: "get all iterations for issues in project X"
CREATE INDEX IF NOT EXISTS idx_issue_iterations_issue_workspace ON issue_iterations(issue_id, workspace_id);

COMMENT ON TABLE issue_iterations IS 'Tracks work progress iterations on individual issues. Enables aggregation by project/sprint via document_associations joins.';
