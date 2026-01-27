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

-- Self-healing backfill: Fix any orphaned program_id values before drop
-- This handles cases where documents were created between migration 028 and 029
INSERT INTO document_associations (document_id, related_id, relationship_type, metadata)
SELECT
  d.id AS document_id,
  d.program_id AS related_id,
  'program'::relationship_type AS relationship_type,
  jsonb_build_object(
    'backfilled_from', 'program_id_column',
    'backfilled_at', NOW(),
    'migration', '029_drop_program_id_column_self_heal'
  )
FROM documents d
WHERE d.program_id IS NOT NULL
  AND d.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM document_associations da
    WHERE da.document_id = d.id
      AND da.relationship_type = 'program'
  )
ON CONFLICT (document_id, related_id, relationship_type) DO NOTHING;

-- Verify backfill succeeded
DO $$
DECLARE
  orphan_count INTEGER;
  backfilled_count INTEGER;
BEGIN
  -- Count what we just backfilled
  SELECT COUNT(*) INTO backfilled_count
  FROM document_associations
  WHERE metadata->>'migration' = '029_drop_program_id_column_self_heal';

  IF backfilled_count > 0 THEN
    RAISE NOTICE 'Self-healed % orphaned program associations', backfilled_count;
  END IF;

  -- Final check - should be 0 now
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
    RAISE EXCEPTION 'Self-heal failed: % documents still have orphaned program_id', orphan_count;
  END IF;

  RAISE NOTICE 'Pre-flight check passed: All program associations verified';
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
