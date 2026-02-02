-- ==============================================
-- ORPHAN REMEDIATION SCRIPT
-- Run AFTER reviewing orphan-diagnostic.sql output
-- Uncomment specific sections based on your review
-- ==============================================

BEGIN;  -- Transaction for safety

-- ==============================================
-- FIX 1: Delete dangling associations
-- These point to non-existent documents
-- SAFE TO RUN - these are definitely broken
-- ==============================================

/*
DELETE FROM document_associations
WHERE id IN (
  SELECT da.id
  FROM document_associations da
  LEFT JOIN documents d ON da.related_id = d.id
  WHERE d.id IS NULL
);

-- Log what was deleted
SELECT 'Deleted dangling associations' AS action, COUNT(*) AS count
FROM document_associations da
LEFT JOIN documents d ON da.related_id = d.id
WHERE d.id IS NULL;
*/

-- ==============================================
-- FIX 2: Associate orphaned sprints with projects
-- Infer project from sprint's issues
-- ==============================================

/*
-- Associate sprints with projects based on their issues' projects
INSERT INTO document_associations (document_id, related_id, relationship_type, metadata)
SELECT DISTINCT
  sprint.id AS document_id,
  issue_project.related_id AS related_id,
  'project'::relationship_type AS relationship_type,
  jsonb_build_object(
    'remediation', 'orphan-remediation.sql',
    'remediated_at', NOW(),
    'source', 'inferred_from_issue_projects'
  )
FROM documents sprint
-- Join to issues in this sprint
JOIN document_associations sprint_assoc ON sprint_assoc.related_id = sprint.id
  AND sprint_assoc.relationship_type = 'sprint'
JOIN documents issue ON issue.id = sprint_assoc.document_id
  AND issue.document_type = 'issue'
-- Join to those issues' projects
JOIN document_associations issue_project ON issue_project.document_id = issue.id
  AND issue_project.relationship_type = 'project'
WHERE sprint.document_type = 'sprint'
  AND sprint.deleted_at IS NULL
  -- Only sprints without project association
  AND NOT EXISTS (
    SELECT 1 FROM document_associations da
    WHERE da.document_id = sprint.id AND da.relationship_type = 'project'
  )
ON CONFLICT (document_id, related_id, relationship_type) DO NOTHING;
*/

-- ==============================================
-- FIX 3: Associate orphaned issues with default project
-- Replace 'YOUR_DEFAULT_PROJECT_ID' with actual ID
-- ==============================================

/*
-- First, identify or create a default project
-- SELECT id, title FROM documents WHERE document_type = 'project' AND workspace_id = 'YOUR_WORKSPACE_ID';

INSERT INTO document_associations (document_id, related_id, relationship_type, metadata)
SELECT
  d.id AS document_id,
  'YOUR_DEFAULT_PROJECT_ID'::UUID AS related_id,  -- REPLACE THIS
  'project'::relationship_type AS relationship_type,
  jsonb_build_object(
    'remediation', 'orphan-remediation.sql',
    'remediated_at', NOW(),
    'source', 'assigned_to_default_project'
  )
FROM documents d
WHERE d.document_type = 'issue'
  AND d.workspace_id = 'YOUR_WORKSPACE_ID'  -- REPLACE THIS
  AND d.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM document_associations da
    WHERE da.document_id = d.id AND da.relationship_type = 'project'
  )
ON CONFLICT (document_id, related_id, relationship_type) DO NOTHING;
*/

-- ==============================================
-- FIX 4: Soft-delete orphaned issues
-- Sets deleted_at rather than hard delete
-- ==============================================

/*
UPDATE documents
SET
  deleted_at = NOW(),
  properties = properties || jsonb_build_object(
    'deleted_reason', 'orphan_remediation',
    'deleted_by_script', 'orphan-remediation.sql'
  )
WHERE document_type = 'issue'
  AND deleted_at IS NULL
  AND id IN (
    -- Specific IDs from your review
    'UUID_1',
    'UUID_2'
  );
*/

-- ==============================================
-- FIX 5: Soft-delete orphaned sprints
-- ==============================================

/*
UPDATE documents
SET
  deleted_at = NOW(),
  properties = properties || jsonb_build_object(
    'deleted_reason', 'orphan_remediation',
    'deleted_by_script', 'orphan-remediation.sql'
  )
WHERE document_type = 'sprint'
  AND deleted_at IS NULL
  AND id IN (
    -- Specific IDs from your review
    'UUID_1',
    'UUID_2'
  );
*/

-- ==============================================
-- FIX 6: Archive (not delete) old orphaned items
-- Preserves data but hides from UI
-- ==============================================

/*
UPDATE documents
SET
  archived_at = NOW()
WHERE deleted_at IS NULL
  AND archived_at IS NULL
  AND document_type IN ('issue', 'sprint')
  AND id IN (
    -- Specific IDs from your review
    'UUID_1',
    'UUID_2'
  );
*/

-- ==============================================
-- VERIFICATION QUERY
-- Run after applying fixes
-- ==============================================

SELECT
  'Remaining orphaned issues' AS check,
  COUNT(*) AS count
FROM documents d
WHERE d.document_type = 'issue'
  AND d.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM document_associations da
    WHERE da.document_id = d.id AND da.relationship_type = 'project'
  )
UNION ALL
SELECT
  'Remaining orphaned sprints' AS check,
  COUNT(*) AS count
FROM documents d
WHERE d.document_type = 'sprint'
  AND d.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM document_associations da
    WHERE da.document_id = d.id AND da.relationship_type = 'project'
  )
UNION ALL
SELECT
  'Remaining dangling associations' AS check,
  COUNT(*) AS count
FROM document_associations da
LEFT JOIN documents d ON da.related_id = d.id
WHERE d.id IS NULL;

-- Uncomment to commit, or leave as-is to rollback
-- COMMIT;
ROLLBACK;  -- Safety: rolls back by default
