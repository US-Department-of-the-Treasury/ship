-- Migration: 006_document_visibility.sql
-- Add visibility column to documents table for private/workspace document support

-- Add visibility column with default 'workspace' (preserves current behavior)
-- Idempotent: only add if column doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'documents' AND column_name = 'visibility'
  ) THEN
    ALTER TABLE documents
    ADD COLUMN visibility TEXT NOT NULL DEFAULT 'workspace'
    CHECK (visibility IN ('private', 'workspace'));
  END IF;
END $$;

-- Index for efficient filtering (IF NOT EXISTS is idempotent)
CREATE INDEX IF NOT EXISTS idx_documents_visibility ON documents(visibility);
CREATE INDEX IF NOT EXISTS idx_documents_visibility_created_by ON documents(visibility, created_by);
