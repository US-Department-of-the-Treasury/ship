-- Migration: Mark all weekly plans and retros before Week 6 as submitted
-- Purpose: Clean up Status Overview by marking historical docs as "done"
-- Date: 2026-02-02
--
-- Week 6 starts Feb 2, 2026. All docs from weeks 1-5 should be marked submitted
-- so they show as "Done" instead of "Late" in the Status Overview.

-- Set submitted_at to a reasonable past timestamp (end of that week's period)
-- Using Jan 31, 2026 23:59:59 as a blanket "past" timestamp for all old docs
UPDATE documents
SET properties = properties || '{"submitted_at": "2026-01-31T23:59:59.000Z"}'::jsonb
WHERE document_type IN ('weekly_plan', 'weekly_retro')
  AND (properties->>'week_number')::int < 6
  AND (properties->>'submitted_at') IS NULL;
