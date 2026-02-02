-- Migration: In-place document conversion with snapshots
-- Changes conversion strategy from create-new-document to update-in-place
-- Snapshots preserve previous state for undo capability

-- Create snapshots table to store document state before conversion
CREATE TABLE IF NOT EXISTS document_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,

  -- Snapshot of document state at time of conversion
  document_type VARCHAR(50) NOT NULL,
  title TEXT NOT NULL,
  properties JSONB,
  ticket_number INTEGER,  -- Preserved for issues

  -- Metadata
  snapshot_reason VARCHAR(50) NOT NULL DEFAULT 'conversion',  -- 'conversion', 'manual'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL
);

-- Index for finding snapshots by document
CREATE INDEX IF NOT EXISTS idx_document_snapshots_document_id
  ON document_snapshots(document_id);

-- Index for ordering snapshots by creation time (for undo stack)
CREATE INDEX IF NOT EXISTS idx_document_snapshots_created_at
  ON document_snapshots(document_id, created_at DESC);

-- Add conversion tracking to documents (simpler than before)
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS original_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS conversion_count INTEGER DEFAULT 0;

-- Comments for clarity
COMMENT ON TABLE document_snapshots IS 'Stores document state snapshots before type conversions for undo capability';
COMMENT ON COLUMN document_snapshots.document_type IS 'The document_type at time of snapshot';
COMMENT ON COLUMN document_snapshots.properties IS 'Full properties JSONB at time of snapshot';
COMMENT ON COLUMN document_snapshots.ticket_number IS 'Ticket number for issues (preserved across conversions)';
COMMENT ON COLUMN documents.original_type IS 'The original document_type when first created';
COMMENT ON COLUMN documents.conversion_count IS 'Number of times this document has been converted';
