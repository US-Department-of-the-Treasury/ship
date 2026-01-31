-- Change audit_logs FK constraints from CASCADE to SET NULL
-- This allows users to be deleted while preserving their audit trail (FedRAMP compliance)

-- Drop the existing CASCADE constraint
ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_actor_user_id_fkey;

-- Add new SET NULL constraint
-- When a user is deleted, their audit log records are preserved with NULL actor_user_id
ALTER TABLE audit_logs
  ADD CONSTRAINT audit_logs_actor_user_id_fkey
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL;
