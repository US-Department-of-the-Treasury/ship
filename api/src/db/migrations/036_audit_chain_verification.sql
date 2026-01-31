-- Migration: 036_audit_chain_verification.sql
-- Purpose: Add audit chain verification function for tamper-evidence detection
-- FedRAMP Control: AU-9(3) (Cryptographic Protection of Audit Information)
--
-- This function verifies the integrity of the audit log hash chain.
-- It can be run on-demand or scheduled for periodic verification.

-- Create archive checkpoint table for partial chain support
-- When old records are archived to CloudWatch and deleted, store the last hash here
CREATE TABLE IF NOT EXISTS archive_checkpoint (
  id SERIAL PRIMARY KEY,
  last_record_id UUID NOT NULL,
  last_record_hash CHAR(64) NOT NULL,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_count INT NOT NULL,
  archived_by TEXT NOT NULL  -- username or 'scheduled_job'
);

CREATE INDEX IF NOT EXISTS idx_archive_checkpoint_hash ON archive_checkpoint(last_record_hash);

-- Verification function that walks the hash chain
-- Returns only invalid records (empty result = all valid)
CREATE OR REPLACE FUNCTION verify_audit_chain(
  p_workspace_id UUID DEFAULT NULL,
  p_limit INT DEFAULT 10000
) RETURNS TABLE(
  id UUID,
  is_valid BOOLEAN,
  error_message TEXT
) AS $$
DECLARE
  rec RECORD;
  expected_prev_hash CHAR(64);
  computed_hash CHAR(64);
  hash_input TEXT;
  record_count INT := 0;
  is_first BOOLEAN := TRUE;
  genesis_hash CHAR(64) := REPEAT('0', 64);
BEGIN
  -- Walk the chain in order
  FOR rec IN
    SELECT
      a.id,
      a.created_at,
      a.actor_user_id,
      a.action,
      a.resource_type,
      a.resource_id,
      a.workspace_id,
      a.previous_hash,
      a.record_hash
    FROM audit_logs a
    WHERE (p_workspace_id IS NULL OR a.workspace_id = p_workspace_id)
    ORDER BY a.created_at, a.id
    LIMIT p_limit
  LOOP
    record_count := record_count + 1;

    -- For the first record, verify it links to genesis or archive checkpoint
    IF is_first THEN
      is_first := FALSE;

      IF rec.previous_hash != genesis_hash THEN
        -- Check archive_checkpoint for matching hash
        IF NOT EXISTS (
          SELECT 1 FROM archive_checkpoint
          WHERE last_record_hash = rec.previous_hash
        ) THEN
          id := rec.id;
          is_valid := FALSE;
          error_message := 'Chain origin not found - missing archive checkpoint';
          RETURN NEXT;
          CONTINUE;
        END IF;
      END IF;

      expected_prev_hash := rec.previous_hash;
    ELSE
      -- Verify previous_hash links to the prior record's record_hash
      IF rec.previous_hash != expected_prev_hash THEN
        id := rec.id;
        is_valid := FALSE;
        error_message := 'Previous hash mismatch - expected ' || expected_prev_hash || ', got ' || rec.previous_hash;
        RETURN NEXT;
      END IF;
    END IF;

    -- Compute the expected hash for this record
    -- MUST match compute_audit_record_hash exactly
    hash_input := rec.previous_hash || '|' ||
                  to_char(rec.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || '|' ||
                  COALESCE(rec.actor_user_id::TEXT, '') || '|' ||
                  rec.action || '|' ||
                  COALESCE(rec.resource_type, '') || '|' ||
                  COALESCE(rec.resource_id::TEXT, '') || '|' ||
                  COALESCE(rec.workspace_id::TEXT, '');

    computed_hash := encode(sha256(hash_input::bytea), 'hex');

    -- Verify record_hash matches computed value
    IF rec.record_hash != computed_hash THEN
      id := rec.id;
      is_valid := FALSE;
      error_message := 'Record hash mismatch - stored ' || rec.record_hash || ', computed ' || computed_hash;
      RETURN NEXT;
    END IF;

    -- Update expected_prev_hash for next iteration
    expected_prev_hash := rec.record_hash;
  END LOOP;

  RETURN;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION verify_audit_chain IS 'Verifies audit log hash chain integrity. Returns only invalid records (empty result = all valid). FedRAMP AU-9(3) compliance.';
