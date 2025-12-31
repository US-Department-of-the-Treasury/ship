# Security Audit Report: Ship Application

**Audit Date:** 2025-12-31
**Application:** Ship - Collaborative Project Management System
**Technology Stack:** Node.js/Express API, React Frontend, PostgreSQL Database, WebSocket Collaboration
**Deployment Context:** Government Production Environment
**Auditor:** Security Sentinel (Automated Security Analysis)

---

## Executive Summary

This security audit identified **5 CRITICAL**, **6 HIGH**, **6 MEDIUM**, and **4 LOW** severity vulnerabilities in the Ship application codebase. The application shows good security practices in several areas (parameterized SQL queries, bcrypt password hashing, Helmet security headers) but has significant gaps that **MUST** be addressed before government production deployment.

### Critical Risk Assessment

**DEPLOYMENT READINESS: NOT APPROVED FOR PRODUCTION**

The most severe finding is the **completely unauthenticated WebSocket collaboration server**, which allows any external actor to read, modify, or corrupt document content without authentication. This is a **SHOWSTOPPER** for government deployment.

### Priority Remediation Path

1. **IMMEDIATE (Before any deployment):**
   - Implement authentication for WebSocket collaboration server
   - Add rate limiting to login and API endpoints
   - Implement CSRF protection
   - Fix SameSite cookie configuration

2. **HIGH PRIORITY (Within 1 week):**
   - Consolidate duplicate auth middleware
   - Implement account lockout after failed login attempts
   - Remove dev credentials from frontend code
   - Add comprehensive security logging

3. **MEDIUM PRIORITY (Within 2 weeks):**
   - Add session regeneration on login
   - Implement strict Content Security Policy
   - Add password complexity requirements
   - Review and sanitize error messages

---

## Critical Severity Findings

### C-1: Unauthenticated WebSocket Collaboration Server

**Severity:** CRITICAL
**CVSS Score:** 9.8 (Critical)
**CWE:** CWE-306: Missing Authentication for Critical Function
**File:** `/Users/corcoss/code/ship/.worktrees/deploy/api/src/collaboration/index.ts`
**Lines:** 226-243, 245-307

**Description:**

The WebSocket collaboration server at `/collaboration/*` has **NO authentication mechanism**. Any client can connect to any document by guessing or enumerating document IDs and gain full read/write access to document content via Yjs CRDT operations.

**Proof of Concept:**

```javascript
// Attacker code - no authentication required
const ws = new WebSocket('ws://api.example.gov/collaboration/issue:12345678-1234-1234-1234-123456789abc');
ws.onopen = () => {
  // Can now read and modify document content
};
```

**Impact:**

- **Confidentiality:** Complete breach - all document content readable
- **Integrity:** Complete compromise - documents can be corrupted or modified
- **Availability:** DoS possible by flooding connections or corrupting documents
- **Compliance:** Fails FISMA requirements for access control

**Exploitation Complexity:** LOW (trivial to exploit)

**Affected Code:**

```typescript
// api/src/collaboration/index.ts:229-242
server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url || '', `http://${request.headers.host}`);

  // Only handle /collaboration/* paths
  if (!url.pathname.startsWith('/collaboration/')) {
    socket.destroy();
    return;
  }

  const docName = url.pathname.replace('/collaboration/', '');

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request, docName);
  });
});
```

**Recommended Remediation:**

1. **Parse and validate session cookie from upgrade request:**

```typescript
import { parse } from 'cookie';

server.on('upgrade', async (request, socket, head) => {
  const url = new URL(request.url || '', `http://${request.headers.host}`);

  if (!url.pathname.startsWith('/collaboration/')) {
    socket.destroy();
    return;
  }

  // AUTHENTICATE THE CONNECTION
  const cookies = parse(request.headers.cookie || '');
  const sessionId = cookies.session_id;

  if (!sessionId) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  try {
    // Validate session
    const result = await pool.query(
      `SELECT s.user_id, s.workspace_id, s.expires_at, s.last_activity
       FROM sessions s
       WHERE s.id = $1`,
      [sessionId]
    );

    const session = result.rows[0];
    const now = new Date();

    if (!session || new Date(session.expires_at) < now) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    // Verify user has access to the document
    const docId = parseDocId(url.pathname.replace('/collaboration/', ''));
    const docAccess = await pool.query(
      `SELECT id FROM documents WHERE id = $1 AND workspace_id = $2`,
      [docId, session.workspace_id]
    );

    if (docAccess.rows.length === 0) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    // Connection authenticated - proceed
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request, url.pathname.replace('/collaboration/', ''), session);
    });
  } catch (err) {
    console.error('WebSocket auth error:', err);
    socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
    socket.destroy();
  }
});
```

2. **Update connection handler to store authenticated session:**

```typescript
wss.on('connection', async (ws: WebSocket, _request: IncomingMessage, docName: string, session: any) => {
  // Store session info with connection
  conns.set(ws, {
    docName,
    awarenessClientId: doc.clientID,
    userId: session.user_id,
    workspaceId: session.workspace_id
  });
  // ... rest of handler
});
```

**Verification Steps:**

1. Attempt to connect to WebSocket without session cookie - should fail with 401
2. Attempt to connect with expired session - should fail with 401
3. Attempt to connect to document in different workspace - should fail with 403
4. Connect with valid session to own workspace document - should succeed

---

### C-2: No Rate Limiting on Authentication Endpoints

**Severity:** CRITICAL
**CVSS Score:** 8.6 (High-Critical)
**CWE:** CWE-307: Improper Restriction of Excessive Authentication Attempts
**File:** `/Users/corcoss/code/ship/.worktrees/deploy/api/src/routes/auth.ts`
**Lines:** 12-100

**Description:**

The `/api/auth/login` endpoint has no rate limiting, allowing unlimited authentication attempts. This enables credential stuffing, brute force attacks, and user enumeration.

**Impact:**

- **Brute Force Attacks:** Attackers can attempt thousands of password combinations
- **Credential Stuffing:** Leaked credentials from other breaches can be tested at scale
- **User Enumeration:** Different response times/messages may reveal valid usernames
- **Resource Exhaustion:** bcrypt operations are CPU-intensive, can DoS the server

**Exploitation Complexity:** LOW

**Recommended Remediation:**

1. **Install express-rate-limit:**

```bash
pnpm add express-rate-limit
```

2. **Apply strict rate limiting to auth endpoints:**

```typescript
// api/src/routes/auth.ts
import rateLimit from 'express-rate-limit';

// Login rate limiter: 5 attempts per 15 minutes per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per windowMs
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many login attempts. Please try again in 15 minutes.'
    }
  },
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  // Use email + IP for more granular limiting
  keyGenerator: (req) => {
    return `${req.ip}_${req.body.email || 'unknown'}`;
  },
});

// Apply to login route
router.post('/login', loginLimiter, async (req: Request, res: Response) => {
  // ... existing login logic
});
```

3. **Add general API rate limiting:**

```typescript
// api/src/app.ts
import rateLimit from 'express-rate-limit';

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per windowMs per IP
  message: {
    error: 'Too many requests from this IP, please try again later.'
  }
});

// Apply to all API routes
app.use('/api/', apiLimiter);
```

**Additional Recommendations:**

- Implement account lockout after 10 failed attempts (store in database)
- Add CAPTCHA after 3 failed attempts
- Log all failed authentication attempts with IP, timestamp, username
- Consider implementing exponential backoff

---

### C-3: Missing CSRF Protection

**Severity:** CRITICAL
**CVSS Score:** 8.1 (High)
**CWE:** CWE-352: Cross-Site Request Forgery
**File:** `/Users/corcoss/code/ship/.worktrees/deploy/api/src/app.ts`
**Lines:** 12-37

**Description:**

The application has no CSRF protection for state-changing operations (POST, PATCH, DELETE). While `sameSite: 'lax'` provides some protection, it does NOT protect against:
- Same-site attacks (attacker subdomain on same gov domain)
- Top-level GET-based CSRF that triggers POST
- Browser bugs/bypasses in SameSite implementation

**Impact:**

An attacker can trick authenticated users into performing unintended actions:
- Delete documents
- Modify issue states
- Assign users to programs
- Change user settings

**Attack Scenario:**

```html
<!-- Attacker's page on evil.com or compromised.gov subdomain -->
<form id="csrf-form" action="https://ship.example.gov/api/documents/12345" method="POST">
  <input type="hidden" name="title" value="Hacked by attacker">
</form>
<script>
  document.getElementById('csrf-form').submit();
</script>
```

**Recommended Remediation:**

1. **Install csrf-csrf (double submit cookie pattern):**

```bash
pnpm add csrf-csrf
```

2. **Configure CSRF protection:**

```typescript
// api/src/app.ts
import { doubleCsrf } from 'csrf-csrf';

const {
  generateToken,
  doubleCsrfProtection,
} = doubleCsrf({
  getSecret: () => process.env.CSRF_SECRET || 'default-dev-secret-change-in-prod',
  cookieName: '__Host-csrf-token', // Use __Host- prefix for security
  cookieOptions: {
    sameSite: 'strict', // Upgrade to strict
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
  },
  size: 64,
  ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
});

// Apply CSRF protection to all routes except auth
app.use('/api', (req, res, next) => {
  // Skip CSRF for login (no session yet)
  if (req.path === '/auth/login') {
    return next();
  }
  doubleCsrfProtection(req, res, next);
});

// Endpoint to get CSRF token
app.get('/api/csrf-token', (req, res) => {
  const token = generateToken(req, res);
  res.json({ token });
});
```

3. **Update frontend to include CSRF token:**

```typescript
// web/src/lib/api.ts
let csrfToken: string | null = null;

async function getCsrfToken(): Promise<string> {
  if (!csrfToken) {
    const response = await fetch(`${API_URL}/api/csrf-token`, {
      credentials: 'include',
    });
    const data = await response.json();
    csrfToken = data.token;
  }
  return csrfToken;
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers as Record<string, string>,
  };

  // Add CSRF token for state-changing requests
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(options.method || 'GET')) {
    const token = await getCsrfToken();
    headers['x-csrf-token'] = token;
  }

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    credentials: 'include',
    headers,
  });

  // If CSRF token invalid, clear and retry once
  if (response.status === 403) {
    csrfToken = null;
    // ... retry logic
  }

  return response.json();
}
```

---

### C-4: Duplicate Authentication Middleware Implementations

**Severity:** CRITICAL (Security Architecture)
**CVSS Score:** 7.5 (High)
**CWE:** CWE-1188: Insecure Default Initialization of Resource
**Files:**
- `/Users/corcoss/code/ship/.worktrees/deploy/api/src/middleware/auth.ts` (centralized)
- `/Users/corcoss/code/ship/.worktrees/deploy/api/src/routes/documents.ts:9-47`
- `/Users/corcoss/code/ship/.worktrees/deploy/api/src/routes/issues.ts:9-46`
- `/Users/corcoss/code/ship/.worktrees/deploy/api/src/routes/programs.ts:9-46`
- `/Users/corcoss/code/ship/.worktrees/deploy/api/src/routes/sprints.ts:9-46`
- `/Users/corcoss/code/ship/.worktrees/deploy/api/src/routes/team.ts:8-45`

**Description:**

There are **6 different implementations** of authentication middleware across the codebase. The centralized `authMiddleware` in `/middleware/auth.ts` checks for session timeout and updates `last_activity`, but all route-specific implementations have subtly different logic:

**Centralized middleware (correct):**
- Checks session expiration using `SESSION_TIMEOUT_MS` constant
- Calculates inactivity: `now - last_activity > SESSION_TIMEOUT_MS`
- **Deletes expired sessions from database**
- Updates `last_activity` timestamp

**Route-specific middleware (inconsistent):**
- Only checks `expires_at > now()` (does NOT check inactivity timeout)
- Updates `expires_at = now() + interval '15 minutes'` (database-level calculation)
- Does NOT delete expired sessions
- Different error messages and response structures

**Impact:**

- **Inconsistent security enforcement** - session timeout behavior differs by endpoint
- **Session table bloat** - expired sessions never cleaned up by route handlers
- **Authentication bypass potential** - if centralized middleware is updated but route-specific ones are forgotten
- **Maintenance nightmare** - security fixes must be applied in 6 places

**Recommended Remediation:**

1. **Remove all route-specific auth middleware:**

Delete the `requireAuth` function from:
- `routes/documents.ts`
- `routes/issues.ts`
- `routes/programs.ts`
- `routes/sprints.ts`
- `routes/team.ts`

2. **Import and use centralized middleware everywhere:**

```typescript
// All route files should do this:
import { authMiddleware } from '../middleware/auth.js';

// Replace all instances of:
router.get('/', requireAuth, async (req, res) => { ... });

// With:
router.get('/', authMiddleware, async (req, res) => { ... });
```

3. **Ensure Express Request type augmentation is consistent:**

The centralized middleware uses:
```typescript
req.sessionId?: string;
req.userId?: string;
req.workspaceId?: string;
```

But route files use:
```typescript
req.user?: { id: string; email: string; name: string; workspaceId: string; };
```

**Choose one pattern and use it consistently.**

---

### C-5: Insecure Cookie Configuration (SameSite: lax)

**Severity:** HIGH-CRITICAL
**CVSS Score:** 7.4 (High)
**CWE:** CWE-1275: Sensitive Cookie with Improper SameSite Attribute
**File:** `/Users/corcoss/code/ship/.worktrees/deploy/api/src/routes/auth.ts`
**Line:** 76

**Description:**

Session cookies use `sameSite: 'lax'` instead of `sameSite: 'strict'`. This allows cookies to be sent on top-level cross-site navigations (e.g., clicking a link from another site), creating CSRF attack vectors.

**Current Configuration:**

```typescript
// api/src/routes/auth.ts:73-78
res.cookie('session_id', sessionId, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',  // ❌ INSECURE
  maxAge: SESSION_TIMEOUT_MS,
});
```

**Attack Scenario:**

1. User is authenticated on `ship.example.gov`
2. Attacker sends phishing email with link to `https://ship.example.gov/api/documents/delete?id=123`
3. User clicks link - browser sends session cookie due to `sameSite: lax`
4. Document deleted without CSRF protection

**Recommended Remediation:**

```typescript
res.cookie('session_id', sessionId, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict', // ✅ SECURE - blocks all cross-site cookie sending
  maxAge: SESSION_TIMEOUT_MS,
  path: '/', // Explicit path
});
```

**Note:** Changing to `strict` means users navigating to the app from external links (e.g., email notifications) will need to log in. This is the correct behavior for a government application.

---

## High Severity Findings

### H-1: Information Disclosure via Error Messages

**Severity:** HIGH
**CVSS Score:** 6.5 (Medium)
**CWE:** CWE-209: Generation of Error Message Containing Sensitive Information
**Files:** All route files (10+ instances)

**Description:**

Error handlers throughout the application use `console.error` to log full error objects, which may contain:
- Database connection strings
- Full stack traces revealing code structure
- SQL query parameters
- Internal file paths

**Examples:**

```typescript
// api/src/routes/auth.ts:91-98
catch (error) {
  console.error('Login error:', error);
  res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
    success: false,
    error: {
      code: ERROR_CODES.INTERNAL_ERROR,
      message: 'Login failed',
    },
  });
}
```

In development, these errors appear in console logs which may be accessible via log aggregation services or compromised systems.

**Impact:**

- **Information Leakage:** Attackers learn about internal system structure
- **Attack Surface Mapping:** Stack traces reveal code organization
- **Credential Exposure:** Database errors may contain connection info

**Recommended Remediation:**

1. **Implement structured logging with sensitive data redaction:**

```typescript
// api/src/lib/logger.ts
import winston from 'winston';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 10485760, // 10MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 10485760,
      maxFiles: 10,
    }),
  ],
});

// Only log to console in development
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple(),
  }));
}

// Redact sensitive fields
const sensitiveFields = ['password', 'password_hash', 'session_id', 'token'];

export function sanitizeForLog(obj: any): any {
  if (typeof obj !== 'object' || obj === null) return obj;

  const sanitized = { ...obj };
  for (const field of sensitiveFields) {
    if (field in sanitized) {
      sanitized[field] = '[REDACTED]';
    }
  }
  return sanitized;
}

export default logger;
```

2. **Replace all console.error with structured logging:**

```typescript
// Before:
console.error('Login error:', error);

// After:
import logger from '@/lib/logger';

logger.error('Login failed', {
  error: error.message,
  code: error.code,
  userId: req.body.email, // Not the password!
  ip: req.ip,
});
```

3. **Never expose stack traces to clients in production:**

```typescript
// api/src/middleware/errorHandler.ts
export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    ip: req.ip,
  });

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: process.env.NODE_ENV === 'production'
        ? 'An internal error occurred'
        : err.message, // Only show details in dev
    },
  });
}
```

---

### H-2: No Account Lockout Mechanism

**Severity:** HIGH
**CVSS Score:** 6.5 (Medium)
**CWE:** CWE-307: Improper Restriction of Excessive Authentication Attempts
**File:** `/Users/corcoss/code/ship/.worktrees/deploy/api/src/routes/auth.ts`

**Description:**

Beyond rate limiting, there is no account-level lockout mechanism. An attacker can:
- Distribute attacks across many IPs (bypassing rate limiting)
- Target specific high-value accounts
- Lock out legitimate users (DoS via failed auth attempts)

**Recommended Remediation:**

1. **Add lockout tracking to database schema:**

```sql
-- api/src/db/schema.sql
ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until TIMESTAMPTZ NULL;
ALTER TABLE users ADD COLUMN last_failed_login TIMESTAMPTZ NULL;
```

2. **Implement lockout logic in login handler:**

```typescript
// api/src/routes/auth.ts - BEFORE password check
const user = userResult.rows[0];

if (!user) {
  // User enumeration protection - same timing as successful check
  await bcrypt.compare(password, '$2b$10$dummy.hash.to.prevent.timing.attacks');
  res.status(HTTP_STATUS.UNAUTHORIZED).json({
    success: false,
    error: {
      code: ERROR_CODES.INVALID_CREDENTIALS,
      message: 'Invalid email or password',
    },
  });
  return;
}

// Check if account is locked
if (user.locked_until && new Date(user.locked_until) > new Date()) {
  const minutesRemaining = Math.ceil(
    (new Date(user.locked_until).getTime() - Date.now()) / 60000
  );
  res.status(HTTP_STATUS.FORBIDDEN).json({
    success: false,
    error: {
      code: ERROR_CODES.ACCOUNT_LOCKED,
      message: `Account locked. Try again in ${minutesRemaining} minutes.`,
    },
  });
  return;
}

// Verify password
const validPassword = await bcrypt.compare(password, user.password_hash);

if (!validPassword) {
  // Increment failed attempts
  const newAttempts = user.failed_login_attempts + 1;
  const lockUntil = newAttempts >= 10
    ? new Date(Date.now() + 30 * 60 * 1000) // 30 min lockout
    : null;

  await pool.query(
    `UPDATE users
     SET failed_login_attempts = $1,
         last_failed_login = now(),
         locked_until = $2
     WHERE id = $3`,
    [newAttempts, lockUntil, user.id]
  );

  logger.warn('Failed login attempt', {
    email: user.email,
    attempts: newAttempts,
    ip: req.ip,
    locked: !!lockUntil,
  });

  res.status(HTTP_STATUS.UNAUTHORIZED).json({
    success: false,
    error: {
      code: ERROR_CODES.INVALID_CREDENTIALS,
      message: newAttempts >= 8
        ? `Invalid password. Account will be locked after ${10 - newAttempts} more attempts.`
        : 'Invalid email or password',
    },
  });
  return;
}

// Successful login - reset lockout
await pool.query(
  `UPDATE users
   SET failed_login_attempts = 0,
       locked_until = NULL,
       last_failed_login = NULL
   WHERE id = $1`,
  [user.id]
);
```

---

### H-3: Default Development Credentials in Frontend Code

**Severity:** HIGH
**CVSS Score:** 7.5 (High)
**CWE:** CWE-798: Use of Hard-coded Credentials
**File:** `/Users/corcoss/code/ship/.worktrees/deploy/web/src/pages/Login.tsx`
**Lines:** 7-8, 116-121

**Description:**

Development credentials are hardcoded in the frontend and **displayed on the login page**:

```typescript
const [email, setEmail] = useState(import.meta.env.DEV ? 'dev@ship.local' : '');
const [password, setPassword] = useState(import.meta.env.DEV ? 'admin123' : '');

// Later in render:
<div className="mt-8 text-center text-xs text-muted">
  <p>Dev credentials:</p>
  <p className="mt-1 font-mono text-muted">
    dev@ship.local / admin123
  </p>
</div>
```

**Impact:**

- If dev credentials exist in production database, immediate compromise
- Provides attackers with valid username format and password patterns
- Violates government security policy for credential handling

**Recommended Remediation:**

1. **Remove ALL hardcoded credentials:**

```typescript
// web/src/pages/Login.tsx
const [email, setEmail] = useState('');
const [password, setPassword] = useState('');

// Remove the dev credentials hint entirely
```

2. **Ensure dev credentials are NOT in production database:**

```sql
-- Check production database
SELECT email FROM users WHERE email = 'dev@ship.local';

-- If exists, DELETE immediately:
DELETE FROM users WHERE email = 'dev@ship.local';
```

3. **Use environment-specific seeding:**

```typescript
// api/src/db/seed.ts
// Only create dev user if explicitly enabled
if (process.env.CREATE_DEV_USER === 'true' && process.env.NODE_ENV === 'development') {
  // Create dev user
}
```

---

### H-4: No Session Regeneration on Login

**Severity:** HIGH
**CVSS Score:** 6.5 (Medium)
**CWE:** CWE-384: Session Fixation
**File:** `/Users/corcoss/code/ship/.worktrees/deploy/api/src/routes/auth.ts`
**Lines:** 62-70

**Description:**

The application does not regenerate session IDs after successful authentication, creating a session fixation vulnerability. An attacker could:
1. Obtain a valid session ID (pre-authentication)
2. Trick victim into authenticating with that session ID
3. Attacker's session ID becomes authenticated

**Current Code:**

```typescript
// Creates new session but doesn't invalidate any pre-existing sessions
const sessionId = uuidv4();
await pool.query(
  `INSERT INTO sessions (id, user_id, workspace_id, expires_at, last_activity)
   VALUES ($1, $2, $3, $4, $5)`,
  [sessionId, user.id, user.workspace_id, expiresAt, new Date()]
);
```

**Recommended Remediation:**

```typescript
// api/src/routes/auth.ts - in login handler BEFORE creating new session

// 1. Invalidate any existing sessions for this user (single-device enforcement)
// Or use this for multi-device:
await pool.query(
  `DELETE FROM sessions WHERE user_id = $1 AND expires_at < now()`,
  [user.id]
);

// 2. Create new session
const sessionId = uuidv4();
await pool.query(
  `INSERT INTO sessions (id, user_id, workspace_id, expires_at, last_activity)
   VALUES ($1, $2, $3, $4, $5)`,
  [sessionId, user.id, user.workspace_id, expiresAt, new Date()]
);

// 3. Set cookie with new session
res.cookie('session_id', sessionId, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: SESSION_TIMEOUT_MS,
});
```

**Additional Enhancement - Multi-device Session Management:**

```typescript
// Add device tracking
CREATE TABLE sessions (
  -- ... existing columns ...
  device_fingerprint TEXT,
  user_agent TEXT,
  ip_address INET,
  last_ip INET
);

// Store device info on session creation
const deviceFingerprint = createHash('sha256')
  .update(req.headers['user-agent'] + req.ip)
  .digest('hex');
```

---

### H-5: Missing Content Security Policy

**Severity:** HIGH
**CVSS Score:** 6.1 (Medium)
**CWE:** CWE-1021: Improper Restriction of Rendered UI Layers
**File:** `/Users/corcoss/code/ship/.worktrees/deploy/api/src/app.ts`
**Line:** 16

**Description:**

While Helmet is configured, no explicit Content Security Policy (CSP) is defined. The default Helmet CSP is overly permissive for a government application handling sensitive data.

**Current Configuration:**

```typescript
app.use(helmet()); // Default CSP
```

**Recommended Remediation:**

```typescript
// api/src/app.ts
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        // Only if absolutely necessary for TipTap or other components:
        "'unsafe-inline'", // ⚠️ Try to eliminate this
      ],
      styleSrc: [
        "'self'",
        "'unsafe-inline'", // Required for styled-components/CSS-in-JS
      ],
      imgSrc: ["'self'", "data:", "https:"], // data: for inline images in editor
      fontSrc: ["'self'"],
      connectSrc: [
        "'self'",
        process.env.WS_URL || "ws://localhost:3000", // WebSocket
        process.env.API_URL || "http://localhost:3000", // API
      ],
      frameSrc: ["'none'"], // Prevent framing
      objectSrc: ["'none'"], // No Flash/plugins
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"], // Prevent clickjacking
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
    },
  },
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  },
  frameguard: {
    action: 'deny', // Prevent all framing
  },
  referrerPolicy: {
    policy: 'strict-origin-when-cross-origin',
  },
}));
```

**Important:** Review `scriptSrc: ["'unsafe-inline'"]` - this weakens XSS protection. Ideally, use nonces or hashes:

```typescript
// Generate nonce per request
app.use((req, res, next) => {
  res.locals.nonce = crypto.randomBytes(16).toString('base64');
  next();
});

// Use in CSP
scriptSrc: ["'self'", (req, res) => `'nonce-${res.locals.nonce}'`],

// In HTML:
<script nonce="<%= nonce %>">...</script>
```

---

### H-6: Password Strength Not Enforced

**Severity:** HIGH
**CVSS Score:** 5.9 (Medium)
**CWE:** CWE-521: Weak Password Requirements
**File:** `/Users/corcoss/code/ship/.worktrees/deploy/api/src/routes/auth.ts`

**Description:**

There is no password complexity validation. Users can set weak passwords like "password", "123456", or even empty strings (though required by frontend form validation).

**Recommended Remediation:**

1. **Install password strength validator:**

```bash
pnpm add zxcvbn @types/zxcvbn
```

2. **Implement password validation schema:**

```typescript
// api/src/validators/password.ts
import zxcvbn from 'zxcvbn';
import { z } from 'zod';

export const passwordSchema = z.string()
  .min(12, 'Password must be at least 12 characters')
  .max(128, 'Password must be less than 128 characters')
  .refine((password) => {
    // Check complexity with zxcvbn
    const result = zxcvbn(password);
    return result.score >= 3; // 0-4 scale, require "strong"
  }, {
    message: 'Password is too weak. Use a mix of uppercase, lowercase, numbers, and symbols.',
  })
  .refine((password) => {
    // NIST SP 800-63B: Check against common passwords
    const commonPasswords = [
      'password', 'Password1', '123456', 'admin123',
      'qwerty', 'letmein', 'welcome', 'monkey123'
    ];
    return !commonPasswords.some(common =>
      password.toLowerCase().includes(common.toLowerCase())
    );
  }, {
    message: 'Password contains common patterns. Choose a more unique password.',
  });
```

3. **Apply to user registration/password change:**

```typescript
// In user creation or password update endpoints:
import { passwordSchema } from '@/validators/password';

const parsed = z.object({
  email: z.string().email(),
  password: passwordSchema,
  name: z.string().min(1),
}).safeParse(req.body);

if (!parsed.success) {
  res.status(400).json({
    error: 'Validation failed',
    details: parsed.error.errors
  });
  return;
}
```

---

## Medium Severity Findings

### M-1: No Security Event Logging

**Severity:** MEDIUM
**CVSS Score:** 5.3 (Medium)
**CWE:** CWE-778: Insufficient Logging

**Description:**

The application lacks comprehensive security event logging required for:
- FISMA compliance (audit trails)
- Incident response
- Forensic analysis
- Compliance audits

**Missing Logs:**

- Failed login attempts (IP, username, timestamp)
- Successful logins (IP, user agent, session ID)
- Account lockouts
- Password changes
- Privilege escalation attempts
- Document access (especially sensitive documents)
- Session terminations
- API rate limit violations
- CSRF token mismatches
- WebSocket connection attempts (after auth implemented)

**Recommended Remediation:**

Implement structured security event logging with fields:
- Timestamp (ISO 8601)
- Event type (auth.login, auth.failed, doc.access, etc.)
- User ID (if authenticated)
- IP address
- User agent
- Session ID
- Resource accessed (document ID, endpoint)
- Result (success/failure)
- Error code (if failure)

**Example:**

```typescript
// api/src/lib/securityLogger.ts
import logger from './logger';

export const securityEvents = {
  LOGIN_SUCCESS: 'auth.login.success',
  LOGIN_FAILED: 'auth.login.failed',
  ACCOUNT_LOCKED: 'auth.account.locked',
  SESSION_EXPIRED: 'auth.session.expired',
  CSRF_VIOLATION: 'security.csrf.violation',
  RATE_LIMIT_EXCEEDED: 'security.ratelimit.exceeded',
  DOCUMENT_ACCESSED: 'resource.document.accessed',
  UNAUTHORIZED_ACCESS: 'security.unauthorized.attempt',
};

export function logSecurityEvent(
  event: string,
  req: Request,
  details?: Record<string, any>
) {
  logger.info('Security event', {
    event,
    timestamp: new Date().toISOString(),
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    userId: req.userId,
    sessionId: req.sessionId,
    path: req.path,
    method: req.method,
    ...details,
  });
}
```

---

### M-2: innerHTML Usage in DragHandle Component

**Severity:** MEDIUM
**CVSS Score:** 5.4 (Medium)
**CWE:** CWE-79: Cross-Site Scripting (XSS)
**File:** `/Users/corcoss/code/ship/.worktrees/deploy/web/src/components/editor/DragHandle.tsx`

**Description:**

The DragHandle component uses `innerHTML` to set SVG content. While the current implementation uses hardcoded SVG strings (not user input), this pattern is risky and should be avoided.

**Current Code:**

```typescript
handle.innerHTML = `<svg>...</svg>`;
```

**Recommended Remediation:**

Use React's JSX to render SVG directly instead of `innerHTML`:

```tsx
// Instead of setting innerHTML, render the SVG as JSX
<div className="drag-handle" draggable>
  <svg width="16" height="16" viewBox="0 0 16 16">
    {/* SVG paths here */}
  </svg>
</div>
```

---

### M-3: No HTTP Strict Transport Security (HSTS)

**Severity:** MEDIUM
**CVSS Score:** 5.9 (Medium)
**CWE:** CWE-523: Unprotected Transport of Credentials

**Description:**

While Helmet is configured, HSTS is not explicitly enabled with appropriate settings for government deployment.

**Recommended Remediation:**

Already covered in H-5 CSP configuration above. Add:

```typescript
hsts: {
  maxAge: 31536000, // 1 year
  includeSubDomains: true,
  preload: true, // Submit to HSTS preload list
},
```

**Additional Step:** Submit domain to HSTS preload list at https://hstspreload.org/ after testing

---

### M-4: Database Connection Pool Not Configured

**Severity:** MEDIUM
**CVSS Score:** 4.3 (Medium)
**CWE:** CWE-400: Uncontrolled Resource Consumption
**File:** `/Users/corcoss/code/ship/.worktrees/deploy/api/src/db/client.ts`
**Lines:** 15-17

**Description:**

The PostgreSQL connection pool uses default settings without limits, potentially leading to resource exhaustion.

**Current Code:**

```typescript
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
```

**Recommended Remediation:**

```typescript
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20, // Maximum pool size
  idleTimeoutMillis: 30000, // Close idle clients after 30s
  connectionTimeoutMillis: 2000, // Fail fast if can't connect
  statement_timeout: 10000, // Cancel queries after 10s
  query_timeout: 10000,
  application_name: 'ship-api',
});

// Handle pool errors
pool.on('error', (err) => {
  logger.error('Unexpected database pool error', { error: err.message });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, closing database pool');
  await pool.end();
  process.exit(0);
});
```

---

### M-5: No Email Verification

**Severity:** MEDIUM
**CVSS Score:** 4.3 (Medium)
**CWE:** CWE-20: Improper Input Validation

**Description:**

Users can create accounts with any email address without verification, enabling:
- Account enumeration
- Spam/abuse
- Impersonation attacks
- Unauthorized access to workspace data

**Recommended Remediation:**

Implement email verification flow:

1. Add `email_verified` column to users table
2. Generate verification token on registration
3. Send verification email
4. Require verification before full access

---

### M-6: SQL Query Timeout Not Enforced

**Severity:** MEDIUM
**CVSS Score:** 4.0 (Medium)
**CWE:** CWE-400: Uncontrolled Resource Consumption

**Description:**

Long-running queries could lock database resources. Already addressed in M-4 remediation above with `statement_timeout: 10000`.

---

## Low Severity Findings

### L-1: Console Logging in Production

**Severity:** LOW
**CVSS Score:** 3.1 (Low)
**CWE:** CWE-532: Insertion of Sensitive Information into Log File

**Description:**

Multiple `console.log`, `console.error`, `console.warn` statements throughout the codebase will expose information in production logs.

**Recommended Remediation:**

Replace all console statements with structured logger (see H-1 remediation).

---

### L-2: No API Versioning

**Severity:** LOW
**CVSS Score:** 2.0 (Low)
**Impact:** Future maintenance difficulty

**Description:**

API routes use `/api/` prefix without version numbers, making breaking changes difficult to manage.

**Recommended Remediation:**

```typescript
// Use versioned routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/documents', documentsRoutes);
```

---

### L-3: Weak Random Number Generation for Prefixes

**Severity:** LOW
**CVSS Score:** 2.6 (Low)
**CWE:** CWE-338: Use of Cryptographically Weak PRNG
**File:** `/Users/corcoss/code/ship/.worktrees/deploy/api/src/routes/programs.ts`
**Lines:** 48-56

**Description:**

Program prefix generation uses `Math.random()` which is predictable:

```typescript
function generatePrefix(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let result = 'PRG';
  for (let i = 0; i < 5; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
```

**Recommended Remediation:**

Use cryptographically secure random:

```typescript
import { randomInt } from 'crypto';

function generatePrefix(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let result = 'PRG';
  for (let i = 0; i < 5; i++) {
    result += chars.charAt(randomInt(0, chars.length));
  }
  return result;
}
```

---

### L-4: Generic Error Messages Reduce Usability

**Severity:** LOW
**Impact:** User experience

**Description:**

Some error messages are too generic (e.g., "Internal server error") making legitimate troubleshooting difficult.

**Recommended Remediation:**

Use specific error codes and maintain a mapping of codes to user-friendly messages:

```typescript
const ERROR_MESSAGES = {
  'AUTH_001': 'Invalid email or password',
  'AUTH_002': 'Your account has been locked. Contact support.',
  'DOC_001': 'Document not found or you don\'t have access',
  'DOC_002': 'Unable to save document. Please try again.',
  // etc.
};
```

---

## OWASP Top 10 2021 Compliance Assessment

| OWASP Category | Status | Findings |
|----------------|--------|----------|
| **A01:2021 – Broken Access Control** | ❌ FAIL | C-1: No WebSocket auth, C-4: Inconsistent auth middleware |
| **A02:2021 – Cryptographic Failures** | ⚠️ PARTIAL | Good: bcrypt passwords. Bad: Math.random() for prefixes (L-3) |
| **A03:2021 – Injection** | ✅ PASS | All SQL queries use parameterization |
| **A04:2021 – Insecure Design** | ❌ FAIL | C-2: No rate limiting, H-2: No account lockout, C-3: No CSRF |
| **A05:2021 – Security Misconfiguration** | ❌ FAIL | C-5: Weak SameSite, H-5: Weak CSP, H-3: Dev creds in code |
| **A06:2021 – Vulnerable Components** | ✅ PASS | No known vulnerabilities in dependencies |
| **A07:2021 – Authentication Failures** | ❌ FAIL | C-2: No rate limiting, H-2: No session regeneration, H-6: Weak passwords |
| **A08:2021 – Software and Data Integrity** | ⚠️ PARTIAL | No subresource integrity, but HTTPS required |
| **A09:2021 – Security Logging Failures** | ❌ FAIL | M-1: Insufficient security event logging |
| **A10:2021 – Server-Side Request Forgery** | ✅ PASS | No SSRF vectors identified |

**Overall OWASP Compliance: 20% (2/10 categories passed)**

---

## FISMA Compliance Assessment

| Control Family | Status | Gaps |
|----------------|--------|------|
| **AC (Access Control)** | ❌ CRITICAL | C-1: Unauthenticated WebSocket, C-4: Inconsistent auth |
| **AU (Audit and Accountability)** | ❌ HIGH | M-1: No security event logging |
| **IA (Identification and Authentication)** | ❌ CRITICAL | C-2: No rate limit, H-2: No session regen, H-6: Weak passwords |
| **SC (System and Communications)** | ⚠️ PARTIAL | M-3: HSTS not configured, C-5: Weak SameSite |
| **SI (System and Information Integrity)** | ⚠️ PARTIAL | H-1: Info disclosure in errors, M-2: innerHTML usage |

**FISMA ATO Readiness: NOT READY**

Critical gaps in Access Control and Identification & Authentication control families block ATO approval.

---

## Security Testing Recommendations

Before production deployment, perform:

1. **Penetration Testing:**
   - WebSocket authentication bypass attempts
   - CSRF exploitation testing
   - Session fixation testing
   - Rate limiting effectiveness
   - SQL injection attempts (confirm parameterization works)

2. **Automated Scanning:**
   - OWASP ZAP full scan
   - Burp Suite automated scan
   - npm audit / pnpm audit
   - Snyk vulnerability scan
   - SonarQube security analysis

3. **Manual Code Review:**
   - All authentication/authorization code paths
   - All database queries
   - All user input handling
   - All file upload handlers (if any)
   - All WebSocket message handlers

4. **Load Testing:**
   - Test rate limiting under load
   - Test session management with many concurrent users
   - Test database connection pooling limits
   - Test WebSocket connection limits

---

## Remediation Priority Matrix

| Priority | Findings | Estimated Effort | Must Complete Before |
|----------|----------|------------------|---------------------|
| **P0 - CRITICAL** | C-1, C-2, C-3 | 3-4 days | ANY deployment |
| **P1 - HIGH** | C-4, C-5, H-1, H-2 | 2-3 days | Production deployment |
| **P2 - HIGH** | H-3, H-4, H-5, H-6 | 2-3 days | Production deployment |
| **P3 - MEDIUM** | M-1 through M-6 | 3-4 days | ATO approval |
| **P4 - LOW** | L-1 through L-4 | 1-2 days | Nice to have |

**Total Estimated Remediation Effort: 11-16 business days**

---

## Positive Security Findings

The following security practices are correctly implemented:

✅ **Parameterized SQL Queries:** All database queries use `$1, $2` placeholders preventing SQL injection
✅ **bcrypt Password Hashing:** Strong password hashing with appropriate work factor
✅ **Helmet Security Headers:** Basic security headers configured
✅ **CORS Configuration:** CORS properly configured with credentials
✅ **HttpOnly Session Cookies:** Session cookies inaccessible to JavaScript
✅ **Input Validation with Zod:** Strong input validation on API endpoints
✅ **Workspace Isolation:** All queries include workspace_id checks
✅ **No Dependency Vulnerabilities:** Clean pnpm audit results
✅ **PostgreSQL Foreign Keys:** Database referential integrity enforced
✅ **Session Expiration:** 15-minute inactivity timeout implemented

---

## Conclusion

The Ship application demonstrates solid foundational security practices but has **critical gaps that block production deployment**, particularly:

1. **Complete lack of authentication on the WebSocket collaboration server** (CRITICAL)
2. **No rate limiting or brute force protection** (CRITICAL)
3. **Missing CSRF protection** (CRITICAL)
4. **Multiple inconsistent authentication implementations** (CRITICAL)

These must be remediated immediately before any production use, especially in a government context requiring FISMA compliance.

The recommended remediation path is:
1. Fix critical issues (C-1 through C-5) - **3-4 days**
2. Fix high-priority issues (H-1 through H-6) - **4-6 days**
3. Fix medium-priority issues (M-1 through M-6) - **3-4 days**
4. Conduct security testing and validation - **2-3 days**
5. Obtain ATO approval

**Estimated time to production-ready: 12-17 business days**

---

## References

- OWASP Top 10 2021: https://owasp.org/Top10/
- NIST SP 800-53 Rev. 5: https://csrc.nist.gov/publications/detail/sp/800-53/rev-5/final
- NIST SP 800-63B: Digital Identity Guidelines (Authentication)
- CWE Top 25: https://cwe.mitre.org/top25/
- Node.js Security Best Practices: https://nodejs.org/en/docs/guides/security/
- Express Security Best Practices: https://expressjs.com/en/advanced/best-practice-security.html

---

**Report Generated:** 2025-12-31
**Next Review Recommended:** After remediation completion and before production deployment
**Contact:** Security team for remediation questions and verification testing
