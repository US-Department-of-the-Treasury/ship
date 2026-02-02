-- Rename collision migrations in schema_migrations table
-- This ensures databases that already applied the old-named migrations
-- are updated to match the new filenames
-- Uses conditional updates to be idempotent (safe to run multiple times)

-- Only update if old version exists AND new version doesn't exist yet
UPDATE schema_migrations SET version = '007b_remove_prefix_add_emoji'
WHERE version = '007_remove_prefix_add_emoji'
  AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '007b_remove_prefix_add_emoji');

UPDATE schema_migrations SET version = '014b_backfill_missing_person_documents'
WHERE version = '014_backfill_missing_person_documents'
  AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '014b_backfill_missing_person_documents');

UPDATE schema_migrations SET version = '015b_sprint_iterations'
WHERE version = '015_sprint_iterations'
  AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '015b_sprint_iterations');

UPDATE schema_migrations SET version = '018b_document_conversion'
WHERE version = '018_document_conversion'
  AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '018b_document_conversion');

UPDATE schema_migrations SET version = '020b_sprint_assignee_ids'
WHERE version = '020_sprint_assignee_ids'
  AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '020b_sprint_assignee_ids');
