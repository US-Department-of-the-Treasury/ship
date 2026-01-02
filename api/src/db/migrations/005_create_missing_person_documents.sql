-- Migration 005: Create missing person documents
-- For users who have workspace memberships but no corresponding person document
-- This handles the case where users existed before person documents were mandatory

-- Step 1: Create person documents for users who don't have one in each workspace
INSERT INTO documents (workspace_id, document_type, title, properties, created_by)
SELECT
  wm.workspace_id,
  'person',
  u.name,
  jsonb_build_object('user_id', u.id::text, 'email', u.email),
  u.id
FROM workspace_memberships wm
JOIN users u ON wm.user_id = u.id
LEFT JOIN documents d ON d.workspace_id = wm.workspace_id
  AND d.document_type = 'person'
  AND d.properties->>'user_id' = u.id::text
WHERE d.id IS NULL;

-- Step 2: Also backfill any existing person documents that might have NULL user_id
-- Match by title = user name (case-insensitive) within same workspace
UPDATE documents d
SET properties = d.properties || jsonb_build_object(
  'user_id', u.id::text,
  'email', u.email
)
FROM users u
JOIN workspace_memberships wm ON wm.user_id = u.id
WHERE d.workspace_id = wm.workspace_id
  AND d.document_type = 'person'
  AND LOWER(d.title) = LOWER(u.name)
  AND (d.properties->>'user_id' IS NULL OR d.properties->>'user_id' = '');

-- Step 3: Log results
DO $$
DECLARE
  total_memberships INTEGER;
  total_person_docs INTEGER;
  docs_with_user_id INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_memberships FROM workspace_memberships;
  SELECT COUNT(*) INTO total_person_docs FROM documents WHERE document_type = 'person';
  SELECT COUNT(*) INTO docs_with_user_id FROM documents WHERE document_type = 'person' AND properties->>'user_id' IS NOT NULL AND properties->>'user_id' != '';

  RAISE NOTICE 'Workspace memberships: %, Person documents: %, With user_id: %', total_memberships, total_person_docs, docs_with_user_id;
END $$;
