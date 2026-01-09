-- Migration: Add automated_by column to document_history
-- Tracks when changes are made by automated processes (e.g., Claude)

ALTER TABLE document_history
  ADD COLUMN IF NOT EXISTS automated_by TEXT;

COMMENT ON COLUMN document_history.automated_by IS 'Identifies automated change source (e.g., "claude") when not made by human user';
