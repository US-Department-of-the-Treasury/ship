-- Migration 002: Person/Membership Decoupling
-- Removes tight coupling between workspace_memberships and person documents
-- Person docs now link to users via properties.user_id instead of workspace_memberships.person_document_id

-- Step 1: Backfill existing person documents with properties.user_id
-- This uses the old person_document_id to find the mapping, then stores user_id in properties
UPDATE documents d
SET properties = d.properties || jsonb_build_object(
  'user_id', wm.user_id::text,
  'email', u.email
)
FROM workspace_memberships wm
JOIN users u ON wm.user_id = u.id
WHERE d.id = wm.person_document_id
  AND d.document_type = 'person'
  AND (d.properties->>'user_id' IS NULL OR d.properties->>'user_id' = '');

-- Step 2: Create index for efficient lookup by properties.user_id
-- (The GIN index on properties already exists from migration 001, but this is more specific)
CREATE INDEX IF NOT EXISTS idx_documents_person_user_id
ON documents ((properties->>'user_id'))
WHERE document_type = 'person';

-- Step 3: Drop the old coupling column
ALTER TABLE workspace_memberships DROP COLUMN IF EXISTS person_document_id;

-- Verification queries (run manually):
-- SELECT COUNT(*) FROM documents WHERE document_type = 'person' AND properties->>'user_id' IS NOT NULL;
-- SELECT d.id, d.title, d.properties->>'user_id' as user_id FROM documents d WHERE d.document_type = 'person' LIMIT 10;
