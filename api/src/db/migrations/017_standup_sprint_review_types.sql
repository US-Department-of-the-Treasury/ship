-- Migration 017: Add standup and sprint_review document types
-- Standups are comment-like entries on sprints
-- Sprint reviews are formal sprint retrospectives with hypothesis validation

-- Add 'standup' to document_type enum
DO $$ BEGIN
  ALTER TYPE document_type ADD VALUE IF NOT EXISTS 'standup';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Add 'sprint_review' to document_type enum
DO $$ BEGIN
  ALTER TYPE document_type ADD VALUE IF NOT EXISTS 'sprint_review';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
