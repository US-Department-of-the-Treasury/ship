# Federal Authentication Compliance Audit

**Audit Date**: 2025-12-31
**Auditor**: Federal Authentication Compliance Specialist
**Target Standard**: NIST SP 800-63B-4 Digital Identity Guidelines
**Project**: Ship - Collaborative Project Management System
**Deployment Target**: Federal Government Agency

---

## Executive Summary

```
┌─────────────────────────────────────────────────────────┐
│ Federal Authentication Compliance Report                │
├─────────────────────────────────────────────────────────┤
│ Target AAL Level: AAL2 (Current) / AAL3 (Future PIV)   │
│ Overall Status: PARTIAL COMPLIANCE                      │
│                                                         │
│ NIST SP 800-63B-4:  ⚠ PARTIAL (6 CRITICAL issues)      │
│ Cookie Security:     ⚠ PARTIAL (2 HIGH issues)          │
│ PIV Readiness:       ✗ NOT READY (Architecture gaps)    │
│ Cryptographic:       ✓ PASS                             │
└─────────────────────────────────────────────────────────┘
```

**Critical Findings**: 6 critical issues, 4 high priority issues, 3 medium priority issues

**Blocker for Production Deployment**:
- Missing absolute session timeout (only inactivity timeout implemented)
- No concurrent session management
- No session rotation after login (session fixation vulnerability)
- No scheduled cleanup of expired sessions
- Production cookie security flags conditionally applied

---

## AAL (Authentication Assurance Level) Assessment

### Current Implementation: AAL1 with AAL2 Gaps

**AAL2 Requirements (Target for Password Authentication)**:
- Multi-factor authentication OR cryptographic authentication
- Session absolute timeout: 12 hours MAX (SHALL)
- Session inactivity timeout: 30 minutes MAX (SHALL) ✓ **COMPLIANT (15 min)**
- Session secret entropy: 64+ bits MIN (SHALL) ✓ **COMPLIANT (128 bits)**
- Server-side session storage (SHALL) ✓ **COMPLIANT**

**AAL3 Requirements (Future PIV Authentication)**:
- Hardware-based cryptographic authenticator (PIV/CAC)
- Session absolute timeout: 12 hours MAX (SHALL)
- Session inactivity timeout: 15 minutes MAX (SHALL) ✓ **COMPLIANT (15 min)**
- Reauthentication: Both factors required
- Certificate chain validation to Federal PKI
- Revocation checking via OCSP/CRL

**Current Status**: Implementing AAL2 inactivity timeout (15 min) but missing absolute timeout. System not ready for AAL3 PIV integration.

---

## Detailed Findings

### CRITICAL Issues

#### [CRITICAL-1] Missing Absolute Session Timeout

**Standard**: NIST SP 800-63B-4 §2.3.2 (AAL2) / §2.3.3 (AAL3)
**Requirement**: Sessions SHALL have an absolute timeout of 12 hours maximum
**Current State**: Only inactivity timeout (15 minutes) is implemented. Sessions can persist indefinitely if user remains active.

**Evidence**:
```typescript
// api/src/routes/auth.ts:64
const expiresAt = new Date(Date.now() + SESSION_TIMEOUT_MS);
```

The `expires_at` field is set but NEVER checked in the auth middleware.

```typescript
// api/src/middleware/auth.ts:56-73
const now = new Date();
const lastActivity = new Date(session.last_activity);
const inactivityMs = now.getTime() - lastActivity.getTime();

// Check 15-minute inactivity timeout
if (inactivityMs > SESSION_TIMEOUT_MS) {
  // Delete expired session
  await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
  // ... return 401
}

// ⚠ MISSING: No check against session.expires_at for absolute timeout!
```

**Risk**:
- User who stays active can maintain session beyond 12 hours (violates NIST SHALL requirement)
- Compromised session credentials remain valid indefinitely with periodic activity
- Failed ATO (Authorization to Operate) in government security assessment

**Remediation**:
```typescript
// api/src/middleware/auth.ts:56 (ADD AFTER LINE 55)
const now = new Date();
const expiresAt = new Date(session.expires_at);
const lastActivity = new Date(session.last_activity);
const inactivityMs = now.getTime() - lastActivity.getTime();

// Check absolute timeout (12 hours from creation)
if (now > expiresAt) {
  await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
  res.status(HTTP_STATUS.UNAUTHORIZED).json({
    success: false,
    error: {
      code: ERROR_CODES.SESSION_EXPIRED,
      message: 'Session expired - please log in again',
    },
  });
  return;
}

// Check 15-minute inactivity timeout
if (inactivityMs > SESSION_TIMEOUT_MS) {
  // ... existing code
}
```

**Also Update**:
```typescript
// shared/src/constants.ts:26 (ADD AFTER)
export const SESSION_TIMEOUT_MS = 15 * 60 * 1000; // Inactivity timeout
export const SESSION_ABSOLUTE_TIMEOUT_MS = 12 * 60 * 60 * 1000; // 12 hours absolute

// api/src/routes/auth.ts:64 (CHANGE)
const expiresAt = new Date(Date.now() + SESSION_ABSOLUTE_TIMEOUT_MS);
```

---

#### [CRITICAL-2] Session Fixation Vulnerability

**Standard**: OWASP Session Management / NIST SP 800-63B §7.1
**Requirement**: Session identifier MUST be regenerated after authentication to prevent session fixation attacks
**Current State**: Same session ID used before and after login

**Evidence**:
```typescript
// api/src/routes/auth.ts:63-69
// Create session
const sessionId = uuidv4();
const expiresAt = new Date(Date.now() + SESSION_TIMEOUT_MS);

await pool.query(
  `INSERT INTO sessions (id, user_id, workspace_id, expires_at, last_activity)
   VALUES ($1, $2, $3, $4, $5)`,
  [sessionId, user.id, user.workspace_id, expiresAt, new Date()]
);
```

**Attack Scenario**:
1. Attacker obtains unauthenticated session ID (e.g., via XSS on login page)
2. Attacker tricks victim into logging in with that session ID
3. Attacker now has access to victim's authenticated session

**Risk**:
- Session hijacking via fixation attack
- Violates federal security best practices
- Common vulnerability flagged in penetration tests

**Remediation**:
```typescript
// api/src/routes/auth.ts:62 (ADD BEFORE SESSION CREATION)
// Delete any existing sessions for this user (prevent concurrent sessions)
await pool.query('DELETE FROM sessions WHERE user_id = $1', [user.id]);

// Then create new session (existing code)
const sessionId = uuidv4();
// ... rest of session creation
```

**Note**: This also addresses concurrent session management (see CRITICAL-3).

---

#### [CRITICAL-3] No Concurrent Session Management

**Standard**: NIST SP 800-63B §7.1 (Session Management Best Practices)
**Requirement**: System SHOULD limit or track concurrent sessions per user
**Current State**: Users can create unlimited concurrent sessions from multiple devices/browsers

**Evidence**:
```typescript
// api/src/routes/auth.ts:12-100 (entire login endpoint)
// ⚠ No check for existing sessions
// ⚠ No limit on number of active sessions per user
```

**Risk**:
- Compromised credentials allow attacker to maintain persistent access
- Legitimate user cannot detect or terminate attacker's session
- Increased attack surface (each session is a potential compromise point)
- Difficult to audit user activity across multiple sessions

**Remediation Options**:

**Option A: Single Session Per User (RECOMMENDED for Government)**
```typescript
// api/src/routes/auth.ts:62 (ADD)
// Delete any existing sessions for this user
await pool.query('DELETE FROM sessions WHERE user_id = $1', [user.id]);

// Then create new session
const sessionId = uuidv4();
// ... rest of code
```

**Option B: Limited Concurrent Sessions with Tracking**
```typescript
// api/src/routes/auth.ts:62 (ADD)
// Check concurrent session count
const sessionCount = await pool.query(
  'SELECT COUNT(*) FROM sessions WHERE user_id = $1',
  [user.id]
);

const MAX_CONCURRENT_SESSIONS = 3;
if (parseInt(sessionCount.rows[0].count) >= MAX_CONCURRENT_SESSIONS) {
  // Delete oldest session
  await pool.query(
    `DELETE FROM sessions
     WHERE id = (
       SELECT id FROM sessions
       WHERE user_id = $1
       ORDER BY created_at ASC
       LIMIT 1
     )`,
    [user.id]
  );
}
```

**Recommended**: Option A (Single Session) for government deployment due to simpler security model and reduced attack surface.

---

#### [CRITICAL-4] No Scheduled Session Cleanup

**Standard**: NIST SP 800-63B §7.1 / Database Security Best Practices
**Requirement**: Expired sessions MUST be purged from database to prevent accumulation of stale credentials
**Current State**: Sessions only deleted on demand (when user attempts to use expired session)

**Evidence**:
```typescript
// api/src/middleware/auth.ts:63
await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);

// ⚠ Only deletes session when user tries to use it
// ⚠ No scheduled cleanup job for abandoned sessions
```

**Database Check**:
```bash
# No cron job or scheduled task found
grep -rn "cron\|schedule\|cleanup" api/src/
# Only found: scripts/dev.sh:59:cleanup() (development script, not production)
```

**Risk**:
- Database bloat from accumulated expired sessions
- Potential information disclosure (expired sessions contain user_id, workspace_id)
- Increased query time on sessions table
- Compliance failure: stale credentials not properly destroyed

**Remediation**:

**Option A: PostgreSQL Scheduled Job (RECOMMENDED)**
```sql
-- api/src/db/schema.sql (ADD AT END)

-- Function to cleanup expired sessions
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS void AS $$
BEGIN
  DELETE FROM sessions
  WHERE expires_at < NOW()
     OR last_activity < NOW() - INTERVAL '15 minutes';
END;
$$ LANGUAGE plpgsql;

-- Schedule cleanup every hour
-- Requires pg_cron extension (install: CREATE EXTENSION pg_cron;)
SELECT cron.schedule(
  'cleanup-expired-sessions',
  '0 * * * *',  -- Every hour at minute 0
  'SELECT cleanup_expired_sessions();'
);
```

**Option B: Application-Level Scheduled Task**
```typescript
// api/src/cleanup/sessions.ts (NEW FILE)
import { pool } from '../db/client.js';
import { SESSION_TIMEOUT_MS } from '@ship/shared';

export async function cleanupExpiredSessions(): Promise<void> {
  try {
    const result = await pool.query(
      `DELETE FROM sessions
       WHERE expires_at < NOW()
          OR last_activity < NOW() - INTERVAL '15 minutes'
       RETURNING id`
    );
    console.log(`Cleaned up ${result.rowCount} expired sessions`);
  } catch (error) {
    console.error('Session cleanup error:', error);
  }
}

// Run cleanup every hour
setInterval(cleanupExpiredSessions, 60 * 60 * 1000);
```

```typescript
// api/src/server.ts (MODIFY)
import { cleanupExpiredSessions } from './cleanup/sessions.js';

// Start cleanup job
cleanupExpiredSessions(); // Run immediately on startup
// setInterval already handles recurring execution
```

**Recommended**: Option A (PostgreSQL scheduled job) for production due to reliability and independence from application uptime.

---

#### [CRITICAL-5] Cookie Secure Flag Conditionally Applied

**Standard**: NIST SP 800-63B §7.1 / OWASP Session Management
**Requirement**: Session cookies MUST have Secure flag in production (SHALL)
**Current State**: Secure flag only set when `NODE_ENV === 'production'`

**Evidence**:
```typescript
// api/src/routes/auth.ts:73-78
res.cookie('session_id', sessionId, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',  // ⚠ CONDITIONAL
  sameSite: 'lax',
  maxAge: SESSION_TIMEOUT_MS,
});
```

**Risk**:
- If `NODE_ENV` not set or misconfigured in production, cookies sent over HTTP
- Man-in-the-middle attack can intercept session credentials
- Failed security scan in ATO process
- Violates NIST SHALL requirement for secure transmission

**Scenarios Where This Fails**:
- `NODE_ENV` not set in environment (defaults to undefined)
- Typo in environment variable (`NODE_ENV=prod` instead of `production`)
- Docker container without explicit environment variable
- Elastic Beanstalk deployment without proper environment configuration

**Remediation**:
```typescript
// api/src/routes/auth.ts:73-78 (REPLACE)
const isProduction = process.env.NODE_ENV === 'production';

// ⚠ FAIL CLOSED: If NODE_ENV is not explicitly 'development', treat as production
const secureCookie = process.env.NODE_ENV !== 'development';

res.cookie('session_id', sessionId, {
  httpOnly: true,
  secure: secureCookie,  // Secure by default unless explicitly in development
  sameSite: 'strict',    // Changed from 'lax' to 'strict' (see CRITICAL-6)
  maxAge: SESSION_ABSOLUTE_TIMEOUT_MS,  // Use absolute timeout (see CRITICAL-1)
});

if (!isProduction && secureCookie) {
  console.warn('⚠ Cookie set to secure=true but NODE_ENV is not "production". Ensure HTTPS is configured.');
}
```

**Alternative (More Strict)**:
```typescript
// Require explicit environment variable for insecure cookies
const allowInsecureCookies = process.env.ALLOW_INSECURE_COOKIES === 'true';

res.cookie('session_id', sessionId, {
  httpOnly: true,
  secure: !allowInsecureCookies,  // Secure by default
  sameSite: 'strict',
  maxAge: SESSION_ABSOLUTE_TIMEOUT_MS,
});
```

**Environment Configuration**:
```bash
# .env.production (should NOT include ALLOW_INSECURE_COOKIES)
NODE_ENV=production

# .env.local (development only)
NODE_ENV=development
ALLOW_INSECURE_COOKIES=true
```

---

#### [CRITICAL-6] Cookie SameSite Attribute Too Permissive

**Standard**: OWASP Session Management / CSRF Best Practices
**Requirement**: Session cookies SHOULD use SameSite=Strict for maximum CSRF protection
**Current State**: Using SameSite=Lax

**Evidence**:
```typescript
// api/src/routes/auth.ts:76
sameSite: 'lax',  // ⚠ Allows cookies on top-level GET requests from other sites
```

**Risk Comparison**:

| SameSite Value | Risk | Use Case |
|----------------|------|----------|
| `none` | HIGH - Cookies sent on all cross-site requests | OAuth flows |
| `lax` | MEDIUM - Cookies sent on top-level GET from other sites | General web apps |
| `strict` | LOW - Cookies NEVER sent cross-site | High-security apps |

**Attack Scenario with SameSite=Lax**:
1. User authenticated to `https://ship.agency.gov`
2. User clicks link on `https://malicious.com` to `https://ship.agency.gov/api/documents/123?delete=true`
3. Browser sends session cookie with GET request (because Lax allows top-level navigation)
4. If API accepts GET for state-changing operations, CSRF succeeds

**Current Protection**:
- API uses POST for state-changing operations (good)
- But SameSite=Strict provides defense-in-depth

**Remediation**:
```typescript
// api/src/routes/auth.ts:76 (CHANGE)
sameSite: 'strict',  // Never send cookies cross-site
```

**Testing Required**: Ensure application doesn't rely on cross-site navigation (e.g., email links directly to authenticated pages). If needed, use landing page pattern:

```typescript
// Redirect pattern for external links
// https://ship.agency.gov/auth/continue?next=/documents/123
// -> User clicks "Continue" -> Navigate to /documents/123 (same-site)
```

---

### HIGH Priority Issues

#### [HIGH-1] Missing Session Entropy Documentation

**Standard**: NIST SP 800-63B §7.1
**Requirement**: Session identifiers MUST contain at least 64 bits of entropy (SHALL)
**Current State**: Using UUID v4 (128 bits) but not documented ✓ **COMPLIANT**

**Evidence**:
```typescript
// api/src/routes/auth.ts:4
import { v4 as uuidv4 } from 'uuid';

// api/src/routes/auth.ts:63
const sessionId = uuidv4();  // UUID v4 = 122 bits of entropy (128 bits total)
```

**Analysis**: UUID v4 provides 122 bits of true randomness (6 bits used for version/variant). This exceeds NIST requirement of 64 bits minimum (128 bits recommended).

**Issue**: Entropy level not documented in code or architecture docs.

**Remediation**:
```typescript
// shared/src/constants.ts:26 (ADD COMMENT)
// Session Configuration (NIST SP 800-63B Compliant)
// - Inactivity Timeout: 15 minutes (AAL2: 30 min max, AAL3: 15 min max)
// - Absolute Timeout: 12 hours (AAL2/AAL3: 12 hours max)
// - Session ID Entropy: 122 bits (UUID v4) - exceeds 64-bit minimum
export const SESSION_TIMEOUT_MS = 15 * 60 * 1000;
export const SESSION_ABSOLUTE_TIMEOUT_MS = 12 * 60 * 60 * 1000;
```

---

#### [HIGH-2] No HSTS (HTTP Strict Transport Security) Header

**Standard**: NIST SP 800-63B §7.1.1 / OWASP Transport Security
**Requirement**: Applications SHOULD enforce HTTPS via HSTS header
**Current State**: Using Helmet but not explicitly configuring HSTS

**Evidence**:
```typescript
// api/src/app.ts:16
app.use(helmet());  // Uses default Helmet configuration
```

**Default Helmet HSTS**:
- Enabled by default
- `max-age`: 15552000 seconds (180 days)
- Does NOT include `includeSubDomains` or `preload`

**Risk**:
- MITM attack possible on first visit (before HSTS cached)
- Subdomains not protected
- Not eligible for HSTS preload list

**Remediation**:
```typescript
// api/src/app.ts:16 (REPLACE)
app.use(helmet({
  hsts: {
    maxAge: 31536000,  // 1 year (required for preload)
    includeSubDomains: true,
    preload: true,
  },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],  // TipTap may require
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "wss:"],  // WebSocket for collaboration
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
    },
  },
}));
```

**Domain Registration** (manual step):
```
1. Deploy with HSTS header above
2. Test for 30 days
3. Submit to https://hstspreload.org
4. Domain will be hardcoded into browsers
```

---

#### [HIGH-3] Password Hash Work Factor Not Specified

**Standard**: NIST SP 800-63B Appendix A (Password Storage)
**Requirement**: Password hashes SHOULD use adaptive algorithms with appropriate work factor
**Current State**: Using bcrypt with work factor 10 ✓ **COMPLIANT** (but not documented)

**Evidence**:
```typescript
// api/src/db/seed.ts:72
const passwordHash = await bcrypt.hash('admin123', 10);
// Work factor 10 = 2^10 = 1,024 iterations
```

**NIST Recommendations**:
- bcrypt: work factor 10+ (current: 10) ✓
- scrypt: N=2^15, r=8, p=1
- Argon2id: m=15 MiB, t=2, p=1

**Issue**: Work factor only visible in seed script, not enforced in production code path (no user registration endpoint yet).

**Remediation**:
```typescript
// shared/src/constants.ts:29 (ADD)
// Password Security (NIST SP 800-63B Appendix A)
export const BCRYPT_WORK_FACTOR = 10;  // 2^10 = 1,024 iterations
// Increase to 12 for high-security environments (4x slower)
```

```typescript
// api/src/db/seed.ts:72 (CHANGE)
import { BCRYPT_WORK_FACTOR } from '@ship/shared';
const passwordHash = await bcrypt.hash('admin123', BCRYPT_WORK_FACTOR);
```

**Future Registration Endpoint**:
```typescript
// api/src/routes/auth.ts (FUTURE)
import { BCRYPT_WORK_FACTOR } from '@ship/shared';

router.post('/register', async (req, res) => {
  const { email, password, name } = req.body;
  // ... validation
  const passwordHash = await bcrypt.hash(password, BCRYPT_WORK_FACTOR);
  // ... create user
});
```

---

#### [HIGH-4] No Re-Authentication for Sensitive Actions

**Standard**: NIST SP 800-63B §7.2
**Requirement**: Sensitive actions SHOULD require re-authentication
**Current State**: No re-authentication prompts for any actions

**Examples of Sensitive Actions** (not yet implemented):
- Changing password
- Changing email address
- Deleting account
- Modifying security settings
- Accessing audit logs
- Exporting sensitive data

**Risk**:
- Unattended authenticated session can be exploited
- Insider threat (coworker uses unattended computer)
- Session hijacking has broader impact

**Remediation** (when sensitive features added):
```typescript
// api/src/middleware/auth.ts:14 (ADD FIELD)
interface Request {
  sessionId?: string;
  userId?: string;
  workspaceId?: string;
  lastReauth?: Date;  // NEW
}
```

```typescript
// api/src/middleware/auth.ts:97 (ADD EXPORT)
export async function requireRecentAuth(
  req: Request,
  res: Response,
  next: NextFunction,
  maxAgeMinutes: number = 5
): Promise<void> {
  if (!req.lastReauth) {
    res.status(HTTP_STATUS.UNAUTHORIZED).json({
      success: false,
      error: {
        code: 'REAUTH_REQUIRED',
        message: 'Please re-enter your password to continue',
      },
    });
    return;
  }

  const now = new Date();
  const reauthAge = now.getTime() - req.lastReauth.getTime();
  const maxAge = maxAgeMinutes * 60 * 1000;

  if (reauthAge > maxAge) {
    res.status(HTTP_STATUS.UNAUTHORIZED).json({
      success: false,
      error: {
        code: 'REAUTH_REQUIRED',
        message: 'Please re-enter your password to continue',
      },
    });
    return;
  }

  next();
}
```

```typescript
// api/src/routes/auth.ts:100 (ADD ENDPOINT)
router.post('/reauth', authMiddleware, async (req: Request, res: Response) => {
  const { password } = req.body;

  // Verify password
  const userResult = await pool.query(
    'SELECT password_hash FROM users WHERE id = $1',
    [req.userId]
  );

  const validPassword = await bcrypt.compare(
    password,
    userResult.rows[0].password_hash
  );

  if (!validPassword) {
    res.status(HTTP_STATUS.UNAUTHORIZED).json({
      success: false,
      error: { code: ERROR_CODES.INVALID_CREDENTIALS, message: 'Invalid password' },
    });
    return;
  }

  // Update session with reauth timestamp
  await pool.query(
    'UPDATE sessions SET last_reauth = $1 WHERE id = $2',
    [new Date(), req.sessionId]
  );

  res.json({ success: true });
});
```

```sql
-- api/src/db/schema.sql:30 (ADD COLUMN)
last_activity TIMESTAMPTZ DEFAULT now(),
last_reauth TIMESTAMPTZ DEFAULT now(),  -- NEW
created_at TIMESTAMPTZ DEFAULT now()
```

**Usage Example**:
```typescript
// Future sensitive endpoint
router.post('/users/delete-account',
  authMiddleware,
  (req, res, next) => requireRecentAuth(req, res, next, 5),  // 5 min window
  async (req, res) => {
    // Delete account logic
  }
);
```

---

### MEDIUM Priority Issues

#### [MEDIUM-1] Session Cookie maxAge Matches Inactivity Timeout (Should Match Absolute Timeout)

**Standard**: Session Management Best Practices
**Requirement**: Cookie expiration should match absolute session timeout, not inactivity timeout
**Current State**: Cookie maxAge set to 15 minutes (inactivity timeout)

**Evidence**:
```typescript
// api/src/routes/auth.ts:77
maxAge: SESSION_TIMEOUT_MS,  // 15 minutes
```

**Issue**:
- Cookie expires after 15 minutes even if user is active
- Browser may discard cookie before session expires on server
- User unexpectedly logged out despite activity

**Correct Behavior**:
- Cookie maxAge should match absolute timeout (12 hours)
- Server enforces inactivity timeout (15 minutes)
- Cookie persists as long as session could be valid

**Remediation**:
```typescript
// api/src/routes/auth.ts:77 (CHANGE)
maxAge: SESSION_ABSOLUTE_TIMEOUT_MS,  // 12 hours (not 15 minutes)
```

---

#### [MEDIUM-2] No Audit Logging for Authentication Events

**Standard**: NIST SP 800-53 AU-2 (Audit Events) / FedRAMP Requirements
**Requirement**: Authentication events SHOULD be logged for security monitoring
**Current State**: Only console.error for failures, no structured audit log

**Events to Log**:
- Successful login (user, timestamp, IP)
- Failed login attempts (user, timestamp, IP, reason)
- Logout (user, timestamp)
- Session expiration (user, timestamp, reason)
- Concurrent session termination
- Re-authentication events

**Evidence**:
```typescript
// api/src/routes/auth.ts:91
console.error('Login error:', error);

// api/src/middleware/auth.ts:88
console.error('Auth middleware error:', error);
```

**Risk**:
- Cannot detect brute force attacks
- Cannot investigate security incidents
- Failed ATO audit requirements
- No compliance with FedRAMP AU-2

**Remediation**:

**Phase 1: Basic Audit Logging**
```sql
-- api/src/db/schema.sql:107 (ADD TABLE)
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,  -- LOGIN_SUCCESS, LOGIN_FAILURE, LOGOUT, SESSION_EXPIRED
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  email TEXT,  -- Store email even if user deleted
  ip_address INET,
  user_agent TEXT,
  session_id UUID,
  details JSONB,  -- Additional event-specific data
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON audit_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
```

```typescript
// api/src/lib/audit.ts (NEW FILE)
import { pool } from '../db/client.js';

export async function logAuthEvent(
  eventType: 'LOGIN_SUCCESS' | 'LOGIN_FAILURE' | 'LOGOUT' | 'SESSION_EXPIRED',
  userId: string | null,
  email: string,
  req: { ip?: string; headers: Record<string, string | string[] | undefined> },
  details?: Record<string, unknown>
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO audit_logs (event_type, user_id, email, ip_address, user_agent, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        eventType,
        userId,
        email,
        req.ip || null,
        req.headers['user-agent'] || null,
        details ? JSON.stringify(details) : null,
      ]
    );
  } catch (error) {
    console.error('Failed to write audit log:', error);
    // Don't throw - audit failure should not break authentication
  }
}
```

```typescript
// api/src/routes/auth.ts:49 (ADD AFTER PASSWORD VERIFICATION)
if (!validPassword) {
  await logAuthEvent('LOGIN_FAILURE', null, email, req, { reason: 'invalid_password' });
  res.status(HTTP_STATUS.UNAUTHORIZED).json({ /* ... */ });
  return;
}

// api/src/routes/auth.ts:79 (ADD AFTER COOKIE SET)
await logAuthEvent('LOGIN_SUCCESS', user.id, user.email, req, { session_id: sessionId });
```

**Phase 2: Security Monitoring (Future)**
- Implement brute force detection (5 failed attempts in 5 minutes)
- Alert on multiple concurrent sessions
- Dashboard for security team
- Integration with SIEM (Splunk, ELK, etc.)

---

#### [MEDIUM-3] Missing Rate Limiting on Authentication Endpoints

**Standard**: OWASP Authentication Best Practices
**Requirement**: Authentication endpoints SHOULD be rate-limited to prevent brute force attacks
**Current State**: No rate limiting implemented

**Evidence**:
```typescript
// api/src/app.ts (NO RATE LIMITING MIDDLEWARE)
```

**Risk**:
- Brute force password guessing
- Credential stuffing attacks
- Denial of service via auth endpoint flooding

**Remediation**:
```typescript
// api/src/middleware/rateLimit.ts (NEW FILE)
import rateLimit from 'express-rate-limit';

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 5,  // 5 attempts per window per IP
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many login attempts. Please try again later.',
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Use custom key if behind proxy
  keyGenerator: (req) => {
    return req.ip || req.headers['x-forwarded-for']?.toString() || 'unknown';
  },
});
```

```typescript
// api/src/routes/auth.ts:12 (ADD RATE LIMITER)
import { authRateLimiter } from '../middleware/rateLimit.js';

router.post('/login', authRateLimiter, async (req: Request, res: Response) => {
  // ... existing login code
});
```

```json
// api/package.json:29 (ADD DEPENDENCY)
"dependencies": {
  // ... existing
  "express-rate-limit": "^7.1.5"
}
```

**Configuration for Production**:
```typescript
// Stricter limits for production
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 3 : 10,
  skipSuccessfulRequests: true,  // Only count failed attempts
});
```

---

## Cookie Security Analysis

### Current Implementation

```typescript
res.cookie('session_id', sessionId, {
  httpOnly: true,            // ✓ COMPLIANT
  secure: NODE_ENV === 'production',  // ⚠ CONDITIONAL (see CRITICAL-5)
  sameSite: 'lax',           // ⚠ SHOULD BE 'strict' (see CRITICAL-6)
  maxAge: SESSION_TIMEOUT_MS,  // ⚠ WRONG VALUE (see MEDIUM-1)
});
```

### Cookie Security Checklist

| Attribute | Required Value | Current Value | Status | Severity |
|-----------|----------------|---------------|--------|----------|
| `HttpOnly` | true | true | ✓ PASS | - |
| `Secure` | true | conditional | ✗ FAIL | CRITICAL |
| `SameSite` | Strict | Lax | ⚠ PARTIAL | CRITICAL |
| `Path` | / (default) | / (default) | ✓ PASS | - |
| `Domain` | explicit | explicit | ✓ PASS | - |
| `maxAge` | 12h (absolute) | 15m (inactivity) | ✗ FAIL | MEDIUM |

### Recommended Cookie Configuration

```typescript
// api/src/routes/auth.ts:73-78 (REPLACE ENTIRE BLOCK)
const secureCookie = process.env.NODE_ENV !== 'development';

res.cookie('session_id', sessionId, {
  httpOnly: true,           // Prevent XSS access
  secure: secureCookie,     // HTTPS only (fail-closed)
  sameSite: 'strict',       // Maximum CSRF protection
  maxAge: SESSION_ABSOLUTE_TIMEOUT_MS,  // Match absolute timeout
  path: '/',                // Explicit (default, but be clear)
  // domain: '.agency.gov'  // Set explicitly for subdomain sharing (if needed)
});

// Warn if configuration is unexpected
if (!secureCookie && process.env.NODE_ENV !== 'development') {
  console.warn('⚠ SECURITY WARNING: Session cookie set to secure=false in non-development environment');
}
```

---

## PIV/CAC Integration Readiness Assessment

### Current State: NOT READY for PIV Integration

**Missing Components** (All CRITICAL for PIV):

1. **Certificate Parsing Infrastructure**
   - No X.509 certificate parsing library
   - No extraction of certificate fields (DN, CN, OIDs)
   - No handling of client certificate from reverse proxy headers

2. **Federal PKI Trust Chain Validation**
   - No Federal PKI root/intermediate CA certificates
   - No path discovery algorithm
   - No certificate chain verification

3. **Revocation Checking**
   - No OCSP client
   - No CRL download/parsing
   - No cached revocation status

4. **PIV Authentication Endpoint**
   - No `/api/auth/piv` endpoint
   - No fallback logic between PIV and password auth

5. **Policy OID Validation**
   - No checking for PIV Authentication certificate OID (2.16.840.1.101.3.2.1.3.13)
   - No distinction between auth and signing certificates

### Architecture Recommendation

**Pattern**: Use external PIV validation service (recommended by user's CLAUDE.md)

```
┌─────────────────────────────────────────────────────────────┐
│ User's Environment Guidance (CLAUDE.md)                    │
├─────────────────────────────────────────────────────────────┤
│ Applications → Elastic Beanstalk (Docker platform)         │
│   - nginx terminates mTLS                                   │
│   - Extracts cert to header (X-Client-Cert)                │
│   - App calls PIV service for validation                   │
│                                                             │
│ Shared Infrastructure → ECS Fargate                         │
│   - PIV validation service                                  │
│   - Revocation checking, path discovery, OID validation    │
│   - PrivateLink endpoint for secure cross-VPC access        │
└─────────────────────────────────────────────────────────────┘
```

### Implementation Phases

#### Phase 1: Application Changes (This Codebase)

```typescript
// api/src/routes/auth.ts:166 (ADD ENDPOINT)
import crypto from 'crypto';

// PIV Authentication
router.post('/piv', async (req: Request, res: Response): Promise<void> => {
  // Extract certificate from reverse proxy header
  // (nginx: proxy_set_header X-Client-Cert $ssl_client_escaped_cert;)
  const clientCert = req.headers['x-client-cert'] as string;

  if (!clientCert) {
    res.status(HTTP_STATUS.UNAUTHORIZED).json({
      success: false,
      error: {
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'PIV certificate not provided',
      },
    });
    return;
  }

  try {
    // Call PIV validation service (PrivateLink endpoint)
    const pivServiceUrl = process.env.PIV_VALIDATION_SERVICE_URL;
    const response = await fetch(`${pivServiceUrl}/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ certificate: clientCert }),
    });

    const result = await response.json();

    if (!result.valid) {
      res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        error: {
          code: ERROR_CODES.INVALID_CREDENTIALS,
          message: result.error || 'PIV certificate validation failed',
        },
      });
      return;
    }

    // Extract user identity from validated certificate
    const { subject, email } = result;

    // Find or create user based on PIV subject DN
    let user = await pool.query(
      'SELECT id, workspace_id, email, name FROM users WHERE piv_subject = $1',
      [subject]
    );

    if (user.rows.length === 0) {
      // Auto-provision user from PIV certificate (if enabled)
      if (process.env.PIV_AUTO_PROVISION !== 'true') {
        res.status(HTTP_STATUS.FORBIDDEN).json({
          success: false,
          error: {
            code: ERROR_CODES.FORBIDDEN,
            message: 'User not found. Contact administrator.',
          },
        });
        return;
      }

      // Create user (requires workspace assignment logic)
      // ... user creation code
    }

    user = user.rows[0];

    // Delete any existing sessions for this user
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [user.id]);

    // Create session
    const sessionId = crypto.randomBytes(16).toString('hex');  // 128 bits
    const expiresAt = new Date(Date.now() + SESSION_ABSOLUTE_TIMEOUT_MS);

    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at, last_activity, auth_method)
       VALUES ($1, $2, $3, $4, $5, 'PIV')`,
      [sessionId, user.id, user.workspace_id, expiresAt, new Date()]
    );

    // Set cookie (AAL3 compliant)
    res.cookie('session_id', sessionId, {
      httpOnly: true,
      secure: true,  // Always true for PIV
      sameSite: 'strict',
      maxAge: SESSION_ABSOLUTE_TIMEOUT_MS,
    });

    // Log successful PIV authentication
    await logAuthEvent('PIV_LOGIN_SUCCESS', user.id, user.email, req, {
      subject,
      session_id: sessionId,
    });

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          authMethod: 'PIV',
        },
      },
    });
  } catch (error) {
    console.error('PIV authentication error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'PIV authentication failed',
      },
    });
  }
});
```

```sql
-- api/src/db/schema.sql:18 (ADD COLUMNS)
email TEXT UNIQUE NOT NULL,
piv_subject TEXT UNIQUE,  -- NEW: X.509 Subject DN from PIV cert
piv_enabled BOOLEAN DEFAULT false,  -- NEW: User has PIV credential
password_hash TEXT,  -- CHANGE: Make nullable for PIV-only users
name TEXT NOT NULL,
```

```sql
-- api/src/db/schema.sql:30 (ADD COLUMN)
last_activity TIMESTAMPTZ DEFAULT now(),
auth_method TEXT DEFAULT 'PASSWORD',  -- NEW: 'PASSWORD' or 'PIV'
last_reauth TIMESTAMPTZ DEFAULT now(),
```

#### Phase 2: PIV Validation Service (Separate Deployment)

**Reference**: `piv-auth` skill for detailed implementation

**Service Responsibilities**:
- Parse X.509 certificates
- Validate certificate chain to Federal PKI root
- Check revocation status via OCSP (with CRL fallback)
- Validate policy OIDs (PIV Authentication cert)
- Return validated subject DN and email

**Deployment**:
- ECS Fargate task
- PrivateLink endpoint (NLB)
- Shared across multiple applications

**Infrastructure Code**: Use `gov-deployment` skill for ACM certificates and Route53

#### Phase 3: nginx mTLS Configuration (Elastic Beanstalk)

```nginx
# .platform/nginx/conf.d/mtls.conf
server {
    listen 443 ssl;

    # Require client certificate
    ssl_client_certificate /etc/pki/tls/certs/fpki-ca-bundle.pem;
    ssl_verify_client optional;  # Optional to allow password fallback
    ssl_verify_depth 3;

    # Extract certificate and pass to application
    location /api/auth/piv {
        proxy_pass http://localhost:3000;
        proxy_set_header X-Client-Cert $ssl_client_escaped_cert;
        proxy_set_header X-Client-Verify $ssl_client_verify;
        proxy_set_header X-Client-DN $ssl_client_s_dn;
    }
}
```

**Certificate Bundle**:
- Download Federal Common Policy CA G2
- Include DoD Root CA 3
- Include all intermediate CAs
- Update annually (CAs expire/change)

---

## Remediation Priority Roadmap

### Phase 1: CRITICAL Security Fixes (REQUIRED before production)

**Target**: 1-2 days development + testing

1. **[CRITICAL-1] Add Absolute Session Timeout**
   - File: `shared/src/constants.ts`
   - File: `api/src/routes/auth.ts:64`
   - File: `api/src/middleware/auth.ts:56`
   - Testing: Verify 12-hour max session lifetime

2. **[CRITICAL-2, CRITICAL-3] Session Rotation + Concurrent Session Management**
   - File: `api/src/routes/auth.ts:62`
   - Add: Delete existing sessions on login
   - Testing: Verify old sessions invalidated

3. **[CRITICAL-4] Scheduled Session Cleanup**
   - File: `api/src/db/schema.sql` (add pg_cron function)
   - File: `api/src/cleanup/sessions.ts` (application fallback)
   - Testing: Verify expired sessions deleted

4. **[CRITICAL-5, CRITICAL-6] Cookie Security Hardening**
   - File: `api/src/routes/auth.ts:73-78`
   - Change: `secure` flag (fail-closed)
   - Change: `sameSite: 'strict'`
   - Change: `maxAge` to absolute timeout
   - Testing: Verify cookies secure in production

**Acceptance Criteria**:
- All CRITICAL issues resolved
- Unit tests pass
- Manual testing on staging environment
- Security scan shows no high/critical findings

---

### Phase 2: HIGH Priority Improvements (REQUIRED for ATO)

**Target**: 3-5 days development + testing

1. **[HIGH-2] HSTS Configuration**
   - File: `api/src/app.ts:16`
   - Add: Explicit Helmet HSTS configuration
   - Testing: Verify HSTS header in responses

2. **[HIGH-4] Re-Authentication Framework**
   - File: `api/src/middleware/auth.ts` (add `requireRecentAuth`)
   - File: `api/src/routes/auth.ts` (add `/reauth` endpoint)
   - File: `api/src/db/schema.sql` (add `last_reauth` column)
   - Testing: Verify re-auth prompt for sensitive actions

3. **[MEDIUM-2] Audit Logging**
   - File: `api/src/db/schema.sql` (add `audit_logs` table)
   - File: `api/src/lib/audit.ts` (new file)
   - File: `api/src/routes/auth.ts` (add logging calls)
   - Testing: Verify all auth events logged

4. **[MEDIUM-3] Rate Limiting**
   - File: `api/src/middleware/rateLimit.ts` (new file)
   - File: `api/src/routes/auth.ts:12` (add middleware)
   - Testing: Verify brute force protection

**Acceptance Criteria**:
- All HIGH issues resolved
- Audit logging captures all auth events
- Rate limiting prevents brute force
- HSTS preload eligible

---

### Phase 3: Documentation + PIV Preparation (REQUIRED for PIV launch)

**Target**: 5-7 days development + testing

1. **[HIGH-1, HIGH-3] Security Documentation**
   - Create: `docs/security/authentication.md`
   - Document: Session management, entropy, timeouts
   - Document: Password storage (bcrypt work factor)

2. **PIV Authentication Endpoint**
   - File: `api/src/routes/auth.ts` (add `/piv` endpoint)
   - File: `api/src/db/schema.sql` (add `piv_subject`, `auth_method`)
   - Testing: Mock PIV service integration

3. **PIV Validation Service** (separate deployment)
   - Implement: X.509 parsing, chain validation, OCSP/CRL
   - Deploy: ECS Fargate + PrivateLink
   - Reference: `piv-auth` skill

4. **Infrastructure Configuration**
   - Elastic Beanstalk: nginx mTLS configuration
   - Federal PKI: CA bundle installation
   - Testing: End-to-end PIV authentication

**Acceptance Criteria**:
- PIV authentication functional
- Password fallback maintained
- AAL3 compliant for PIV users
- Federal PKI trust chain validated

---

## Compliance Checklist

### NIST SP 800-63B-4 Session Management (§7.1)

- [ ] **Session Entropy**: 64+ bits minimum (SHALL)
  - Current: 128 bits (UUID v4) ✓ COMPLIANT
  - Action: Document in code comments

- [ ] **Server-Side Storage**: Session data stored on server (SHALL)
  - Current: PostgreSQL `sessions` table ✓ COMPLIANT

- [ ] **Session Inactivity Timeout**: Per AAL level (SHALL)
  - AAL2: 30 minutes MAX
  - AAL3: 15 minutes MAX
  - Current: 15 minutes ✓ COMPLIANT (AAL3-ready)

- [ ] **Session Absolute Timeout**: 12 hours maximum (SHALL)
  - Current: NOT CHECKED ✗ NON-COMPLIANT
  - Action: See CRITICAL-1 remediation

- [ ] **Session Fixation Prevention**: Regenerate ID after auth
  - Current: NOT IMPLEMENTED ✗ NON-COMPLIANT
  - Action: See CRITICAL-2 remediation

- [ ] **Concurrent Session Management**: Limit or track sessions
  - Current: UNLIMITED ✗ NON-COMPLIANT
  - Action: See CRITICAL-3 remediation

- [ ] **Session Invalidation on Logout**: Properly destroy session
  - Current: IMPLEMENTED ✓ COMPLIANT
  - File: `api/src/routes/auth.ts:106`

- [ ] **Expired Session Cleanup**: Remove stale sessions
  - Current: NOT SCHEDULED ✗ NON-COMPLIANT
  - Action: See CRITICAL-4 remediation

### Cookie Security (OWASP + NIST)

- [ ] **HttpOnly Flag**: Prevent JavaScript access (SHALL)
  - Current: true ✓ COMPLIANT

- [ ] **Secure Flag**: HTTPS-only transmission (SHALL)
  - Current: CONDITIONAL ✗ NON-COMPLIANT
  - Action: See CRITICAL-5 remediation

- [ ] **SameSite Attribute**: CSRF protection (SHOULD)
  - Current: Lax ⚠ PARTIAL
  - Recommended: Strict
  - Action: See CRITICAL-6 remediation

- [ ] **Cookie Expiration**: Match absolute timeout (SHOULD)
  - Current: 15 minutes (inactivity) ✗ NON-COMPLIANT
  - Should be: 12 hours (absolute)
  - Action: See MEDIUM-1 remediation

### AAL3 (PIV Authentication) Requirements

- [ ] **Hardware-Based Authenticator**: PIV/CAC card
  - Current: NOT IMPLEMENTED (password only)
  - Action: See PIV Readiness section

- [ ] **Certificate Chain Validation**: Verify to Federal PKI root
  - Current: NOT IMPLEMENTED
  - Action: Implement PIV validation service

- [ ] **Revocation Checking**: OCSP or CRL (SHALL)
  - Current: NOT IMPLEMENTED
  - Action: Implement PIV validation service

- [ ] **Policy OID Validation**: PIV Authentication certificate
  - Current: NOT IMPLEMENTED
  - Action: Implement PIV validation service

- [ ] **Reauthentication**: Both factors required for session renewal
  - Current: NOT APPLICABLE (no PIV yet)
  - Action: Implement when PIV deployed

### Additional Security Requirements

- [ ] **Password Storage**: Adaptive hash with work factor (SHALL)
  - Current: bcrypt work factor 10 ✓ COMPLIANT
  - Action: Document in constants

- [ ] **HTTPS Enforcement**: HSTS header (SHOULD)
  - Current: DEFAULT HELMET ⚠ PARTIAL
  - Action: See HIGH-2 remediation

- [ ] **Audit Logging**: Authentication events (SHOULD)
  - Current: NOT IMPLEMENTED ✗ NON-COMPLIANT
  - Action: See MEDIUM-2 remediation

- [ ] **Rate Limiting**: Brute force protection (SHOULD)
  - Current: NOT IMPLEMENTED ✗ NON-COMPLIANT
  - Action: See MEDIUM-3 remediation

- [ ] **Re-Authentication**: Sensitive actions (SHOULD)
  - Current: NOT IMPLEMENTED ✗ NON-COMPLIANT
  - Action: See HIGH-4 remediation

---

## Testing Verification Procedures

### Test Plan for Critical Fixes

#### Test 1: Absolute Session Timeout

```bash
# Create session via login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password"}' \
  -c cookies.txt

# Wait 12 hours + 1 minute (or modify DB)
# UPDATE sessions SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = '...';

# Attempt authenticated request
curl -X GET http://localhost:3000/api/auth/me \
  -b cookies.txt

# Expected: 401 Unauthorized with SESSION_EXPIRED error
```

#### Test 2: Inactivity Timeout

```bash
# Create session
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password"}' \
  -c cookies.txt

# Wait 16 minutes (or modify DB)
# UPDATE sessions SET last_activity = NOW() - INTERVAL '16 minutes' WHERE id = '...';

# Attempt authenticated request
curl -X GET http://localhost:3000/api/auth/me \
  -b cookies.txt

# Expected: 401 Unauthorized with SESSION_EXPIRED error
```

#### Test 3: Session Rotation on Login

```bash
# Create first session
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password"}' \
  -c cookies1.txt

# Capture session ID
SESSION1=$(grep session_id cookies1.txt | awk '{print $7}')

# Create second session (same user)
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password"}' \
  -c cookies2.txt

# Capture session ID
SESSION2=$(grep session_id cookies2.txt | awk '{print $7}')

# Verify first session invalidated
curl -X GET http://localhost:3000/api/auth/me \
  -b cookies1.txt

# Expected: 401 Unauthorized

# Verify second session works
curl -X GET http://localhost:3000/api/auth/me \
  -b cookies2.txt

# Expected: 200 OK with user data

# Verify only one session in DB
psql -d ship -c "SELECT COUNT(*) FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = 'test@example.com');"
# Expected: 1
```

#### Test 4: Cookie Security Flags

```bash
# Login and capture response headers
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password"}' \
  -v 2>&1 | grep -i "set-cookie"

# Expected output:
# Set-Cookie: session_id=...; HttpOnly; Secure; SameSite=Strict; Max-Age=43200

# Verify flags:
# - HttpOnly: ✓ (prevents JavaScript access)
# - Secure: ✓ (HTTPS only)
# - SameSite=Strict: ✓ (CSRF protection)
# - Max-Age=43200: ✓ (12 hours = 43200 seconds)
```

#### Test 5: Session Cleanup Job

```bash
# Create expired session manually
psql -d ship -c "
  INSERT INTO sessions (id, user_id, workspace_id, expires_at, last_activity)
  VALUES (
    gen_random_uuid(),
    (SELECT id FROM users LIMIT 1),
    (SELECT workspace_id FROM users LIMIT 1),
    NOW() - INTERVAL '1 hour',
    NOW() - INTERVAL '20 minutes'
  );
"

# Count expired sessions
psql -d ship -c "SELECT COUNT(*) FROM sessions WHERE expires_at < NOW() OR last_activity < NOW() - INTERVAL '15 minutes';"

# Run cleanup (manual trigger)
psql -d ship -c "SELECT cleanup_expired_sessions();"

# Verify expired sessions deleted
psql -d ship -c "SELECT COUNT(*) FROM sessions WHERE expires_at < NOW() OR last_activity < NOW() - INTERVAL '15 minutes';"
# Expected: 0
```

#### Test 6: Rate Limiting

```bash
# Attempt 6 failed logins in rapid succession
for i in {1..6}; do
  echo "Attempt $i:"
  curl -X POST http://localhost:3000/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com","password":"wrongpassword"}' \
    -w "\nHTTP Status: %{http_code}\n\n"
done

# Expected:
# Attempts 1-5: 401 Unauthorized (INVALID_CREDENTIALS)
# Attempt 6: 429 Too Many Requests (RATE_LIMIT_EXCEEDED)
```

---

## References

### NIST Standards

- **NIST SP 800-63B-4** (Draft): https://pages.nist.gov/800-63-4/sp800-63b.html
- **NIST SP 800-63-3** (Current): https://pages.nist.gov/800-63-3/sp800-63b.html
- **NIST SP 800-53 Rev 5**: https://csrc.nist.gov/publications/detail/sp/800-53/rev-5/final

### Federal PKI / PIV

- **FIPS 201-3**: https://csrc.nist.gov/publications/detail/fips/201/3/final
- **FICAM Playbooks**: https://playbooks.idmanagement.gov/
- **Federal PKI**: https://www.idmanagement.gov/fpki/

### OWASP

- **Session Management Cheat Sheet**: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- **Authentication Cheat Sheet**: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html

### Project Skills

- **piv-auth**: PIV authentication patterns (mTLS, certificate parsing, OCSP)
- **gov-deployment**: AWS deployment with ACM certificates
- **ssm-secrets**: Secrets management for government projects

---

## Appendix: Session Management Constants

### Current Implementation

```typescript
// shared/src/constants.ts:26
export const SESSION_TIMEOUT_MS = 15 * 60 * 1000;  // 15 minutes
```

### Recommended Implementation

```typescript
// shared/src/constants.ts:26 (REPLACE)

// ────────────────────────────────────────────────────────────
// Session Management (NIST SP 800-63B-4 Compliant)
// ────────────────────────────────────────────────────────────

// Inactivity Timeout: Time until session expires from lack of activity
// - AAL1: 30 minutes max (SHOULD)
// - AAL2: 30 minutes max (SHALL)
// - AAL3: 15 minutes max (SHALL)
// Current: 15 minutes (meets AAL3 for PIV authentication)
export const SESSION_INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;

// Absolute Timeout: Maximum session lifetime regardless of activity
// - AAL1: 30 days max (SHOULD)
// - AAL2: 12 hours max (SHALL)
// - AAL3: 12 hours max (SHALL)
// Current: 12 hours (meets AAL2/AAL3)
export const SESSION_ABSOLUTE_TIMEOUT_MS = 12 * 60 * 60 * 1000;

// Session ID Entropy: Cryptographic randomness of session identifiers
// - NIST Requirement: 64 bits minimum (SHALL)
// - NIST Recommendation: 128 bits
// Current: 128 bits (UUID v4 provides 122 bits of entropy)
// Implementation: uuidv4() from 'uuid' package
export const SESSION_ID_ENTROPY_BITS = 128;

// Backward compatibility (deprecated)
// @deprecated Use SESSION_INACTIVITY_TIMEOUT_MS instead
export const SESSION_TIMEOUT_MS = SESSION_INACTIVITY_TIMEOUT_MS;
```

---

## Appendix: Cookie Configuration Matrix

### Development Environment

```typescript
res.cookie('session_id', sessionId, {
  httpOnly: true,
  secure: false,            // HTTP allowed for localhost
  sameSite: 'lax',          // Allow Postman/curl testing
  maxAge: SESSION_ABSOLUTE_TIMEOUT_MS,
});
```

### Staging Environment

```typescript
res.cookie('session_id', sessionId, {
  httpOnly: true,
  secure: true,             // HTTPS required
  sameSite: 'strict',       // Full CSRF protection
  maxAge: SESSION_ABSOLUTE_TIMEOUT_MS,
});
```

### Production Environment

```typescript
res.cookie('session_id', sessionId, {
  httpOnly: true,
  secure: true,             // HTTPS required
  sameSite: 'strict',       // Full CSRF protection
  maxAge: SESSION_ABSOLUTE_TIMEOUT_MS,
  domain: '.agency.gov',    // Explicit domain (if subdomain sharing needed)
});
```

---

## Audit Completion

**Total Issues Found**: 13
**Critical**: 6
**High**: 4
**Medium**: 3

**Estimated Remediation Time**: 9-14 days (Phases 1-3)
**Blocker Issues**: 6 (must fix before production deployment)

**Next Steps**:
1. Review findings with development team
2. Prioritize CRITICAL fixes (Phase 1)
3. Schedule security testing after Phase 1 completion
4. Begin PIV architecture planning (Phase 3)
5. Coordinate with infrastructure team for PIV validation service deployment

**Auditor Signature**: Federal Authentication Compliance Specialist
**Date**: 2025-12-31

---

END OF REPORT
