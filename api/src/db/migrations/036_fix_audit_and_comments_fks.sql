-- Fix foreign key constraints for compliance and data integrity
--
-- 1. audit_logs.actor_user_id: ON DELETE CASCADE destroys audit trail when user deleted.
--    Change to SET NULL to preserve compliance-grade audit logs.
--
-- 2. comments.author_id: No ON DELETE clause blocks user deletion.
--    Change to SET NULL to allow user deletion while preserving comments.
--
-- 3. comments.workspace_id: No ON DELETE clause blocks workspace deletion.
--    Change to CASCADE to properly clean up comments with workspace.

-- Fix audit_logs: preserve audit trail when user is deleted
ALTER TABLE audit_logs
  DROP CONSTRAINT IF EXISTS audit_logs_actor_user_id_fkey,
  ADD CONSTRAINT audit_logs_actor_user_id_fkey
    FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL;

-- Fix comments.author_id: allow user deletion, preserve comments
ALTER TABLE comments
  DROP CONSTRAINT IF EXISTS comments_author_id_fkey,
  ADD CONSTRAINT comments_author_id_fkey
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL;

-- Make author_id nullable (required for SET NULL to work)
ALTER TABLE comments ALTER COLUMN author_id DROP NOT NULL;

-- Fix comments.workspace_id: cascade with workspace deletion
ALTER TABLE comments
  DROP CONSTRAINT IF EXISTS comments_workspace_id_fkey,
  ADD CONSTRAINT comments_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
