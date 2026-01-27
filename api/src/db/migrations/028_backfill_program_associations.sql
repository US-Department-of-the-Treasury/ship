-- Migration: Backfill missing program associations in junction table
-- Fixes documents that have program_id column set but no corresponding
-- document_associations entry. This occurred due to a bug where CREATE
-- endpoints wrote to the column but not the junction table.
--
-- This migration is idempotent - it checks for column existence before migrating.
-- This is necessary because schema.sql may not include the legacy program_id column
-- (it was removed in migration 029).

DO $$
BEGIN
  -- Only run if program_id column exists on documents table
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'documents' AND column_name = 'program_id'
  ) THEN
    -- Backfill missing program associations for all document types
    EXECUTE '
      INSERT INTO document_associations (document_id, related_id, relationship_type, metadata)
      SELECT
        d.id AS document_id,
        d.program_id AS related_id,
        ''program''::relationship_type AS relationship_type,
        jsonb_build_object(
          ''backfilled_from'', ''program_id_column'',
          ''backfilled_at'', NOW(),
          ''migration'', ''028_backfill_program_associations''
        )
      FROM documents d
      WHERE d.program_id IS NOT NULL
        AND d.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM document_associations da
          WHERE da.document_id = d.id
            AND da.relationship_type = ''program''
        )
      ON CONFLICT (document_id, related_id, relationship_type) DO NOTHING
    ';
  ELSE
    RAISE NOTICE 'Skipping 028 migration - legacy column (program_id) does not exist';
  END IF;
END
$$;

-- Log migration stats
DO $$
DECLARE
  backfilled_count INTEGER;
BEGIN
  -- Count what was backfilled
  SELECT COUNT(*) INTO backfilled_count
  FROM document_associations
  WHERE metadata->>'migration' = '028_backfill_program_associations';

  RAISE NOTICE 'Backfilled % program associations', backfilled_count;
END
$$;
