-- Backfill missing person documents for workspace members
-- This catches users who were added via admin routes that didn't create person documents
-- (Bug fix: admin.ts POST /api/admin/workspaces/:id/members was missing person doc creation)

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
