-- Fix duplicate users with same email but different casing
-- The PIV certificate email can have different casing than what was originally created

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
