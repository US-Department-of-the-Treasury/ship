-- Fix PIV Invite Migration - email is always required
-- Email is the login identifier, x509_subject_dn is just for PIV certificate matching

-- Drop the old constraint that allowed email OR subject DN
ALTER TABLE workspace_invites
  DROP CONSTRAINT IF EXISTS chk_invite_identifier;

-- Make email NOT NULL again (it's always required)
-- First update any NULL emails to a placeholder (there shouldn't be any yet)
UPDATE workspace_invites SET email = 'unknown@unknown.com' WHERE email IS NULL;

-- Now make it NOT NULL
ALTER TABLE workspace_invites
  ALTER COLUMN email SET NOT NULL;

-- x509_subject_dn remains optional - it's just for PIV certificate matching
