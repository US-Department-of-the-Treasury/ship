-- Migration: Copy existing relationships to junction table
-- Migrates data from parent_id, project_id, sprint_id, program_id columns
-- to the new document_associations table. Old columns kept for rollback safety.
--
-- This migration is idempotent - it checks for column existence before migrating.
-- This is necessary because schema.sql may not include these legacy columns
-- (they were removed in later migrations).

DO $$
BEGIN
  -- Copy parent_id relationships (parent_id is still in schema)
  INSERT INTO document_associations (document_id, related_id, relationship_type, metadata)
  SELECT
    id AS document_id,
    parent_id AS related_id,
    'parent'::relationship_type AS relationship_type,
    jsonb_build_object('migrated_from', 'parent_id', 'migrated_at', NOW())
  FROM documents
  WHERE parent_id IS NOT NULL
  ON CONFLICT (document_id, related_id, relationship_type) DO NOTHING;

  -- Copy project_id relationships (only if column exists)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'documents' AND column_name = 'project_id'
  ) THEN
    EXECUTE '
      INSERT INTO document_associations (document_id, related_id, relationship_type, metadata)
      SELECT
        id AS document_id,
        project_id AS related_id,
        ''project''::relationship_type AS relationship_type,
        jsonb_build_object(''migrated_from'', ''project_id'', ''migrated_at'', NOW())
      FROM documents
      WHERE project_id IS NOT NULL
      ON CONFLICT (document_id, related_id, relationship_type) DO NOTHING
    ';
  END IF;

  -- Copy sprint_id relationships (only if column exists)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'documents' AND column_name = 'sprint_id'
  ) THEN
    EXECUTE '
      INSERT INTO document_associations (document_id, related_id, relationship_type, metadata)
      SELECT
        id AS document_id,
        sprint_id AS related_id,
        ''sprint''::relationship_type AS relationship_type,
        jsonb_build_object(''migrated_from'', ''sprint_id'', ''migrated_at'', NOW())
      FROM documents
      WHERE sprint_id IS NOT NULL
      ON CONFLICT (document_id, related_id, relationship_type) DO NOTHING
    ';
  END IF;

  -- Copy program_id relationships (only if column exists)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'documents' AND column_name = 'program_id'
  ) THEN
    EXECUTE '
      INSERT INTO document_associations (document_id, related_id, relationship_type, metadata)
      SELECT
        id AS document_id,
        program_id AS related_id,
        ''program''::relationship_type AS relationship_type,
        jsonb_build_object(''migrated_from'', ''program_id'', ''migrated_at'', NOW())
      FROM documents
      WHERE program_id IS NOT NULL
      ON CONFLICT (document_id, related_id, relationship_type) DO NOTHING
    ';
  END IF;
END
$$;

-- Log migration stats
DO $$
DECLARE
  parent_migrated INTEGER;
  project_migrated INTEGER;
  sprint_migrated INTEGER;
  program_migrated INTEGER;
BEGIN
  SELECT COUNT(*) INTO parent_migrated FROM document_associations WHERE relationship_type = 'parent';
  SELECT COUNT(*) INTO project_migrated FROM document_associations WHERE relationship_type = 'project';
  SELECT COUNT(*) INTO sprint_migrated FROM document_associations WHERE relationship_type = 'sprint';
  SELECT COUNT(*) INTO program_migrated FROM document_associations WHERE relationship_type = 'program';

  RAISE NOTICE 'Migration stats: parent=%, project=%, sprint=%, program=%',
    parent_migrated, project_migrated, sprint_migrated, program_migrated;
END
$$;

-- Note: Old columns (parent_id, project_id, sprint_id, program_id) are kept for rollback safety.
-- They will be removed in a future migration after the junction table approach is validated.
