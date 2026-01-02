-- Migration 001: Properties JSONB
-- Ensures properties column and index exist
-- NOTE: Production was created fresh with this schema, no legacy data migration needed

-- Ensure properties column exists with default
ALTER TABLE documents ADD COLUMN IF NOT EXISTS properties JSONB DEFAULT '{}';

-- Ensure all documents have a properties object (not NULL)
UPDATE documents SET properties = '{}'::jsonb WHERE properties IS NULL;

-- Create GIN index for efficient property queries
CREATE INDEX IF NOT EXISTS idx_documents_properties ON documents USING GIN (properties);
