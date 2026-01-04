-- Add archived_at and deleted_at columns for soft delete and archive functionality
-- archived_at: Hidden but searchable items
-- deleted_at: Trash items (30 day retention before permanent soft delete)

ALTER TABLE documents
ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE documents
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Index for efficient filtering of archived items
CREATE INDEX IF NOT EXISTS idx_documents_archived_at
ON documents(archived_at) WHERE archived_at IS NOT NULL;

-- Index for efficient filtering of deleted items (trash)
CREATE INDEX IF NOT EXISTS idx_documents_deleted_at
ON documents(deleted_at) WHERE deleted_at IS NOT NULL;

-- Index for finding non-archived, non-deleted items (the common case)
CREATE INDEX IF NOT EXISTS idx_documents_active
ON documents(workspace_id, document_type)
WHERE archived_at IS NULL AND deleted_at IS NULL;
