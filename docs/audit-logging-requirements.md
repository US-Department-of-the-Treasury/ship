# Audit Logging Requirements

**Target Compliance:** FedRAMP Moderate
**Retention Period:** 30 months (12mo active + 18mo cold storage)
**Primary Storage:** AWS CloudWatch Logs (immutable, IAM-enforced)
**Secondary Storage:** PostgreSQL append-only table with hash chain (defense-in-depth)
**Last Updated:** 2025-01-30

---

## Executive Summary

This document defines audit logging requirements for Ship to achieve FedRAMP Moderate compliance and support SOC integration for security investigations. The implementation follows NIST SP 800-53 Rev 5 AU (Audit and Accountability) controls, OMB M-21-31 logging requirements, and Zero Trust principles from NIST SP 800-207.

**Key Goals:**
1. Track who accesses what documents and when (leak investigation capability)
2. Maintain immutable, tamper-evident audit trail
3. Enable SOC integration for security monitoring
4. Meet FedRAMP Moderate baseline requirements

---

## 1. Applicable Standards and Controls

### 1.1 NIST SP 800-53 Rev 5 - AU Control Family

FedRAMP Moderate requires 16 AU controls. Implementation status tracked below.

| Control | Name | Requirement | Implemented |
|---------|------|-------------|-------------|
| **AU-1** | Policy and Procedures | Document audit policy | ☐ |
| **AU-2** | Event Logging | Define auditable events | ☐ |
| **AU-3** | Content of Audit Records | Minimum required fields | ☐ |
| **AU-3(1)** | Additional Audit Information | Extended context fields | ☐ |
| **AU-4** | Audit Log Storage Capacity | Sufficient storage allocation | ☐ |
| **AU-5** | Response to Audit Failures | Alert on logging failures | ☐ |
| **AU-6** | Audit Review and Analysis | Regular log review process | ☐ |
| **AU-6(1)** | Automated Process Integration | SIEM/SOC integration | ☐ |
| **AU-6(3)** | Correlate Audit Records | Cross-system correlation | ☐ |
| **AU-7** | Audit Reduction and Reporting | Query and export capabilities | ☐ |
| **AU-7(1)** | Automatic Processing | Automated report generation | ☐ |
| **AU-8** | Time Stamps | Synchronized, formatted timestamps | ☐ |
| **AU-9** | Protection of Audit Information | Immutable, access-controlled | ☐ |
| **AU-9(4)** | Access by Subset of Privileged Users | Role-based audit access | ☐ |
| **AU-11** | Audit Record Retention | 30-month retention | ☐ |
| **AU-12** | Audit Record Generation | System generates required events | ☐ |

### 1.2 OMB M-21-31 Requirements

Federal logging maturity target: **EL2 (Intermediate)**

| Requirement | Description | Implemented |
|-------------|-------------|-------------|
| Log forwarding | Near real-time to centralized system | ☐ |
| Retention | 12mo active + 18mo cold = 30mo total | ☐ |
| Timestamp format | ISO 8601 with millisecond precision | ☐ |
| Unique event ID | Correlation identifier per event | ☐ |
| Integrity protection | Hash chain or equivalent | ☐ |

### 1.3 Zero Trust Logging (NIST SP 800-207)

| Requirement | Description | Implemented |
|-------------|-------------|-------------|
| Policy decisions | Log every access grant/deny | ☐ |
| Session context | Track authentication throughout session | ☐ |
| Resource access | Log all document/resource interactions | ☐ |

---

## 2. Events to Log (AU-2)

### 2.1 Authentication Events (CRITICAL)

| Event Type | Description | Priority |
|------------|-------------|----------|
| `AUTHN_LOGIN_SUCCESS` | Successful user login | Critical |
| `AUTHN_LOGIN_FAILURE` | Failed login attempt | Critical |
| `AUTHN_LOGOUT` | User logout (explicit or timeout) | High |
| `AUTHN_SESSION_TIMEOUT` | Session expired due to inactivity | High |
| `AUTHN_SESSION_START` | New session created | High |
| `AUTHN_PIV_SUCCESS` | PIV/CAC authentication success | Critical |
| `AUTHN_PIV_FAILURE` | PIV/CAC authentication failure | Critical |
| `AUTHN_MFA_CHALLENGE` | MFA challenge issued | High |
| `AUTHN_MFA_SUCCESS` | MFA verification passed | High |
| `AUTHN_MFA_FAILURE` | MFA verification failed | Critical |

### 2.2 Authorization/Access Events (CRITICAL)

| Event Type | Description | Priority |
|------------|-------------|----------|
| `AUTHZ_ACCESS_GRANTED` | Access to resource granted | High |
| `AUTHZ_ACCESS_DENIED` | Access to resource denied | Critical |
| `AUTHZ_PRIVILEGE_ESCALATION` | User elevated privileges | Critical |

### 2.3 Document Access Events (HIGH - Leak Investigation)

| Event Type | Description | Priority |
|------------|-------------|----------|
| `DATA_DOCUMENT_VIEW` | User viewed document content | High |
| `DATA_DOCUMENT_CREATE` | User created new document | High |
| `DATA_DOCUMENT_UPDATE` | User modified document | High |
| `DATA_DOCUMENT_DELETE` | User deleted document | Critical |
| `DATA_DOCUMENT_EXPORT` | User exported/downloaded document | Critical |
| `DATA_DOCUMENT_SHARE` | User shared document | High |
| `DATA_SEARCH_EXECUTED` | User performed search query | Medium |

### 2.4 Account Management Events (CRITICAL)

| Event Type | Description | Priority |
|------------|-------------|----------|
| `USER_ACCOUNT_CREATE` | New user account created | Critical |
| `USER_ACCOUNT_DELETE` | User account deleted | Critical |
| `USER_ACCOUNT_MODIFY` | User attributes changed | High |
| `USER_ROLE_CHANGE` | User role/permissions changed | Critical |
| `USER_PASSWORD_CHANGE` | Password changed | High |
| `USER_PASSWORD_RESET` | Password reset initiated | High |
| `USER_ACCOUNT_LOCK` | Account locked due to failures | Critical |
| `USER_ACCOUNT_UNLOCK` | Account unlocked | High |

### 2.5 System Events (HIGH)

| Event Type | Description | Priority |
|------------|-------------|----------|
| `SYS_STARTUP` | Application startup | High |
| `SYS_SHUTDOWN` | Application shutdown | High |
| `SYS_CONFIG_CHANGE` | Configuration modified | Critical |
| `SYS_AUDIT_CONFIG_CHANGE` | Audit settings modified | Critical |
| `SYS_ERROR` | System error occurred | High |

---

## 3. Audit Record Structure (AU-3)

### 3.1 Required Fields (NIST AU-3 Baseline)

Every audit record MUST contain these fields:

```typescript
interface AuditRecord {
  // Identity - WHO
  id: string;                    // UUID v7 (time-sortable)
  actor_id: string;              // User ID performing action
  actor_session_id: string;      // Session identifier
  actor_ip: string;              // Source IP address (IPv4/IPv6)
  actor_user_agent: string;      // Browser/client identifier

  // Event - WHAT
  event_type: string;            // Enumerated event type (see Section 2)
  event_category: string;        // auth, authz, data, user, sys
  action: string;                // Specific action verb

  // Target - ON WHAT
  resource_type: string;         // document, user, system, etc.
  resource_id: string;           // ID of affected resource
  resource_name: string;         // Human-readable resource name

  // Context - WHERE/WHEN
  timestamp: string;             // ISO 8601 with milliseconds (UTC)
  service_name: string;          // ship-api, ship-web, etc.
  hostname: string;              // Server hostname
  environment: string;           // prod, staging, dev

  // Outcome - RESULT
  outcome: 'success' | 'failure' | 'unknown';
  outcome_reason: string;        // Explanation if failed

  // Integrity
  sequence_number: bigint;       // Monotonically increasing
  previous_hash: string;         // SHA-256 of previous record
  record_hash: string;           // SHA-256 of this record
}
```

### 3.2 Extended Fields (AU-3(1) Enhancement)

Additional context for investigations:

```typescript
interface AuditRecordExtended extends AuditRecord {
  // Request context
  request_id: string;            // Unique request identifier
  trace_id: string;              // Distributed tracing ID
  http_method: string;           // GET, POST, PUT, DELETE
  http_path: string;             // URL path (no query params)
  http_status: number;           // Response status code

  // Change tracking
  old_value: object | null;      // Previous state (for updates)
  new_value: object | null;      // New state (for updates)

  // Geolocation (if available)
  geo_country: string;           // ISO country code
  geo_region: string;            // State/province

  // Duration
  duration_ms: number;           // Request processing time
}
```

### 3.3 Timestamp Format (AU-8)

All timestamps MUST use ISO 8601 extended format with:
- UTC timezone (Z suffix)
- Millisecond precision minimum
- NTP-synchronized source

```
2025-01-30T14:32:05.123Z
```

---

## 4. Immutability Requirements (AU-9)

### 4.0 External Storage via CloudWatch Logs (PRIMARY)

**Critical for FedRAMP AU-9 Compliance**: Database triggers provide defense-in-depth but do NOT satisfy AU-9 requirements because the application has full database privileges. A true FedRAMP-compliant implementation requires audit logs stored in an external system that the application cannot modify or delete.

**Solution: AWS CloudWatch Logs**

CloudWatch Logs provides true immutability via IAM:
- Application can ONLY write logs (logs:PutLogEvents, logs:CreateLogStream)
- Application CANNOT delete or modify logs (no DeleteLogGroup, DeleteLogStream permissions)
- Retention is enforced at the log group level (1096 days / 3 years - minimum CloudWatch value exceeding 30mo requirement)
- Logs are automatically replicated and durably stored by AWS

**Architecture:**
```
┌──────────────┐      ┌──────────────┐      ┌──────────────────────┐
│  Application │ ──→  │  PostgreSQL  │ ──→  │  CloudWatch Logs     │
│              │      │  audit_logs  │      │  /ship/audit-logs/*  │
└──────────────┘      └──────────────┘      └──────────────────────┘
       │                     │                        │
       │              Defense-in-depth         TRUE immutability
       │              (triggers, hash chain)   (IAM-enforced)
       └──────────────────────────────────────────────┘
                      Dual-write on insert
```

**IAM Policy for Application Role:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:log-group:/ship/audit-logs/*"
    }
  ]
}
```

Note: No `logs:Delete*` permissions means the application cannot tamper with logs.

**Failure Handling:**
- For critical events (document.create, document.delete, auth.*): Fail the request if CloudWatch push fails
- For non-critical events (document.view): Log warning and continue

### 4.1 PostgreSQL Append-Only Implementation (Defense-in-Depth)

The audit log table enforces additional immutability through database mechanisms as defense-in-depth.

**IMPORTANT LIMITATION: Role Separation**

Ship's application connects to PostgreSQL with a single database role that has full privileges (SELECT, INSERT, UPDATE, DELETE, ALTER). This means:

- The immutability triggers (`audit_no_update`, `audit_no_delete`) prevent accidental modification via normal SQL
- The triggers do NOT prevent deliberate tampering by the application (which could `ALTER TABLE ... DISABLE TRIGGER`)
- For true protection against malicious modification, database role separation would be needed:
  - App role: INSERT only on audit_logs
  - Admin role: SELECT only on audit_logs (for queries)
  - No role has UPDATE/DELETE on audit_logs

Ship does not implement role separation. The triggers are defense-in-depth, not security boundaries. CloudWatch Logs (Section 4.0) provides the true immutability required for AU-9 compliance.

**Implementation:**

#### Schema

```sql
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_number BIGSERIAL NOT NULL UNIQUE,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Actor fields
  actor_id UUID NOT NULL,
  actor_session_id UUID,
  actor_ip INET NOT NULL,
  actor_user_agent TEXT,

  -- Event fields
  event_type VARCHAR(50) NOT NULL,
  event_category VARCHAR(20) NOT NULL,
  action VARCHAR(50) NOT NULL,

  -- Target fields
  resource_type VARCHAR(50),
  resource_id UUID,
  resource_name TEXT,

  -- Context fields
  service_name VARCHAR(50) NOT NULL,
  hostname VARCHAR(255) NOT NULL,
  environment VARCHAR(20) NOT NULL,
  request_id UUID,
  trace_id UUID,

  -- Outcome fields
  outcome VARCHAR(10) NOT NULL CHECK (outcome IN ('success', 'failure', 'unknown')),
  outcome_reason TEXT,

  -- Change tracking
  old_value JSONB,
  new_value JSONB,
  metadata JSONB,

  -- Integrity fields
  previous_hash CHAR(64) NOT NULL,
  record_hash CHAR(64) NOT NULL,

  -- Indexes
  CONSTRAINT audit_log_event_type_check CHECK (event_type ~ '^[A-Z_]+$')
);

-- Indexes for common queries
CREATE INDEX idx_audit_log_timestamp ON audit_log(timestamp DESC);
CREATE INDEX idx_audit_log_actor_id ON audit_log(actor_id);
CREATE INDEX idx_audit_log_event_type ON audit_log(event_type);
CREATE INDEX idx_audit_log_resource ON audit_log(resource_type, resource_id);
CREATE INDEX idx_audit_log_session ON audit_log(actor_session_id);
```

#### Immutability Triggers

```sql
-- Prevent UPDATE operations
CREATE OR REPLACE FUNCTION prevent_audit_update()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit records cannot be modified (AU-9 compliance)';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON audit_log
  FOR EACH ROW
  EXECUTE FUNCTION prevent_audit_update();

-- Prevent DELETE operations
CREATE OR REPLACE FUNCTION prevent_audit_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit records cannot be deleted (AU-9 compliance)';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON audit_log
  FOR EACH ROW
  EXECUTE FUNCTION prevent_audit_delete();
```

#### Hash Chain Computation

```sql
-- Automatically compute hash chain on insert
CREATE OR REPLACE FUNCTION compute_audit_hash()
RETURNS TRIGGER AS $$
DECLARE
  prev_hash CHAR(64);
  hash_input TEXT;
BEGIN
  -- Get previous record's hash
  SELECT record_hash INTO prev_hash
  FROM audit_log
  ORDER BY sequence_number DESC
  LIMIT 1;

  NEW.previous_hash := COALESCE(prev_hash, REPEAT('0', 64));

  -- Compute hash of current record content
  hash_input := CONCAT_WS('|',
    NEW.previous_hash,
    NEW.timestamp::TEXT,
    NEW.actor_id::TEXT,
    NEW.event_type,
    NEW.action,
    COALESCE(NEW.resource_type, ''),
    COALESCE(NEW.resource_id::TEXT, ''),
    NEW.outcome,
    COALESCE(NEW.old_value::TEXT, ''),
    COALESCE(NEW.new_value::TEXT, '')
  );

  NEW.record_hash := encode(sha256(hash_input::bytea), 'hex');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_hash_chain
  BEFORE INSERT ON audit_log
  FOR EACH ROW
  EXECUTE FUNCTION compute_audit_hash();
```

### 4.2 Integrity Verification

Function to verify hash chain integrity:

```sql
CREATE OR REPLACE FUNCTION verify_audit_chain(
  start_seq BIGINT DEFAULT NULL,
  end_seq BIGINT DEFAULT NULL
) RETURNS TABLE (
  sequence_number BIGINT,
  is_valid BOOLEAN,
  error_message TEXT
) AS $$
DECLARE
  rec RECORD;
  prev_hash CHAR(64) := REPEAT('0', 64);
  computed_hash CHAR(64);
  hash_input TEXT;
BEGIN
  FOR rec IN
    SELECT * FROM audit_log
    WHERE (start_seq IS NULL OR audit_log.sequence_number >= start_seq)
      AND (end_seq IS NULL OR audit_log.sequence_number <= end_seq)
    ORDER BY audit_log.sequence_number
  LOOP
    -- Check previous hash link
    IF rec.previous_hash != prev_hash THEN
      sequence_number := rec.sequence_number;
      is_valid := FALSE;
      error_message := 'Previous hash mismatch';
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Recompute hash
    hash_input := CONCAT_WS('|',
      rec.previous_hash,
      rec.timestamp::TEXT,
      rec.actor_id::TEXT,
      rec.event_type,
      rec.action,
      COALESCE(rec.resource_type, ''),
      COALESCE(rec.resource_id::TEXT, ''),
      rec.outcome,
      COALESCE(rec.old_value::TEXT, ''),
      COALESCE(rec.new_value::TEXT, '')
    );

    computed_hash := encode(sha256(hash_input::bytea), 'hex');

    IF computed_hash != rec.record_hash THEN
      sequence_number := rec.sequence_number;
      is_valid := FALSE;
      error_message := 'Record hash mismatch';
      RETURN NEXT;
    END IF;

    prev_hash := rec.record_hash;
  END LOOP;

  -- Return success if no errors found
  IF NOT FOUND THEN
    sequence_number := NULL;
    is_valid := TRUE;
    error_message := 'Chain integrity verified';
    RETURN NEXT;
  END IF;
END;
$$ LANGUAGE plpgsql;
```

---

## 5. Retention Requirements (AU-11)

### 5.1 Dual-Storage Architecture

Ship uses a dual-storage architecture for audit logs:

| Storage | Purpose | Retention | Query Access |
|---------|---------|-----------|--------------|
| **CloudWatch Logs** | Compliance (authoritative) | 1096 days (3 years) | CloudWatch Insights |
| **PostgreSQL** | Fast queries | 12 months | SQL API |
| **S3 Archive** | Cold storage | 18+ months | Batch retrieval |

**Key principle:** CloudWatch Logs is the authoritative store for AU-9/AU-11 compliance.
PostgreSQL is for operational convenience only.

### 5.2 Retention Periods

Per OMB M-21-31:

| Storage Tier | Duration | Access | Format |
|--------------|----------|--------|--------|
| **Active (Hot)** | 12 months | Real-time queries | PostgreSQL + CloudWatch |
| **Cold Storage** | 18 months | Batch queries | S3 (JSONL) + CloudWatch |
| **Total** | 30 months | - | - |

### 5.3 Archival Strategy

```
Month 0-12:  PostgreSQL + CloudWatch (full queryability)
Month 13-30: CloudWatch + S3 archive (PostgreSQL records deleted)
Month 31+:   S3 archive only (CloudWatch expires at 1096 days)
```

### 5.4 Archive Process

The archive script (`scripts/archive-audit-logs.ts`) runs monthly:

```bash
# Dry run to see what would be archived
npx tsx scripts/archive-audit-logs.ts --dry-run

# Archive records older than 12 months
npx tsx scripts/archive-audit-logs.ts --months=12

# Archive specific workspace only
npx tsx scripts/archive-audit-logs.ts --workspace-id=UUID
```

**Archive workflow:**
1. Verify records exist in CloudWatch (REQUIRED before delete)
2. Export records to S3 as JSONL with SHA-256 checksum
3. Create `archive_checkpoint` record for hash chain continuity
4. Log `audit.records_archived` event
5. Delete records from PostgreSQL (in transaction)

**Hash chain continuity:** After archival, new audit records link to `archive_checkpoint.last_record_hash`.
The `verify_audit_chain()` function checks `archive_checkpoint` when validating partial chains.

### 5.5 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `CLOUDWATCH_AUDIT_LOG_GROUP` | Yes* | CloudWatch log group for verification |
| `S3_AUDIT_ARCHIVE_BUCKET` | Yes* | S3 bucket for archives |
| `AWS_REGION` | No | AWS region (default: us-east-1) |

*Required unless `--dry-run` or `--skip-cloudwatch` is specified

---

## 6. SOC Integration (AU-6)

### 6.1 Log Format for SIEM

Export logs in JSON Lines format compatible with common SIEMs:

```json
{
  "timestamp": "2025-01-30T14:32:05.123Z",
  "event_type": "DATA_DOCUMENT_VIEW",
  "event_category": "data",
  "severity": "INFO",
  "actor": {
    "id": "usr_123",
    "session_id": "sess_abc",
    "ip": "10.0.0.1"
  },
  "target": {
    "type": "document",
    "id": "doc_456",
    "name": "Q1 Budget Report"
  },
  "outcome": "success",
  "trace_id": "abc-def-123",
  "service": "ship-api",
  "environment": "prod"
}
```

### 6.2 Integration Methods

| Method | Use Case | Latency | Recommended |
|--------|----------|---------|-------------|
| **CloudWatch Logs Insights** | SOC queries via AWS console | Real-time | **Primary** |
| **CloudWatch Subscription** | Near real-time streaming to SIEM | < 1 minute | **Primary** |
| **API Pull** | On-demand investigation | On-demand | Secondary |
| **Batch Export** | Daily/hourly sync to SIEM | 1-24 hours | Secondary |

**Note**: Since audit logs are already in CloudWatch for AU-9 compliance, CloudWatch-based methods are the primary SOC integration path. This avoids additional infrastructure and provides real-time access.

### 6.3 API Endpoints

```
GET /api/audit/logs
  - Query parameters: start_date, end_date, actor_id, event_type, resource_id
  - Response: JSON Lines stream
  - Auth: Requires auditor role

GET /api/audit/export
  - Query parameters: start_date, end_date, format (json, csv, parquet)
  - Response: Downloadable file
  - Auth: Requires admin role

POST /api/audit/verify
  - Body: { start_seq, end_seq }
  - Response: Chain integrity verification result
  - Auth: Requires admin role
```

---

## 7. Access Control for Audit Logs (AU-9(4))

### 7.1 Roles

| Role | Can Write | Can Read | Can Export | Can Verify |
|------|-----------|----------|------------|------------|
| Application | Yes (automatic) | No | No | No |
| User | No | Own records only | No | No |
| Auditor | No | Yes | Yes | Yes |
| Admin | No | Yes | Yes | Yes |
| DBA | No | Schema only | No | Yes |

### 7.2 Implementation

PostgreSQL Row-Level Security:

```sql
-- Enable RLS
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;

-- Application can only INSERT
CREATE POLICY audit_insert_only ON audit_log
  FOR INSERT
  TO app_user
  WITH CHECK (true);

-- Auditors can read all
CREATE POLICY audit_read_all ON audit_log
  FOR SELECT
  TO auditor
  USING (true);

-- Users can only see their own actions
CREATE POLICY audit_read_own ON audit_log
  FOR SELECT
  TO app_user
  USING (actor_id = current_setting('app.current_user_id')::uuid);
```

---

## 8. Zero Trust Considerations

### 8.1 Per NIST SP 800-207

Zero Trust requires logging every policy decision:

| Decision Point | What to Log |
|----------------|-------------|
| Policy Engine (PE) | Every access grant/deny with full context |
| Policy Enforcement Point (PEP) | Connection lifecycle (start, active, end) |
| Continuous Authentication | Re-auth events during session |
| Behavioral Anomalies | Deviations from baseline patterns |

### 8.2 Ship Implementation

For Ship, this means logging:
- Every document access decision (not just successful accesses)
- Session validation checks
- API authorization decisions
- Cross-document navigation patterns

---

## 9. Alerting Requirements (AU-5)

### 9.1 Required Alerts

| Condition | Alert Level | Action |
|-----------|-------------|--------|
| Audit logging failure | CRITICAL | Page on-call, stop accepting requests |
| Hash chain integrity failure | CRITICAL | Page on-call, investigate tampering |
| Multiple failed logins | HIGH | Alert security team |
| Unusual document access pattern | MEDIUM | Log for review |
| Storage capacity < 10% | HIGH | Alert ops team |

### 9.2 Implementation

Application health check should verify audit logging is functional:

```typescript
async function healthCheck(): Promise<HealthStatus> {
  // Verify audit table is writable
  const canWrite = await testAuditWrite();

  // Verify hash chain integrity (sample last 100 records)
  const chainValid = await verifyRecentChain();

  // Check storage capacity
  const storageOk = await checkAuditStorage();

  if (!canWrite || !chainValid) {
    return { status: 'unhealthy', reason: 'Audit system failure' };
  }

  return { status: 'healthy' };
}
```

### 9.3 Storage Monitoring (AU-4)

The `/health` endpoint includes `audit_logs_size_bytes` for monitoring storage capacity:

```json
{
  "status": "ok",
  "audit_status": "ok",
  "audit_logs_size_bytes": 123456789,
  "audit_logs_size_warning": "Audit logs table size exceeds threshold",
  "cloudwatch_audit_status": "ok"
}
```

**Configuration:**
- `AUDIT_SIZE_WARNING_BYTES`: Warning threshold in bytes (default: 1GB / 1073741824)
- Warning appears when `audit_logs_size_bytes > AUDIT_SIZE_WARNING_BYTES`

**Monitoring recommendations:**
- Set up alerting on `audit_logs_size_warning` field presence
- Archive records older than 12 months to S3 to manage PostgreSQL storage
- CloudWatch Logs handles long-term storage (1096 days retention)

---

## 10. Implementation Checklist

### Phase 1: Core Infrastructure

- [ ] Create `audit_log` table with schema
- [ ] Implement immutability triggers (no UPDATE/DELETE)
- [ ] Implement hash chain trigger
- [ ] Create verification function
- [ ] Add health check for audit system
- [ ] **Configure CloudWatch Logs for AU-9 compliance**
- [ ] **Set up IAM policy (write-only, no delete)**
- [ ] **Configure 1096-day retention on log group (minimum CloudWatch value > 30mo)**

### Phase 2: Event Logging

- [ ] Authentication events (login, logout, MFA)
- [ ] Document access events (view, create, update, delete)
- [ ] Account management events (create, modify, delete)
- [ ] Authorization events (access granted/denied)
- [ ] System events (startup, shutdown, errors)

### Phase 3: Integration

- [ ] Audit query API endpoint
- [ ] Export API endpoint
- [ ] Role-based access control (RLS)
- [ ] **CloudWatch Logs Insights queries for SOC**
- [ ] **CloudWatch Subscription Filter for SIEM streaming**
- [ ] CloudWatch integration for alerting
- [ ] SIEM-compatible export format

### Phase 4: Operations

- [ ] Archive strategy implementation
- [ ] Retention policy automation
- [ ] Integrity verification cron job
- [ ] SOC integration documentation
- [ ] Runbook for audit investigations

---

## References

1. **NIST SP 800-53 Rev 5** - Security and Privacy Controls
   https://csrc.nist.gov/publications/detail/sp/800-53/rev-5/final

2. **OMB M-21-31** - Improving Federal Government Investigative Capabilities
   https://www.whitehouse.gov/wp-content/uploads/2021/08/M-21-31-Improving-the-Federal-Governments-Investigative-and-Remediation-Capabilities-Related-to-Cybersecurity-Incidents.pdf

3. **NIST SP 800-207** - Zero Trust Architecture
   https://csrc.nist.gov/publications/detail/sp/800-207/final

4. **NIST SP 800-92** - Guide to Computer Security Log Management
   https://csrc.nist.gov/publications/detail/sp/800-92/final

5. **OMB M-22-09** - Federal Zero Trust Strategy
   https://www.whitehouse.gov/wp-content/uploads/2022/01/M-22-09.pdf

6. **CISA Zero Trust Maturity Model v2.0**
   https://www.cisa.gov/zero-trust-maturity-model

7. **FedRAMP Security Controls Baseline**
   https://www.fedramp.gov/

8. **OWASP Logging Cheat Sheet**
   https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
