-- Migration 031: Cleanup accountability issues
--
-- With the refactor to inference-based action items, existing accountability issues
-- (source='action_items') are now orphaned. This migration cancels them to:
-- 1. Remove stale items from the UI
-- 2. Preserve history for audit purposes (not deleted)
--
-- This migration is idempotent - running multiple times has no effect.

-- Cancel all accountability issues that aren't already done/cancelled
UPDATE documents
SET
  properties = jsonb_set(properties, '{state}', '"cancelled"'),
  updated_at = NOW()
WHERE
  document_type = 'issue'
  AND properties->>'source' = 'action_items'
  AND properties->>'state' NOT IN ('done', 'cancelled')
  AND deleted_at IS NULL;

-- Log the count for visibility
DO $$
DECLARE
  cancelled_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO cancelled_count
  FROM documents
  WHERE document_type = 'issue'
    AND properties->>'source' = 'action_items'
    AND properties->>'state' = 'cancelled';

  RAISE NOTICE 'Accountability issues with state=cancelled: %', cancelled_count;
END $$;
