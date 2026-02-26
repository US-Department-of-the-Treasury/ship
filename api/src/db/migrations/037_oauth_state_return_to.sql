-- Add return_to column to oauth_state table
-- Preserves the user's original URL through the OAuth flow
ALTER TABLE oauth_state ADD COLUMN IF NOT EXISTS return_to TEXT;
