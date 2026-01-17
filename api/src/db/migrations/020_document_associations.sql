-- Migration: Document associations junction table
-- Replaces direct relationship columns (parent_id, project_id, sprint_id, program_id)
-- with a unified associations table supporting multi-parent relationships

-- Create relationship type enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'relationship_type') THEN
    CREATE TYPE relationship_type AS ENUM ('parent', 'project', 'sprint', 'program');
  END IF;
END
$$;

-- Create the junction table
CREATE TABLE IF NOT EXISTS document_associations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  related_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  relationship_type relationship_type NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB DEFAULT '{}',

  -- Prevent duplicate associations of the same type
  CONSTRAINT unique_association UNIQUE (document_id, related_id, relationship_type),

  -- Prevent self-references
  CONSTRAINT no_self_reference CHECK (document_id != related_id)
);

-- Indexes for efficient lookups
-- Find all associations for a document (e.g., "what does this issue belong to?")
CREATE INDEX IF NOT EXISTS idx_document_associations_document_id
  ON document_associations(document_id);

-- Find all documents associated with a target (e.g., "what issues are in this project?")
CREATE INDEX IF NOT EXISTS idx_document_associations_related_id
  ON document_associations(related_id);

-- Find associations by type (e.g., "all parent relationships")
CREATE INDEX IF NOT EXISTS idx_document_associations_type
  ON document_associations(relationship_type);

-- Composite index for common query: "all issues in project X"
CREATE INDEX IF NOT EXISTS idx_document_associations_related_type
  ON document_associations(related_id, relationship_type);

-- Composite index for common query: "what projects/sprints does issue X belong to"
CREATE INDEX IF NOT EXISTS idx_document_associations_document_type
  ON document_associations(document_id, relationship_type);

-- Comments for clarity
COMMENT ON TABLE document_associations IS 'Junction table for document relationships (replaces parent_id, project_id, sprint_id, program_id columns)';
COMMENT ON COLUMN document_associations.document_id IS 'The document that has the relationship (e.g., the issue)';
COMMENT ON COLUMN document_associations.related_id IS 'The document being related to (e.g., the project or sprint)';
COMMENT ON COLUMN document_associations.relationship_type IS 'Type of relationship: parent (hierarchy), project, sprint, or program membership';
COMMENT ON COLUMN document_associations.metadata IS 'Optional metadata for the association (e.g., position, added_by)';
