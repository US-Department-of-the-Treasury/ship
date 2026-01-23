-- Migration: Drop legacy sprint_id and project_id columns
-- These columns have been replaced by the document_associations junction table.
-- All queries now read from document_associations, and writes update both for compatibility.
--
-- Note: parent_id and program_id are NOT removed - they represent different relationships:
-- - parent_id: True hierarchical parent-child (wiki pages, sprint->sprint_plan)
-- - program_id: Top-level organizational unit, heavily used for filtering
--
-- Prerequisites verified:
-- - document_associations table exists and is populated (migration 020, 021)
-- - All SELECT queries updated to use document_associations JOINs
-- - All INSERT/UPDATE queries write to both legacy columns AND document_associations

-- Drop indexes first
DROP INDEX IF EXISTS idx_documents_sprint_id;
DROP INDEX IF EXISTS idx_documents_project_id;

-- Drop the legacy columns
ALTER TABLE documents DROP COLUMN IF EXISTS sprint_id;
ALTER TABLE documents DROP COLUMN IF EXISTS project_id;

-- Log completion
DO $$
BEGIN
  RAISE NOTICE 'Dropped legacy columns: sprint_id, project_id';
  RAISE NOTICE 'Relationships now managed via document_associations table';
END
$$;
