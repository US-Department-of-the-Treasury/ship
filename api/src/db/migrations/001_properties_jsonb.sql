-- Migration 001: Properties JSONB
-- Migrates type-specific columns to a unified properties JSONB column
-- This aligns with Ship's philosophy: "Everything is a document with properties"
--
-- IDEMPOTENT: This migration handles both:
-- - Old databases with state/priority/etc columns (migrates data to properties)
-- - New databases with only properties column (no-op, just ensures index)

-- Ensure properties column exists with default
ALTER TABLE documents ADD COLUMN IF NOT EXISTS properties JSONB DEFAULT '{}';

-- Step 2-5: Migrate existing data from old columns IF they exist
-- We use DO blocks to conditionally run migrations only when old columns are present
DO $$
BEGIN
  -- Only migrate if the old 'state' column exists (indicates old schema)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'documents' AND column_name = 'state'
  ) THEN
    -- Migrate issue data
    UPDATE documents SET properties = jsonb_build_object(
      'state', COALESCE(state, 'backlog'),
      'priority', COALESCE(priority, 'medium'),
      'source', COALESCE(source, 'internal')
    ) || CASE WHEN assignee_id IS NOT NULL THEN jsonb_build_object('assignee_id', assignee_id::text) ELSE '{}'::jsonb END
      || CASE WHEN rejection_reason IS NOT NULL THEN jsonb_build_object('rejection_reason', rejection_reason) ELSE '{}'::jsonb END
    WHERE document_type = 'issue' AND (properties IS NULL OR properties = '{}'::jsonb);
  END IF;

  -- Only migrate if the old 'prefix' column exists
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'documents' AND column_name = 'prefix'
  ) THEN
    -- Migrate program data
    UPDATE documents SET properties = jsonb_build_object(
      'prefix', prefix,
      'color', COALESCE(color, '#6366f1')
    )
    WHERE document_type = 'program' AND (properties IS NULL OR properties = '{}'::jsonb);

    -- Migrate project data
    UPDATE documents SET properties = jsonb_build_object(
      'prefix', prefix,
      'color', COALESCE(color, '#6366f1')
    )
    WHERE document_type = 'project' AND (properties IS NULL OR properties = '{}'::jsonb);
  END IF;

  -- Only migrate if the old 'sprint_status' column exists
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'documents' AND column_name = 'sprint_status'
  ) THEN
    -- Migrate sprint data
    UPDATE documents SET properties = jsonb_build_object(
      'sprint_status', COALESCE(sprint_status, 'planned')
    ) || CASE WHEN start_date IS NOT NULL THEN jsonb_build_object('start_date', start_date::text) ELSE '{}'::jsonb END
      || CASE WHEN end_date IS NOT NULL THEN jsonb_build_object('end_date', end_date::text) ELSE '{}'::jsonb END
      || CASE WHEN goal IS NOT NULL THEN jsonb_build_object('goal', goal) ELSE '{}'::jsonb END
    WHERE document_type = 'sprint' AND (properties IS NULL OR properties = '{}'::jsonb);
  END IF;
END $$;

-- Step 6: Ensure all documents have a properties object (works for both old and new schemas)
UPDATE documents SET properties = '{}'::jsonb
WHERE properties IS NULL;

-- Step 7: Create GIN index for efficient property queries
CREATE INDEX IF NOT EXISTS idx_documents_properties ON documents USING GIN (properties);
