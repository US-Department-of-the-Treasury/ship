-- Migration: Backfill missing program associations in junction table
-- Fixes documents that have program_id column set but no corresponding
-- document_associations entry. This occurred due to a bug where CREATE
-- endpoints wrote to the column but not the junction table.

-- Backfill missing program associations for all document types
INSERT INTO document_associations (document_id, related_id, relationship_type, metadata)
SELECT
  d.id AS document_id,
  d.program_id AS related_id,
  'program'::relationship_type AS relationship_type,
  jsonb_build_object(
    'backfilled_from', 'program_id_column',
    'backfilled_at', NOW(),
    'migration', '028_backfill_program_associations'
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

-- Log migration stats
DO $$
DECLARE
  backfilled_count INTEGER;
  remaining_orphans INTEGER;
BEGIN
  -- Count what was backfilled
  SELECT COUNT(*) INTO backfilled_count
  FROM document_associations
  WHERE metadata->>'migration' = '028_backfill_program_associations';

  -- Verify no orphans remain
  SELECT COUNT(*) INTO remaining_orphans
  FROM documents d
  WHERE d.program_id IS NOT NULL
    AND d.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM document_associations da
      WHERE da.document_id = d.id AND da.relationship_type = 'program'
    );

  RAISE NOTICE 'Backfilled % program associations', backfilled_count;
  RAISE NOTICE 'Remaining orphans (should be 0): %', remaining_orphans;
END
$$;
