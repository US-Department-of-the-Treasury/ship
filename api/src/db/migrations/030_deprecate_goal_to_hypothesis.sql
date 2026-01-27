-- Migration: Deprecate goal field in favor of hypothesis
-- For sprints and projects that have goal but no hypothesis, copy goal -> hypothesis
-- This is a data migration only - the goal field remains in existing documents but is no longer used

-- Copy sprint goals to hypothesis where hypothesis is empty
UPDATE documents
SET properties = properties || jsonb_build_object('hypothesis', properties->>'goal')
WHERE document_type = 'sprint'
  AND properties->>'goal' IS NOT NULL
  AND properties->>'goal' != ''
  AND (properties->>'hypothesis' IS NULL OR properties->>'hypothesis' = '');

-- Copy project goals to hypothesis where hypothesis is empty
UPDATE documents
SET properties = properties || jsonb_build_object('hypothesis', properties->>'goal')
WHERE document_type = 'project'
  AND properties->>'goal' IS NOT NULL
  AND properties->>'goal' != ''
  AND (properties->>'hypothesis' IS NULL OR properties->>'hypothesis' = '');

-- Note: We don't remove the goal field from existing documents
-- It will simply be ignored by the application code going forward
