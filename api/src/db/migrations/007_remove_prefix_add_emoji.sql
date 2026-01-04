-- Migration: 007_remove_prefix_add_emoji.sql
-- Remove program prefix (no longer used for issue IDs)
-- Emoji support uses existing properties JSONB (no schema change needed)

-- Drop the prefix uniqueness index (prefix is being removed)
DROP INDEX IF EXISTS idx_documents_workspace_prefix;

-- Note: Existing prefix values in properties JSONB will remain but are ignored.
-- No data migration needed - API and UI will simply stop reading/writing prefix.
