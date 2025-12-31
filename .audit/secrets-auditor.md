# Secrets Management Audit Report
**Date:** 2025-12-31
**Project:** Ship - Treasury Department Project Management Tool
**Auditor:** Claude Code Secrets Auditor Agent

---

## Executive Summary

### Overall Posture: MODERATE RISK

The codebase demonstrates good baseline security hygiene (proper .gitignore, no hardcoded API keys, environment variable usage) but has **critical gaps** for government deployment:

- **No SSM Parameter Store integration** - All secrets are managed via .env files
- **Unsigned session cookies** - SESSION_SECRET documented but not implemented
- **Secrets logged during development** - DATABASE_URL logged in seed script
- **Default credentials in code** - Test password "admin123" hardcoded in multiple places

**Pre-production deployment blockers identified:** 3 Critical, 2 High, 3 Medium

---

## Critical Issues

### 1. No AWS SSM Parameter Store Integration
**Severity:** Critical
**Location:** Entire codebase

**Finding:** The application loads secrets from `.env` files using `dotenv`, with no integration to AWS Systems Manager Parameter Store. For a government deployment, secrets must be fetched from SSM at runtime.

**Files affected:**
- `api/src/db/client.ts:10-11`
- `api/src/db/seed.ts:14-15`
- `api/src/index.ts:12-13`

**Current pattern:**
```javascript
config({ path: join(__dirname, '../.env.local') });
config({ path: join(__dirname, '../.env') });
```

**Required pattern:**
```javascript
// Fetch from SSM Parameter Store
const DATABASE_URL = await getSSMSecret('/ship/prod/database-url');
const SESSION_SECRET = await getSSMSecret('/ship/prod/session-secret');
```

**Remediation:**
1. Add AWS SDK dependency: `@aws-sdk/client-ssm`
2. Create `api/src/config/ssm.ts` to fetch secrets
3. Implement SSM naming convention: `/{project}/{environment}/{secret-name}`
4. Update all config loading to use SSM in production
5. Keep .env files for local development only

---

### 2. Database Credentials Logged in Seed Script
**Severity:** Critical
**Location:** `api/src/db/seed.ts:23`

**Finding:** The seed script logs the full `DATABASE_URL` to console, which typically contains username, password, and connection details.

**Code:**
```javascript
console.log(`   Database: ${process.env.DATABASE_URL}`);
```

**Risk:** If logs are collected (CloudWatch, Splunk), database credentials will be exposed. This violates NIST 800-53 AU-9 (Protection of Audit Information).

**Remediation:**
```javascript
// Before (bad)
console.log(`   Database: ${process.env.DATABASE_URL}`);

// After (good)
const dbHost = new URL(process.env.DATABASE_URL).hostname;
console.log(`   Database host: ${dbHost}`);
```

---

### 3. SESSION_SECRET Documented But Not Implemented
**Severity:** Critical
**Location:**
- `README.md:235` (documented)
- `api/src/app.ts` (not used)

**Finding:** The README documents `SESSION_SECRET` as "Required" but the application doesn't sign cookies with it. The app uses `cookie-parser` without a secret, and `express-session` is not configured.

**Current implementation:**
```javascript
app.use(cookieParser()); // No secret provided
```

**Risk:** Session cookies are not cryptographically signed, allowing tampering. An attacker could forge session IDs to impersonate users.

**Remediation:**
```javascript
// In api/src/app.ts
import session from 'express-session';

app.use(cookieParser(process.env.SESSION_SECRET));
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: SESSION_TIMEOUT_MS
  }
}));
```

And add to SSM:
```bash
aws ssm put-parameter \
  --name "/ship/prod/session-secret" \
  --value "$(openssl rand -base64 32)" \
  --type "SecureString"
```

---

## High Severity Issues

### 4. Default Test Password in Production Code
**Severity:** High
**Location:** Multiple files

**Finding:** The default password "admin123" is hardcoded in production code paths, not just test files.

**Files:**
- `api/src/db/seed.ts:72` - Password hash generation
- `api/src/db/seed.ts:92` - Logged to console
- `api/src/db/seed.ts:1131` - Logged to console
- `web/src/pages/Login.tsx:8` - Auto-filled in dev mode
- `README.md:116` - Documented

**Risk:** If seed script runs in production with default credentials, attackers have known credentials for initial accounts.

**Remediation:**
1. Generate random passwords for seed users in production
2. Force password reset on first login
3. Remove password from dev auto-fill
4. Add warning comment that seed script is **development only**

---

### 5. Missing Environment-Specific Secret Loading
**Severity:** High
**Location:** Configuration loading pattern

**Finding:** No environment detection for secret loading strategy. Production should use SSM, not .env files.

**Required pattern:**
```javascript
async function loadSecrets() {
  if (process.env.NODE_ENV === 'production') {
    // Load from SSM Parameter Store
    return loadFromSSM();
  } else {
    // Load from .env for local development
    config({ path: '.env.local' });
    config({ path: '.env' });
  }
}
```

---

## Medium Severity Issues

### 6. No Secrets in .env.template
**Severity:** Medium
**Location:** `research/configs/api/.env.template`

**Finding:** The `.env.template` file doesn't include `SESSION_SECRET` even though README says it's required.

**Remediation:** Add to template:
```bash
# Session
SESSION_SECRET=generate-with-openssl-rand-base64-32
```

---

### 7. Cookie Security Configuration
**Severity:** Medium
**Location:** `api/src/routes/auth.ts:73-78`

**Finding:** Session cookies use `sameSite: 'lax'` which is less secure than `'strict'` for government applications.

**Current:**
```javascript
res.cookie('session_id', sessionId, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: SESSION_TIMEOUT_MS,
});
```

**Recommendation:** Use `sameSite: 'strict'` for production deployments.

---

### 8. Robots.txt Allows Full Indexing
**Severity:** Medium
**Location:** `web/public/robots.txt`

**Finding:** Production robots.txt allows full site indexing (`Allow: /`). For non-public government deployments, this should be restrictive.

**Current:**
```
User-agent: *
Allow: /
```

**Recommended for staging/internal:**
```
User-agent: *
Disallow: /
```

---

## Compliant Practices

### Properly Gitignored
The following sensitive patterns are correctly ignored:
- `.env`
- `.env.local`
- `.env.*.local`
- `*.pem` files (though none found)
- Private keys (none found)

### No Hardcoded API Keys
No API keys, AWS credentials, or OAuth tokens found hardcoded in:
- JavaScript/TypeScript files
- JSON configuration files
- YAML files
- Package configurations

### Password Hashing
User passwords are properly hashed using bcrypt with cost factor 10.

### Environment Variable Usage
Secrets are loaded from environment variables, not hardcoded:
- `DATABASE_URL` from `process.env`
- `PORT`, `CORS_ORIGIN`, `NODE_ENV` from environment

---

## SSM Parameter Store Naming Convention (REQUIRED)

For government deployment, implement this naming convention:

```
/{project}/{environment}/{secret-name}

Examples:
/ship/local/database-url
/ship/staging/database-url
/ship/prod/database-url
/ship/prod/session-secret
```

### IAM Policy Example (Least Privilege)
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameter",
        "ssm:GetParameters"
      ],
      "Resource": "arn:aws:ssm:*:*:parameter/ship/prod/*"
    }
  ]
}
```

---

## Pre-Deployment Checklist

### Critical (Deployment Blockers)
- [ ] Implement SSM Parameter Store integration
- [ ] Store DATABASE_URL in SSM as SecureString
- [ ] Generate and store SESSION_SECRET in SSM
- [ ] Sign session cookies with SESSION_SECRET
- [ ] Remove DATABASE_URL logging from seed script
- [ ] Disable seed script in production or use secure defaults

### High Priority
- [ ] Generate random passwords for production seed users
- [ ] Force password reset on first login
- [ ] Add environment detection for secret loading
- [ ] Update deployment documentation with SSM setup

### Medium Priority
- [ ] Add SESSION_SECRET to .env.template
- [ ] Change sameSite cookie attribute to 'strict'
- [ ] Update robots.txt for non-public deployments
- [ ] Remove dev auto-fill password from Login component

---

## Recommended Implementation: SSM Integration

### Step 1: Install AWS SDK
```bash
pnpm add @aws-sdk/client-ssm
```

### Step 2: Create SSM Client (`api/src/config/ssm.ts`)
```typescript
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const client = new SSMClient({ region: process.env.AWS_REGION || 'us-east-1' });

export async function getSSMSecret(name: string): Promise<string> {
  const command = new GetParameterCommand({
    Name: name,
    WithDecryption: true,
  });

  try {
    const response = await client.send(command);
    if (!response.Parameter?.Value) {
      throw new Error(`SSM parameter ${name} not found`);
    }
    return response.Parameter.Value;
  } catch (error) {
    console.error(`Failed to load SSM parameter ${name}:`, error);
    throw error;
  }
}
```

### Step 3: Load Secrets at Startup (`api/src/config/index.ts`)
```typescript
import { config } from 'dotenv';
import { getSSMSecret } from './ssm.js';

export async function loadConfig() {
  if (process.env.NODE_ENV === 'production') {
    // Production: Load from SSM Parameter Store
    const [databaseUrl, sessionSecret] = await Promise.all([
      getSSMSecret('/ship/prod/database-url'),
      getSSMSecret('/ship/prod/session-secret'),
    ]);

    process.env.DATABASE_URL = databaseUrl;
    process.env.SESSION_SECRET = sessionSecret;
  } else {
    // Development: Load from .env files
    config({ path: '.env.local' });
    config({ path: '.env' });
  }
}
```

---

## References

- **NIST 800-53 (Rev 5):** SC-12 (Cryptographic Key Management), AU-9 (Protection of Audit Information)
- **OMB M-22-09:** Federal Zero Trust Architecture guidance
- **AWS SSM Parameter Store:** https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html
- **OWASP Secrets Management:** https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html

---

## Conclusion

The Ship application has a solid foundation for secrets management but **requires SSM Parameter Store integration before production deployment**. The three critical blockers (no SSM, unsigned cookies, logged credentials) must be resolved for government compliance.

**Estimated remediation effort:** 8-16 hours for a senior developer familiar with AWS SDK and Express.js.

---

## Report Metadata

| Item | Value |
|------|-------|
| Files Scanned | 100+ |
| Secrets Found | 0 (hardcoded API keys/tokens) |
| Configuration Issues | 8 |
| Critical Issues | 3 |
| High Issues | 2 |
| Medium Issues | 3 |
