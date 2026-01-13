-- Add last_auth_provider column to track which OAuth provider was used for login
-- Values: 'fpki_validator', 'caia', null (legacy/unknown)

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_auth_provider VARCHAR(50);

-- Add index for potential analytics queries
CREATE INDEX IF NOT EXISTS idx_users_last_auth_provider ON users(last_auth_provider) WHERE last_auth_provider IS NOT NULL;

-- Update existing PIV users to 'fpki_validator' if they have x509_subject_dn
-- This is a best-effort backfill - users who logged in via PIV before this migration
UPDATE users SET last_auth_provider = 'fpki_validator' WHERE x509_subject_dn IS NOT NULL AND last_auth_provider IS NULL;
