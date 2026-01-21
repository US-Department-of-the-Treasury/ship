-- Migration: Sync belongs_to array in properties to sprint_id/program_id/project_id columns
--
-- Problem: Issues were created with belongs_to array in properties JSONB but
-- sprint_id/program_id columns were left NULL. The issue_count subquery uses
-- the columns, not belongs_to, so sprint issue counts show 0.
--
-- Solution: Extract IDs from belongs_to array and update the columns.

-- Update sprint_id from belongs_to where type = 'sprint'
UPDATE documents d
SET sprint_id = (
  SELECT (elem->>'id')::uuid
  FROM jsonb_array_elements(d.properties->'belongs_to') elem
  WHERE elem->>'type' = 'sprint'
  LIMIT 1
)
WHERE d.document_type = 'issue'
  AND d.sprint_id IS NULL
  AND d.properties->'belongs_to' IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(d.properties->'belongs_to') elem
    WHERE elem->>'type' = 'sprint'
  );

-- Update program_id from belongs_to where type = 'program'
UPDATE documents d
SET program_id = (
  SELECT (elem->>'id')::uuid
  FROM jsonb_array_elements(d.properties->'belongs_to') elem
  WHERE elem->>'type' = 'program'
  LIMIT 1
)
WHERE d.document_type = 'issue'
  AND d.program_id IS NULL
  AND d.properties->'belongs_to' IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(d.properties->'belongs_to') elem
    WHERE elem->>'type' = 'program'
  );

-- Update project_id from belongs_to where type = 'project'
UPDATE documents d
SET project_id = (
  SELECT (elem->>'id')::uuid
  FROM jsonb_array_elements(d.properties->'belongs_to') elem
  WHERE elem->>'type' = 'project'
  LIMIT 1
)
WHERE d.document_type = 'issue'
  AND d.project_id IS NULL
  AND d.properties->'belongs_to' IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(d.properties->'belongs_to') elem
    WHERE elem->>'type' = 'project'
  );

-- Log the sync results
DO $$
DECLARE
  synced_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO synced_count
  FROM documents
  WHERE document_type = 'issue'
    AND (sprint_id IS NOT NULL OR program_id IS NOT NULL OR project_id IS NOT NULL)
    AND properties->'belongs_to' IS NOT NULL;

  RAISE NOTICE 'Synced belongs_to to columns for % issues', synced_count;
END $$;
