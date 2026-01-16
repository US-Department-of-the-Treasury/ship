-- Migration: Convert default 3-3-3 ICE scores to null
-- New projects now start with null ICE values. Existing projects with exactly
-- 3-3-3 are assumed to have never been intentionally set and should be migrated.

UPDATE documents
SET properties = jsonb_set(
  jsonb_set(
    jsonb_set(properties, '{impact}', 'null'),
    '{confidence}', 'null'
  ),
  '{ease}', 'null'
)
WHERE document_type = 'project'
  AND (properties->>'impact')::int = 3
  AND (properties->>'confidence')::int = 3
  AND (properties->>'ease')::int = 3;
