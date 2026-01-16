-- Migration: Associate existing sprints with projects
-- Sprints now belong to projects via the junction table.
-- This migration creates associations based on the issues in each sprint.

-- For each sprint, find the projects of its issues and create associations
INSERT INTO document_associations (document_id, related_id, relationship_type, metadata)
SELECT DISTINCT
  sprint.id AS document_id,
  issue.project_id AS related_id,
  'project'::relationship_type AS relationship_type,
  jsonb_build_object(
    'migrated_from', 'sprint_issue_project_id',
    'migrated_at', NOW(),
    'migration', '022_sprint_project_associations'
  )
FROM documents sprint
JOIN documents issue ON issue.sprint_id = sprint.id
  AND issue.document_type = 'issue'
  AND issue.project_id IS NOT NULL
WHERE sprint.document_type = 'sprint'
ON CONFLICT (document_id, related_id, relationship_type) DO NOTHING;

-- Log migration stats
DO $$
DECLARE
  sprint_project_associations INTEGER;
  sprints_with_projects INTEGER;
  projectless_sprints INTEGER;
BEGIN
  -- Count associations created
  SELECT COUNT(*) INTO sprint_project_associations
  FROM document_associations
  WHERE relationship_type = 'project'
    AND document_id IN (SELECT id FROM documents WHERE document_type = 'sprint');

  -- Count sprints that now have project associations
  SELECT COUNT(DISTINCT document_id) INTO sprints_with_projects
  FROM document_associations
  WHERE relationship_type = 'project'
    AND document_id IN (SELECT id FROM documents WHERE document_type = 'sprint');

  -- Count sprints without any project association (projectless)
  SELECT COUNT(*) INTO projectless_sprints
  FROM documents d
  WHERE d.document_type = 'sprint'
    AND NOT EXISTS (
      SELECT 1 FROM document_associations da
      WHERE da.document_id = d.id AND da.relationship_type = 'project'
    );

  RAISE NOTICE 'Sprint-project migration stats: associations=%, sprints_with_projects=%, projectless_sprints=%',
    sprint_project_associations, sprints_with_projects, projectless_sprints;
END
$$;

-- Note: Sprints can belong to multiple projects (if issues span projects) or no project (projectless).
-- Sprint numbering is now per-project, tracked via the junction table.
