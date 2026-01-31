-- Migration 039: Add audit log archival support for 30-month retention (AU-11)
--
-- This adds:
-- 1. archived_at column to track when records were archived to S3
-- 2. archive_checkpoint table to maintain hash chain continuity after archival
--
-- Architecture:
-- - CloudWatch Logs (1096 days) is the authoritative store for AU-9/AU-11 compliance
-- - PostgreSQL retains 12 months for fast queries
-- - Records older than 12 months are archived to S3 then deleted from PostgreSQL
-- - archive_checkpoint stores the last archived record's hash to maintain chain continuity

-- Add archived_at column (NULL = not archived)
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Create index for efficient archival queries (find records older than X months)
-- Note: partial index on archived_at IS NULL
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at_archival
ON audit_logs (created_at)
WHERE archived_at IS NULL;

-- Drop archive_checkpoint if it exists with wrong schema (from failed migration)
DROP TABLE IF EXISTS archive_checkpoint CASCADE;

-- Archive checkpoint table
-- Stores the last record's hash before archival to maintain chain continuity
CREATE TABLE archive_checkpoint (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Reference to last archived record for traceability
  last_record_id UUID NOT NULL,
  last_record_created_at TIMESTAMPTZ NOT NULL,

  -- Hash chain continuity: new records link to this hash after archival
  last_record_hash CHAR(64) NOT NULL,

  -- Metadata about the archive batch
  records_archived INTEGER NOT NULL,
  archive_location TEXT, -- S3 URI
  archive_checksum TEXT, -- SHA-256 of archive file

  -- Workspace scope (NULL = cross-workspace archive)
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,

  -- Audit trail
  created_by UUID REFERENCES users(id) ON DELETE SET NULL
);

-- Index for looking up latest checkpoint per workspace
CREATE INDEX IF NOT EXISTS idx_archive_checkpoint_workspace
ON archive_checkpoint (workspace_id, archived_at DESC);

-- Update verify_audit_chain to support partial chain verification
-- When first record's previous_hash != genesis, check archive_checkpoint
CREATE OR REPLACE FUNCTION verify_audit_chain(
  p_workspace_id UUID DEFAULT NULL,
  p_limit INT DEFAULT 10000
)
RETURNS TABLE (
  id UUID,
  is_valid BOOLEAN,
  error_message TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
  rec RECORD;
  prev_hash CHAR(64);
  computed_hash CHAR(64);
  hash_input TEXT;
  first_record BOOLEAN := TRUE;
  records_checked INT := 0;
  genesis_hash CHAR(64) := REPEAT('0', 64);
BEGIN
  -- Iterate through audit logs in order
  FOR rec IN
    SELECT al.*
    FROM audit_logs al
    WHERE (p_workspace_id IS NULL OR al.workspace_id = p_workspace_id)
    ORDER BY al.created_at ASC, al.id ASC
    LIMIT p_limit
  LOOP
    records_checked := records_checked + 1;

    IF first_record THEN
      first_record := FALSE;

      -- For first record, check if it starts with genesis or links to archive
      IF rec.previous_hash = genesis_hash THEN
        prev_hash := genesis_hash;
      ELSE
        -- Check if previous_hash matches an archive checkpoint
        PERFORM 1 FROM archive_checkpoint ac
        WHERE ac.last_record_hash = rec.previous_hash
          AND (p_workspace_id IS NULL OR ac.workspace_id = p_workspace_id);

        IF FOUND THEN
          -- Valid: chain continues from archived records
          prev_hash := rec.previous_hash;
        ELSE
          -- Invalid: chain origin not found
          id := rec.id;
          is_valid := FALSE;
          error_message := 'Chain origin not found - previous_hash does not match genesis or archive checkpoint';
          RETURN NEXT;
          CONTINUE;
        END IF;
      END IF;
    END IF;

    -- Verify previous_hash link
    IF rec.previous_hash != prev_hash THEN
      id := rec.id;
      is_valid := FALSE;
      error_message := 'Previous hash mismatch: expected ' || prev_hash || ', got ' || rec.previous_hash;
      RETURN NEXT;
      prev_hash := rec.record_hash;
      CONTINUE;
    END IF;

    -- Compute expected hash
    hash_input := rec.previous_hash || '|' ||
                  to_char(rec.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || '|' ||
                  COALESCE(rec.actor_user_id::TEXT, '') || '|' ||
                  rec.action || '|' ||
                  COALESCE(rec.resource_type, '') || '|' ||
                  COALESCE(rec.resource_id::TEXT, '') || '|' ||
                  COALESCE(rec.workspace_id::TEXT, '');

    computed_hash := encode(sha256(hash_input::bytea), 'hex');

    -- Verify record hash
    IF rec.record_hash != computed_hash THEN
      id := rec.id;
      is_valid := FALSE;
      error_message := 'Record hash mismatch: expected ' || computed_hash || ', got ' || rec.record_hash;
      RETURN NEXT;
    END IF;

    prev_hash := rec.record_hash;
  END LOOP;

  -- If no errors were found, return nothing (empty result = success)
  RETURN;
END;
$$;

-- Add comment explaining the archival architecture
COMMENT ON TABLE archive_checkpoint IS
  'Maintains hash chain continuity after audit log archival. '
  'When records are archived from PostgreSQL to S3, the last record''s hash is stored here. '
  'New audit log entries will have previous_hash linking to this checkpoint. '
  'verify_audit_chain() checks archive_checkpoint when validating partial chains.';

COMMENT ON COLUMN audit_logs.archived_at IS
  'Timestamp when this record was archived to S3. NULL means not yet archived. '
  'Records with archived_at set are candidates for deletion from PostgreSQL.';
