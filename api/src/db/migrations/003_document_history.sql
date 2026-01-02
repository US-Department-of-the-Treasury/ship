-- Migration: Add document_history table and status timestamps
-- Track all document field changes for audit trail and analytics

-- Track all document field changes for audit trail
CREATE TABLE IF NOT EXISTS document_history (
  id SERIAL PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast timeline queries
CREATE INDEX IF NOT EXISTS idx_document_history_document_created
  ON document_history(document_id, created_at DESC);

-- Index for analytics queries (find all changes by user)
CREATE INDEX IF NOT EXISTS idx_document_history_changed_by
  ON document_history(changed_by, created_at DESC);

-- Add status timestamp columns to documents
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reopened_at TIMESTAMPTZ;

-- Add comments for documentation
COMMENT ON TABLE document_history IS 'Tracks all field changes on documents for audit trail and analytics';
COMMENT ON COLUMN documents.started_at IS 'When issue status first changed to in_progress';
COMMENT ON COLUMN documents.completed_at IS 'When issue status first changed to done';
COMMENT ON COLUMN documents.cancelled_at IS 'When issue status changed to cancelled';
COMMENT ON COLUMN documents.reopened_at IS 'When issue was reopened after being done/cancelled';
