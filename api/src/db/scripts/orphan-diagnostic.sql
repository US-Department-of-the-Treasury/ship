-- ==============================================
-- ORPHAN DIAGNOSTIC REPORT
-- Post-migration 027 (document_associations)
-- Run against production database for manual review
-- ==============================================

-- Create temp table to store results for easy export
CREATE TEMPORARY TABLE IF NOT EXISTS orphan_report (
  category TEXT,
  entity_type TEXT,
  entity_id UUID,
  entity_title TEXT,
  workspace_id UUID,
  created_at TIMESTAMPTZ,
  additional_info JSONB
);

-- Clear previous results
TRUNCATE orphan_report;

-- ==============================================
-- 1. DANGLING ASSOCIATIONS (Critical)
-- Associations pointing to deleted documents
-- ==============================================
INSERT INTO orphan_report
SELECT
  'CRITICAL: Dangling Association' AS category,
  'association' AS entity_type,
  da.id AS entity_id,
  'Association to deleted ' || da.relationship_type::TEXT AS entity_title,
  d.workspace_id,
  da.created_at,
  jsonb_build_object(
    'document_id', da.document_id,
    'document_title', d.title,
    'document_type', d.document_type,
    'related_id', da.related_id,
    'relationship_type', da.relationship_type,
    'action_recommended', 'DELETE association'
  )
FROM document_associations da
JOIN documents d ON da.document_id = d.id
LEFT JOIN documents d2 ON da.related_id = d2.id
WHERE d2.id IS NULL;

-- ==============================================
-- 2. ISSUES WITHOUT PROJECT (Review needed)
-- May be intentional (unassigned) or migration gap
-- ==============================================
INSERT INTO orphan_report
SELECT
  'REVIEW: Issue without Project' AS category,
  'issue' AS entity_type,
  d.id,
  d.title,
  d.workspace_id,
  d.created_at,
  jsonb_build_object(
    'state', d.properties->>'state',
    'priority', d.properties->>'priority',
    'archived', d.archived_at IS NOT NULL,
    'has_sprint', EXISTS (
      SELECT 1 FROM document_associations da
      WHERE da.document_id = d.id AND da.relationship_type = 'sprint'
    ),
    'has_program', d.program_id IS NOT NULL,
    'program_id', d.program_id,
    'action_recommended', 'Assign to project or archive'
  )
FROM documents d
WHERE d.document_type = 'issue'
  AND d.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM document_associations da
    WHERE da.document_id = d.id AND da.relationship_type = 'project'
  );

-- ==============================================
-- 3. SPRINTS WITHOUT PROJECT (Review needed)
-- Migration 022 may have missed some
-- ==============================================
INSERT INTO orphan_report
SELECT
  'REVIEW: Sprint without Project' AS category,
  'sprint' AS entity_type,
  d.id,
  d.title,
  d.workspace_id,
  d.created_at,
  jsonb_build_object(
    'sprint_status', d.properties->>'sprint_status',
    'start_date', d.properties->>'start_date',
    'end_date', d.properties->>'end_date',
    'has_program', d.program_id IS NOT NULL,
    'program_id', d.program_id,
    'issue_count', (
      SELECT COUNT(*) FROM document_associations da
      JOIN documents issue ON da.document_id = issue.id
      WHERE da.related_id = d.id
        AND da.relationship_type = 'sprint'
        AND issue.document_type = 'issue'
    ),
    'action_recommended', 'Associate with project or archive if empty'
  )
FROM documents d
WHERE d.document_type = 'sprint'
  AND d.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM document_associations da
    WHERE da.document_id = d.id AND da.relationship_type = 'project'
  );

-- ==============================================
-- 4. PROJECTS WITHOUT PROGRAM
-- May be intentional (standalone projects)
-- ==============================================
INSERT INTO orphan_report
SELECT
  'INFO: Project without Program' AS category,
  'project' AS entity_type,
  d.id,
  d.title,
  d.workspace_id,
  d.created_at,
  jsonb_build_object(
    'prefix', d.properties->>'prefix',
    'color', d.properties->>'color',
    'issue_count', (
      SELECT COUNT(*) FROM document_associations da
      JOIN documents issue ON da.document_id = issue.id
      WHERE da.related_id = d.id
        AND da.relationship_type = 'project'
        AND issue.document_type = 'issue'
    ),
    'sprint_count', (
      SELECT COUNT(*) FROM document_associations da
      JOIN documents sprint ON da.document_id = sprint.id
      WHERE da.related_id = d.id
        AND da.relationship_type = 'project'
        AND sprint.document_type = 'sprint'
    ),
    'action_recommended', 'May be intentional - review'
  )
FROM documents d
WHERE d.document_type = 'project'
  AND d.deleted_at IS NULL
  AND d.program_id IS NULL;

-- ==============================================
-- SUMMARY OUTPUT
-- ==============================================
\echo '=========================================='
\echo 'ORPHAN DIAGNOSTIC SUMMARY'
\echo '=========================================='

SELECT
  category,
  COUNT(*) AS count
FROM orphan_report
GROUP BY category
ORDER BY
  CASE
    WHEN category LIKE 'CRITICAL%' THEN 1
    WHEN category LIKE 'REVIEW%' THEN 2
    ELSE 3
  END,
  category;

\echo ''
\echo '=========================================='
\echo 'CRITICAL ITEMS (Require immediate action)'
\echo '=========================================='

SELECT
  entity_id,
  entity_title,
  additional_info->>'action_recommended' AS action
FROM orphan_report
WHERE category LIKE 'CRITICAL%'
ORDER BY created_at;

\echo ''
\echo '=========================================='
\echo 'REVIEW ITEMS (By workspace)'
\echo '=========================================='

SELECT
  w.name AS workspace_name,
  category,
  COUNT(*) AS count
FROM orphan_report o
LEFT JOIN workspaces w ON o.workspace_id = w.id
GROUP BY w.name, category
ORDER BY w.name, category;

\echo ''
\echo '=========================================='
\echo 'DETAILED REPORT'
\echo '=========================================='

SELECT
  category,
  entity_type,
  entity_id,
  entity_title,
  created_at,
  additional_info
FROM orphan_report
ORDER BY
  CASE
    WHEN category LIKE 'CRITICAL%' THEN 1
    WHEN category LIKE 'REVIEW%' THEN 2
    ELSE 3
  END,
  category,
  created_at;

-- ==============================================
-- EXPORT TO JSON (optional)
-- Uncomment to get JSON export
-- ==============================================
-- \t on
-- \o /tmp/orphan_report.json
-- SELECT json_agg(row_to_json(orphan_report)) FROM orphan_report;
-- \o
-- \t off
