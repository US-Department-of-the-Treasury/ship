-- Migration: 006_document_visibility.sql
-- Add visibility column to documents table for private/workspace document support

-- Add visibility column with default 'workspace' (preserves current behavior)
ALTER TABLE documents
ADD COLUMN visibility TEXT NOT NULL DEFAULT 'workspace'
CHECK (visibility IN ('private', 'workspace'));

-- Index for efficient filtering
CREATE INDEX idx_documents_visibility ON documents(visibility);
CREATE INDEX idx_documents_visibility_created_by ON documents(visibility, created_by);
