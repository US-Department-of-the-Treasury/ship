-- Migration: Drop program_id column from documents table
-- This completes the migration from direct column references to the document_associations
-- junction table pattern. All program associations are now stored exclusively in
-- document_associations with relationship_type = 'program'.
--
-- Prerequisites:
-- - Migration 028 backfilled all program_id values to document_associations
-- - All routes updated to read/write via document_associations (Story 2)
-- - No code references d.program_id for reads
--
-- Post-migration:
-- - program_id column will no longer exist
-- - All queries use document_associations JOIN for program lookup
-- - Pattern is now consistent with project_id and sprint_id (dropped in 027)

-- Pre-flight check: Verify no orphaned data exists
DO $$
DECLARE
  orphan_count INTEGER;
BEGIN
  -- Check for documents with program_id but no junction table entry
  SELECT COUNT(*) INTO orphan_count
  FROM documents d
  WHERE d.program_id IS NOT NULL
    AND d.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM document_associations da
      WHERE da.document_id = d.id
        AND da.relationship_type = 'program'
    );

  IF orphan_count > 0 THEN
    RAISE EXCEPTION 'Cannot drop program_id: % documents have program_id without document_associations entry. Run migration 028 first.', orphan_count;
  END IF;

  RAISE NOTICE 'Pre-flight check passed: No orphaned program_id values found';
END
$$;

-- Drop index first (if exists)
DROP INDEX IF EXISTS idx_documents_program_id;

-- Drop the program_id column
ALTER TABLE documents DROP COLUMN IF EXISTS program_id;

-- Log completion
DO $$
BEGIN
  RAISE NOTICE 'Dropped program_id column from documents table';
  RAISE NOTICE 'Program associations now managed exclusively via document_associations table';
  RAISE NOTICE 'Pattern now consistent with project_id and sprint_id (dropped in migration 027)';
END
$$;
