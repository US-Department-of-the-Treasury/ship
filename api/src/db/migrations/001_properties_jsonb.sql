-- Migration 001: Properties JSONB
-- Migrates type-specific columns to a unified properties JSONB column
-- This aligns with Ship's philosophy: "Everything is a document with properties"

-- Step 1: Add properties column if not exists
ALTER TABLE documents ADD COLUMN IF NOT EXISTS properties JSONB DEFAULT '{}';

-- Step 2: Migrate existing issue data to properties
UPDATE documents SET properties = jsonb_build_object(
  'state', COALESCE(state, 'backlog'),
  'priority', COALESCE(priority, 'medium'),
  'source', COALESCE(source, 'internal')
) || CASE WHEN assignee_id IS NOT NULL THEN jsonb_build_object('assignee_id', assignee_id::text) ELSE '{}'::jsonb END
  || CASE WHEN rejection_reason IS NOT NULL THEN jsonb_build_object('rejection_reason', rejection_reason) ELSE '{}'::jsonb END
WHERE document_type = 'issue' AND (properties IS NULL OR properties = '{}'::jsonb);

-- Step 3: Migrate existing program data to properties
UPDATE documents SET properties = jsonb_build_object(
  'prefix', prefix,
  'color', COALESCE(color, '#6366f1')
)
WHERE document_type = 'program' AND (properties IS NULL OR properties = '{}'::jsonb);

-- Step 4: Migrate existing project data to properties
UPDATE documents SET properties = jsonb_build_object(
  'prefix', prefix,
  'color', COALESCE(color, '#6366f1')
)
WHERE document_type = 'project' AND (properties IS NULL OR properties = '{}'::jsonb);

-- Step 5: Migrate existing sprint data to properties
UPDATE documents SET properties = jsonb_build_object(
  'sprint_status', COALESCE(sprint_status, 'planned')
) || CASE WHEN start_date IS NOT NULL THEN jsonb_build_object('start_date', start_date::text) ELSE '{}'::jsonb END
  || CASE WHEN end_date IS NOT NULL THEN jsonb_build_object('end_date', end_date::text) ELSE '{}'::jsonb END
  || CASE WHEN goal IS NOT NULL THEN jsonb_build_object('goal', goal) ELSE '{}'::jsonb END
WHERE document_type = 'sprint' AND (properties IS NULL OR properties = '{}'::jsonb);

-- Step 6: Ensure all other documents have empty properties object
UPDATE documents SET properties = '{}'::jsonb
WHERE properties IS NULL;

-- Step 7: Create GIN index for efficient property queries
CREATE INDEX IF NOT EXISTS idx_documents_properties ON documents USING GIN (properties);

-- Step 8: Verify migration (run these queries manually)
-- SELECT document_type, COUNT(*), COUNT(properties) as has_properties FROM documents GROUP BY document_type;
-- SELECT id, document_type, properties FROM documents LIMIT 10;

-- Step 9: Drop old columns (ONLY after verification - run manually)
-- ALTER TABLE documents
--   DROP COLUMN IF EXISTS state,
--   DROP COLUMN IF EXISTS priority,
--   DROP COLUMN IF EXISTS assignee_id,
--   DROP COLUMN IF EXISTS source,
--   DROP COLUMN IF EXISTS rejection_reason,
--   DROP COLUMN IF EXISTS prefix,
--   DROP COLUMN IF EXISTS color,
--   DROP COLUMN IF EXISTS start_date,
--   DROP COLUMN IF EXISTS end_date,
--   DROP COLUMN IF EXISTS sprint_status,
--   DROP COLUMN IF EXISTS goal;

-- Step 10: Drop old indexes (ONLY after dropping columns - run manually)
-- DROP INDEX IF EXISTS idx_documents_state;
-- DROP INDEX IF EXISTS idx_documents_source;
