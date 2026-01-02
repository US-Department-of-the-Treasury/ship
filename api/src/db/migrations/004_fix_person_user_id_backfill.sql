-- Migration 004: Fix person document user_id backfill
-- Re-backfills person documents with user_id from workspace memberships
-- This fixes the case where migration 002 ran before person documents had proper data

-- Step 1: Backfill person documents by matching user name to person document title
-- This handles the case where person_document_id column no longer exists
DO $$
BEGIN
  -- Update person documents where properties.user_id is missing or empty
  -- Match by user name (person document title should match user's name)
  UPDATE documents d
  SET properties = d.properties || jsonb_build_object(
    'user_id', u.id::text,
    'email', u.email
  )
  FROM users u
  JOIN workspace_memberships wm ON wm.user_id = u.id
  WHERE d.workspace_id = wm.workspace_id
    AND d.document_type = 'person'
    AND d.title = u.name
    AND (d.properties->>'user_id' IS NULL OR d.properties->>'user_id' = '');

  -- Also try matching by email in properties (fallback)
  UPDATE documents d
  SET properties = d.properties || jsonb_build_object(
    'user_id', u.id::text
  )
  FROM users u
  JOIN workspace_memberships wm ON wm.user_id = u.id
  WHERE d.workspace_id = wm.workspace_id
    AND d.document_type = 'person'
    AND d.properties->>'email' = u.email
    AND (d.properties->>'user_id' IS NULL OR d.properties->>'user_id' = '');
END $$;

-- Step 2: Log the results for verification
DO $$
DECLARE
  total_person_docs INTEGER;
  docs_with_user_id INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_person_docs FROM documents WHERE document_type = 'person';
  SELECT COUNT(*) INTO docs_with_user_id FROM documents WHERE document_type = 'person' AND properties->>'user_id' IS NOT NULL;

  RAISE NOTICE 'Person documents: % total, % with user_id', total_person_docs, docs_with_user_id;
END $$;
