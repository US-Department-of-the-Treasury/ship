-- Fix duplicate users with same email but different casing
-- The PIV certificate email can have different casing than what was originally created
--
-- BACKGROUND:
-- Duplicate users can occur when:
--   1. A user is invited with email "sean.mcbride@treasury.gov"
--   2. They log in via PIV, and certificate contains "Sean.McBride@treasury.gov"
--   3. If email lookup wasn't case-insensitive, a second user record was created
--
-- CURRENT APPROACH:
-- Delete the duplicate user that has no workspace memberships (the "orphan").
-- This is a quick fix but has limitations - it assumes the user without memberships
-- is always the "wrong" one.
--
-- RECOMMENDED FUTURE IMPROVEMENT:
-- Instead of deleting duplicates, MERGE them:
--   1. Identify the "canonical" user (has memberships, is_super_admin, or oldest)
--   2. Transfer all foreign key references from duplicate to canonical:
--      - workspace_memberships
--      - sessions
--      - document_history.changed_by
--      - audit_events.actor_user_id
--      - documents.created_by (if exists)
--   3. Update canonical user's email to match PIV certificate casing
--   4. Then delete the duplicate
--
-- FUTURE CONSIDERATION:
-- Treasury users may have multiple email addresses (e.g., role-based emails,
-- contractor emails, or emails from different Treasury bureaus). A future
-- enhancement could support multiple emails per user via a user_emails table:
--   CREATE TABLE user_emails (
--     user_id UUID REFERENCES users(id),
--     email TEXT NOT NULL,
--     is_primary BOOLEAN DEFAULT false,
--     verified_at TIMESTAMPTZ,
--     UNIQUE(LOWER(email))
--   );
-- This would allow PIV login to match any of a user's registered emails.

-- Delete users that have no workspace memberships AND are duplicates (same email, different case)
-- Keep the user that has workspace memberships or is_super_admin
DELETE FROM users u1
WHERE u1.id IN (
  SELECT u2.id FROM users u2
  WHERE EXISTS (
    -- There's another user with the same email (case-insensitive)
    SELECT 1 FROM users u3
    WHERE u3.id != u2.id
    AND LOWER(u3.email) = LOWER(u2.email)
  )
  -- And this user has no workspace memberships
  AND NOT EXISTS (
    SELECT 1 FROM workspace_memberships wm WHERE wm.user_id = u2.id
  )
  -- And this user is not a super admin
  AND u2.is_super_admin = false
);

-- Also delete any sessions for users that no longer exist
DELETE FROM sessions WHERE user_id NOT IN (SELECT id FROM users);

-- Add a unique constraint on lowercase email to prevent future duplicates
-- First, create a unique index (this is the proper way for case-insensitive uniqueness)
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique ON users (LOWER(email));
