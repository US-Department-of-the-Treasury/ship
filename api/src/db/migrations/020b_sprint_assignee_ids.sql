-- Migration: Convert sprint document owner_id to assignee_ids array
-- This enables multiple people to be assigned to the same project per sprint

-- Update sprint documents that have owner_id to use assignee_ids array
UPDATE documents
SET properties = (
  properties
  - 'owner_id'  -- Remove old owner_id key
  || jsonb_build_object('assignee_ids', jsonb_build_array(properties->>'owner_id'))  -- Add as array
)
WHERE document_type = 'sprint'
  AND properties ? 'owner_id'
  AND properties->>'owner_id' IS NOT NULL;

-- For sprints that had NULL owner_id, set empty assignee_ids array
UPDATE documents
SET properties = properties || jsonb_build_object('assignee_ids', '[]'::jsonb)
WHERE document_type = 'sprint'
  AND properties ? 'owner_id'
  AND properties->>'owner_id' IS NULL;

-- Clean up any remaining owner_id keys
UPDATE documents
SET properties = properties - 'owner_id'
WHERE document_type = 'sprint'
  AND properties ? 'owner_id';
