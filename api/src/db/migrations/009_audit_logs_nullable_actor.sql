-- Migration: Allow NULL actor_user_id in audit_logs
-- Purpose: Support logging failed login attempts where the user is unknown
--
-- Failed login attempts (invalid credentials, state mismatch, etc.) should be
-- logged for security monitoring, but there's no user to associate them with.
-- The attempted email/identity is captured in the details JSONB column instead.

-- Drop the NOT NULL constraint and foreign key, re-add just the foreign key
ALTER TABLE audit_logs
  ALTER COLUMN actor_user_id DROP NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN audit_logs.actor_user_id IS 'User who performed the action. NULL for failed login attempts where user is unknown.';
