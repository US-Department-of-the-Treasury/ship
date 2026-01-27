-- Migration: Rename hypothesis to plan in properties JSONB
-- This migration updates all existing sprint and project documents to use 'plan'
-- instead of 'hypothesis' in their properties column.

-- Step 1: Rename 'hypothesis' -> 'plan' in sprint and project properties
UPDATE documents
SET properties = (properties - 'hypothesis') || jsonb_build_object('plan', properties->'hypothesis')
WHERE document_type IN ('sprint', 'project')
  AND properties ? 'hypothesis';

-- Step 2: Rename 'hypothesis_history' -> 'plan_history' in sprint properties
-- Also update the field name within each history entry from 'hypothesis' to 'plan'
UPDATE documents
SET properties = (properties - 'hypothesis_history') || jsonb_build_object('plan_history',
  (SELECT jsonb_agg(
    (entry - 'hypothesis') || jsonb_build_object('plan', entry->'hypothesis')
  )
  FROM jsonb_array_elements(properties->'hypothesis_history') AS entry)
)
WHERE document_type = 'sprint'
  AND properties ? 'hypothesis_history';

-- Step 3: Rename 'hypothesis_validated' -> 'plan_validated' in sprint_review and project properties
UPDATE documents
SET properties = (properties - 'hypothesis_validated') || jsonb_build_object('plan_validated', properties->'hypothesis_validated')
WHERE document_type IN ('sprint_review', 'project')
  AND properties ? 'hypothesis_validated';

-- Step 4: Rename 'hypothesis_approval' -> 'plan_approval' in sprint and project properties
UPDATE documents
SET properties = (properties - 'hypothesis_approval') || jsonb_build_object('plan_approval', properties->'hypothesis_approval')
WHERE document_type IN ('sprint', 'project')
  AND properties ? 'hypothesis_approval';
