-- Sprint iterations table for tracking work progress
-- Records each iteration attempt on a sprint (pass/fail/in_progress)
CREATE TABLE IF NOT EXISTS sprint_iterations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sprint_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- Story tracking (external reference, not FK since stories may not exist in Ship)
  story_id TEXT,
  story_title TEXT NOT NULL,
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
CREATE INDEX IF NOT EXISTS idx_sprint_iterations_sprint_id ON sprint_iterations(sprint_id);
CREATE INDEX IF NOT EXISTS idx_sprint_iterations_workspace_id ON sprint_iterations(workspace_id);
CREATE INDEX IF NOT EXISTS idx_sprint_iterations_status ON sprint_iterations(status);
CREATE INDEX IF NOT EXISTS idx_sprint_iterations_story_id ON sprint_iterations(story_id);
CREATE INDEX IF NOT EXISTS idx_sprint_iterations_created_at ON sprint_iterations(created_at DESC);
