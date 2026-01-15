-- Archive orphaned pending person documents
-- These are pending person docs whose invite was deleted/used but the doc wasn't cleaned up
-- This can happen due to race conditions or edge cases in invite lifecycle

UPDATE documents d
SET archived_at = NOW()
FROM (
  SELECT d.id
  FROM documents d
  LEFT JOIN workspace_invites wi
    ON wi.id = (d.properties->>'invite_id')::uuid
    AND wi.used_at IS NULL
  WHERE d.document_type = 'person'
    AND d.properties->>'pending' = 'true'
    AND d.archived_at IS NULL
    AND wi.id IS NULL
) orphaned
WHERE d.id = orphaned.id;
