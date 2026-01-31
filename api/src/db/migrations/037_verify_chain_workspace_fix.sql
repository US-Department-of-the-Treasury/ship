-- Migration: 037_verify_chain_workspace_fix.sql
-- Purpose: Fix verify_audit_chain to handle workspace-filtered verification
--
-- When filtering by workspace, the first record in that workspace will have
-- a previous_hash pointing to a record in a different workspace (or before the test).
-- This is valid - we should only report an error if the previous_hash doesn't exist
-- anywhere (genesis, archive_checkpoint, or any existing record).

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
  prev_rec RECORD;
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

    -- For the first record in the result set, verify chain origin
    IF is_first THEN
      is_first := FALSE;

      IF rec.previous_hash != genesis_hash THEN
        -- Check if previous_hash exists somewhere valid:
        -- 1. In archive_checkpoint (for archived records)
        -- 2. In audit_logs as another record's record_hash (for workspace filtering)
        IF NOT EXISTS (
          SELECT 1 FROM archive_checkpoint WHERE last_record_hash = rec.previous_hash
        ) AND NOT EXISTS (
          SELECT 1 FROM audit_logs WHERE record_hash = rec.previous_hash
        ) THEN
          id := rec.id;
          is_valid := FALSE;
          error_message := 'Chain origin not found - missing archive checkpoint or prior record';
          RETURN NEXT;
          CONTINUE;
        END IF;
      END IF;

      expected_prev_hash := rec.previous_hash;
    ELSE
      -- For subsequent records in result set, verify they link correctly
      -- But when workspace-filtered, we may have gaps in the result
      -- So we check if the previous_hash either matches expected (from our walk)
      -- OR matches a valid record outside our filter
      IF rec.previous_hash != expected_prev_hash THEN
        -- Check if it links to a valid record we're not seeing due to filter
        IF p_workspace_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM audit_logs WHERE record_hash = rec.previous_hash
        ) THEN
          -- Valid - links to a record in another workspace
          NULL; -- Do nothing, this is OK
        ELSE
          id := rec.id;
          is_valid := FALSE;
          error_message := 'Previous hash mismatch - expected ' || expected_prev_hash || ', got ' || rec.previous_hash;
          RETURN NEXT;
        END IF;
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
