-- Migration: 034_audit_log_immutability.sql
-- Purpose: Add database-level triggers to prevent UPDATE/DELETE on audit_logs
-- FedRAMP Control: AU-9 (Protection of Audit Information)
--
-- IMPORTANT LIMITATION:
-- This provides defense-in-depth against accidental modification, NOT protection
-- against malicious actors with direct database access. The application connects
-- with full DB privileges and could theoretically disable these triggers.
-- True immutability is provided by CloudWatch Logs (see cloudwatch-logs-integration).

-- Trigger function to prevent UPDATE operations
CREATE OR REPLACE FUNCTION audit_prevent_update()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit log records cannot be modified (AU-9 compliance)';
END;
$$ LANGUAGE plpgsql;

-- Trigger function to prevent DELETE operations
CREATE OR REPLACE FUNCTION audit_prevent_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit log records cannot be deleted (AU-9 compliance)';
END;
$$ LANGUAGE plpgsql;

-- Apply UPDATE prevention trigger
DROP TRIGGER IF EXISTS audit_no_update ON audit_logs;
CREATE TRIGGER audit_no_update
  BEFORE UPDATE ON audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION audit_prevent_update();

-- Apply DELETE prevention trigger
DROP TRIGGER IF EXISTS audit_no_delete ON audit_logs;
CREATE TRIGGER audit_no_delete
  BEFORE DELETE ON audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION audit_prevent_delete();

-- NOTE: TRUNCATE cannot be prevented with a row-level trigger in PostgreSQL.
-- This is accepted as TRUNCATE requires elevated privileges and is rare.
-- For production, consider revoking TRUNCATE privilege from app role.
