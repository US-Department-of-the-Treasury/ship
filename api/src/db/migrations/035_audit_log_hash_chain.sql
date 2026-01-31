-- Migration: 035_audit_log_hash_chain.sql
-- Purpose: Add cryptographic hash chain to audit_logs for tamper-evidence
-- FedRAMP Control: AU-9(3) (Cryptographic Protection of Audit Information)
--
-- The hash chain provides tamper-evidence: if any record is modified or deleted,
-- the chain breaks and can be detected by verification.
--
-- HASH ALGORITHM (CRITICAL - must match verify_audit_chain exactly):
-- hash_input := previous_hash || '|' || timestamp || '|' || actor_user_id || '|' ||
--               action || '|' || resource_type || '|' || resource_id || '|' || workspace_id
-- record_hash := SHA-256(hash_input)
-- NOTE: details JSONB is intentionally excluded to avoid serialization inconsistencies

-- Add hash chain columns
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS previous_hash CHAR(64);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS record_hash CHAR(64);

-- Create index for efficient chain traversal
CREATE INDEX IF NOT EXISTS idx_audit_logs_hash_chain ON audit_logs(created_at, id);

-- Function to compute hash for a given record
CREATE OR REPLACE FUNCTION compute_audit_record_hash(
  p_previous_hash CHAR(64),
  p_created_at TIMESTAMPTZ,
  p_actor_user_id UUID,
  p_action TEXT,
  p_resource_type TEXT,
  p_resource_id UUID,
  p_workspace_id UUID
) RETURNS CHAR(64) AS $$
DECLARE
  hash_input TEXT;
BEGIN
  -- Build deterministic hash input string
  -- Use explicit timestamp format for consistency across locales/PG versions
  hash_input := p_previous_hash || '|' ||
                to_char(p_created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || '|' ||
                COALESCE(p_actor_user_id::TEXT, '') || '|' ||
                p_action || '|' ||
                COALESCE(p_resource_type, '') || '|' ||
                COALESCE(p_resource_id::TEXT, '') || '|' ||
                COALESCE(p_workspace_id::TEXT, '');

  RETURN encode(sha256(hash_input::bytea), 'hex');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Disable immutability trigger for backfill (will be re-enabled after)
ALTER TABLE audit_logs DISABLE TRIGGER audit_no_update;

-- Backfill existing records with computed hashes
DO $$
DECLARE
  rec RECORD;
  prev_hash CHAR(64) := REPEAT('0', 64);  -- Genesis hash for first record
  computed_hash CHAR(64);
BEGIN
  -- Process records in order
  FOR rec IN
    SELECT id, created_at, actor_user_id, action, resource_type, resource_id, workspace_id
    FROM audit_logs
    ORDER BY created_at, id
  LOOP
    computed_hash := compute_audit_record_hash(
      prev_hash,
      rec.created_at,
      rec.actor_user_id,
      rec.action,
      rec.resource_type,
      rec.resource_id,
      rec.workspace_id
    );

    UPDATE audit_logs
    SET previous_hash = prev_hash, record_hash = computed_hash
    WHERE id = rec.id;

    prev_hash := computed_hash;
  END LOOP;
END;
$$;

-- Re-enable immutability trigger
ALTER TABLE audit_logs ENABLE TRIGGER audit_no_update;

-- Drop existing trigger if it exists (for re-runnable migration)
DROP TRIGGER IF EXISTS audit_hash_chain_trigger ON audit_logs;

-- Create trigger function for hash chain
CREATE OR REPLACE FUNCTION audit_hash_chain_insert()
RETURNS TRIGGER AS $$
DECLARE
  prev_hash CHAR(64);
BEGIN
  -- Acquire advisory lock to serialize hash chain inserts
  -- hashtext produces same ID for all connections to same database
  -- This ensures multi-instance safety
  PERFORM pg_advisory_xact_lock(hashtext('audit_log_chain'));

  -- Get the hash of the most recent record
  SELECT record_hash INTO prev_hash
  FROM audit_logs
  ORDER BY created_at DESC, id DESC
  LIMIT 1;

  -- Use genesis hash if no previous records
  NEW.previous_hash := COALESCE(prev_hash, REPEAT('0', 64));

  -- Compute hash for this record
  NEW.record_hash := compute_audit_record_hash(
    NEW.previous_hash,
    NEW.created_at,
    NEW.actor_user_id,
    NEW.action,
    NEW.resource_type,
    NEW.resource_id,
    NEW.workspace_id
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger BEFORE INSERT
CREATE TRIGGER audit_hash_chain_trigger
  BEFORE INSERT ON audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION audit_hash_chain_insert();

-- Add NOT NULL constraints now that all records have hashes
-- (This ensures future records must have hashes)
ALTER TABLE audit_logs ALTER COLUMN previous_hash SET NOT NULL;
ALTER TABLE audit_logs ALTER COLUMN record_hash SET NOT NULL;
