-- Migration: Document type conversion support
-- Adds columns for tracking document conversions (issue<->project)
-- Uses create-and-reference pattern: new doc created, original archived with pointer

-- Add conversion tracking columns
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS converted_to_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS converted_from_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS converted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS converted_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Index for efficient redirect lookups (archived docs with converted_to_id)
CREATE INDEX IF NOT EXISTS idx_documents_converted_to ON documents(converted_to_id) WHERE converted_to_id IS NOT NULL;

-- Index for finding original document from converted doc
CREATE INDEX IF NOT EXISTS idx_documents_converted_from ON documents(converted_from_id) WHERE converted_from_id IS NOT NULL;

-- Comment for clarity
COMMENT ON COLUMN documents.converted_to_id IS 'Points to the new document this was converted into (set on archived original)';
COMMENT ON COLUMN documents.converted_from_id IS 'Points to the original document this was converted from (set on new doc)';
COMMENT ON COLUMN documents.converted_at IS 'Timestamp when the conversion occurred';
COMMENT ON COLUMN documents.converted_by IS 'User who performed the conversion';
