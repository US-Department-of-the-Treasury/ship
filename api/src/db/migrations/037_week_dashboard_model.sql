-- Migration 037: Week Dashboard Model Changes
--
-- Changes the data model for weekly plans, retros, and standups:
-- 1. Weekly plans become per-person-per-week (project_id no longer required)
-- 2. Weekly retros become per-person-per-week (project_id no longer required)
-- 3. Standups become standalone per user+date (no longer require sprint parent_id)
--
-- For existing data with multiple plans/retros per person+week (from different projects),
-- keep the most recently updated one and archive the rest.

-- Step 1: Deduplicate weekly_plan documents
-- For each person_id + week_number combo, keep the most recently updated plan
-- and archive the rest
WITH ranked_plans AS (
  SELECT
    id,
    properties->>'person_id' AS person_id,
    (properties->>'week_number')::int AS week_number,
    ROW_NUMBER() OVER (
      PARTITION BY properties->>'person_id', (properties->>'week_number')::int
      ORDER BY updated_at DESC
    ) AS rn
  FROM documents
  WHERE document_type = 'weekly_plan'
    AND deleted_at IS NULL
    AND archived_at IS NULL
)
UPDATE documents
SET archived_at = NOW()
WHERE id IN (
  SELECT id FROM ranked_plans WHERE rn > 1
);

-- Step 2: Deduplicate weekly_retro documents (same logic)
WITH ranked_retros AS (
  SELECT
    id,
    properties->>'person_id' AS person_id,
    (properties->>'week_number')::int AS week_number,
    ROW_NUMBER() OVER (
      PARTITION BY properties->>'person_id', (properties->>'week_number')::int
      ORDER BY updated_at DESC
    ) AS rn
  FROM documents
  WHERE document_type = 'weekly_retro'
    AND deleted_at IS NULL
    AND archived_at IS NULL
)
UPDATE documents
SET archived_at = NOW()
WHERE id IN (
  SELECT id FROM ranked_retros WHERE rn > 1
);

-- Step 3: Remove document_associations linking plans/retros to projects
-- These are no longer the primary association mechanism
DELETE FROM document_associations
WHERE document_id IN (
  SELECT id FROM documents
  WHERE document_type IN ('weekly_plan', 'weekly_retro')
    AND deleted_at IS NULL
)
AND relationship_type = 'project';

-- Step 4: Backfill date field on existing standup documents
-- Derive date from created_at timestamp
UPDATE documents
SET properties = properties || jsonb_build_object('date', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'))
WHERE document_type = 'standup'
  AND deleted_at IS NULL
  AND (properties->>'date') IS NULL;
