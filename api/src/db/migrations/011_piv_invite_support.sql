-- PIV Invite Support Migration
-- Enables inviting users by X.509 Subject DN (PIV certificate identity)
-- PIV invites don't need tokens - the certificate itself proves identity

-- Make email nullable (can invite by Subject DN only)
ALTER TABLE workspace_invites
  ALTER COLUMN email DROP NOT NULL;

-- Make token nullable (PIV invites don't need tokens)
ALTER TABLE workspace_invites
  ALTER COLUMN token DROP NOT NULL;

-- Add X.509 Subject DN column for PIV invites
ALTER TABLE workspace_invites
  ADD COLUMN IF NOT EXISTS x509_subject_dn TEXT;

-- Index for subject DN lookups during PIV callback
CREATE INDEX IF NOT EXISTS idx_workspace_invites_x509_subject_dn
  ON workspace_invites(x509_subject_dn)
  WHERE x509_subject_dn IS NOT NULL AND used_at IS NULL;

-- Add constraint: at least one identifier must be provided (email or subject DN)
ALTER TABLE workspace_invites
  ADD CONSTRAINT chk_invite_identifier
  CHECK (email IS NOT NULL OR x509_subject_dn IS NOT NULL);

-- Track PIV-specific data on users
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS x509_subject_dn TEXT,
  ADD COLUMN IF NOT EXISTS piv_first_login_at TIMESTAMPTZ;

-- Index for PIV subject lookups
CREATE INDEX IF NOT EXISTS idx_users_x509_subject_dn
  ON users(x509_subject_dn)
  WHERE x509_subject_dn IS NOT NULL;
