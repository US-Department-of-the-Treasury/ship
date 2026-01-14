/**
 * PIV Authentication Routes
 *
 * Provides OAuth-based PIV smartcard authentication via FPKI Validator.
 * These routes are only active when FPKI environment variables are configured.
 */

import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import crypto from 'crypto';
import { pool } from '../db/client.js';
import { getFPKIClient, isFPKIConfigured } from '../services/fpki.js';
import { SESSION_TIMEOUT_MS } from '@ship/shared';
import { logAuditEvent } from '../services/audit.js';

const router: RouterType = Router();

// OAuth state expiry (10 minutes - OAuth flows should complete quickly)
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

// Generate cryptographically secure session ID (same as auth.ts)
function generateSecureSessionId(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Store OAuth state in database (survives server restarts)
 */
async function storeOAuthState(state: string, nonce: string, codeVerifier: string): Promise<void> {
  const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MS);

  // Clean up expired states opportunistically (every ~10th request)
  if (Math.random() < 0.1) {
    await pool.query('DELETE FROM oauth_state WHERE expires_at < NOW()').catch(() => {});
  }

  await pool.query(
    'INSERT INTO oauth_state (state_id, nonce, code_verifier, expires_at) VALUES ($1, $2, $3, $4)',
    [state, nonce, codeVerifier, expiresAt]
  );
}

/**
 * Retrieve and delete OAuth state from database (one-time use)
 */
async function consumeOAuthState(state: string): Promise<{ nonce: string; codeVerifier: string } | null> {
  const result = await pool.query(
    'DELETE FROM oauth_state WHERE state_id = $1 AND expires_at > NOW() RETURNING nonce, code_verifier',
    [state]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return {
    nonce: result.rows[0].nonce,
    codeVerifier: result.rows[0].code_verifier,
  };
}

// GET /api/auth/piv/status - Check if PIV auth is available
router.get('/status', (_req: Request, res: Response): void => {
  res.json({
    success: true,
    data: {
      available: isFPKIConfigured(),
    },
  });
});

// GET /api/auth/piv/login - Initiate PIV login flow
router.get('/login', async (req: Request, res: Response): Promise<void> => {
  if (!isFPKIConfigured()) {
    res.status(503).json({
      success: false,
      error: { code: 'PIV_NOT_CONFIGURED', message: 'PIV authentication not configured' },
    });
    return;
  }

  try {
    const client = getFPKIClient();
    const { url, state, nonce, codeVerifier } = await client.getAuthorizationUrl();

    // Store OAuth state in database (survives server restarts)
    await storeOAuthState(state, nonce, codeVerifier);

    res.json({
      success: true,
      data: { authorizationUrl: url },
    });
  } catch (error) {
    console.error('PIV login initiation error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'PIV_INIT_ERROR', message: 'Failed to initiate PIV login' },
    });
  }
});

// GET /api/auth/piv/callback - Handle OAuth callback from FPKI Validator
router.get('/callback', async (req: Request, res: Response): Promise<void> => {
  const { code, state, error, error_description } = req.query;

  // Handle OAuth errors from the authorization server
  if (error) {
    console.error('PIV OAuth error:', error, error_description);
    await logAuditEvent({
      action: 'auth.piv_login_failed',
      details: { reason: 'oauth_error', error: String(error), errorDescription: String(error_description || '') },
      req,
    });
    res.redirect(`/login?error=${encodeURIComponent(String(error_description || error))}`);
    return;
  }

  // Validate and consume state from database (one-time use)
  if (!state || typeof state !== 'string') {
    console.error('PIV callback: Missing state parameter');
    await logAuditEvent({
      action: 'auth.piv_login_failed',
      details: { reason: 'missing_state_param' },
      req,
    });
    res.redirect('/login?error=Missing+state');
    return;
  }

  const oauthState = await consumeOAuthState(state);
  if (!oauthState) {
    console.error('PIV state not found or expired:', { state });
    await logAuditEvent({
      action: 'auth.piv_login_failed',
      details: { reason: 'invalid_or_expired_state' },
      req,
    });
    res.redirect('/login?error=Invalid+or+expired+state');
    return;
  }

  const { nonce: pivNonce, codeVerifier } = oauthState;

  try {
    const client = getFPKIClient();
    const { user: userInfo } = await client.handleCallback(
      { code: String(code), state },
      { state, nonce: pivNonce, codeVerifier }
    );

    // Extract user identity from PIV certificate claims
    const email = userInfo.email;
    const x509Subject = userInfo.x509Subject || ''; // e.g., "CN=LASTNAME.FIRSTNAME.MIDDLE.1234567890"
    const name = extractNameFromX509Subject(x509Subject) || email || 'Unknown';

    if (!email) {
      console.error('PIV callback: No email in userInfo', userInfo);
      await logAuditEvent({
        action: 'auth.piv_login_failed',
        details: { reason: 'no_email_in_certificate', x509Subject },
        req,
      });
      res.redirect('/login?error=No+email+in+certificate');
      return;
    }

    // Find existing user by email OR X.509 subject DN
    let user = await findUserByEmailOrSubjectDn(email, x509Subject);
    console.log(`[PIV DEBUG] User lookup for ${email}:`, user ? { id: user.id, email: user.email, is_super_admin: user.is_super_admin, last_workspace_id: user.last_workspace_id } : 'NOT FOUND');

    if (!user) {
      // No existing user - check for pending invite matching certificate identity
      const invite = await findPendingInvite(email, x509Subject);

      if (!invite) {
        // No invite = no access (PIV users must be pre-invited)
        console.log(`PIV login rejected: No invite found for ${email} / ${x509Subject}`);
        await logAuditEvent({
          action: 'auth.piv_login_failed',
          details: { reason: 'no_invite', email, x509Subject },
          req,
        });
        res.redirect('/login?error=' + encodeURIComponent('No invitation found. Please contact an administrator to request access.'));
        return;
      }

      // Create user from invite
      user = await createUserFromInvite(invite, email, name, x509Subject);

      // Log the invite acceptance
      await logAuditEvent({
        workspaceId: invite.workspace_id,
        actorUserId: user.id,
        action: 'invite.accept_piv',
        resourceType: 'invite',
        resourceId: invite.id,
        details: { email, x509Subject, role: invite.role },
        req,
      });
    } else if (!user.x509_subject_dn && x509Subject) {
      // Update existing user with X.509 subject DN on first PIV login
      await pool.query(
        'UPDATE users SET x509_subject_dn = $1, piv_first_login_at = COALESCE(piv_first_login_at, NOW()), updated_at = NOW() WHERE id = $2',
        [x509Subject, user.id]
      );
    }

    // Session fixation prevention: delete any existing session
    const oldSessionId = req.cookies.session_id;
    if (oldSessionId) {
      await pool.query('DELETE FROM sessions WHERE id = $1', [oldSessionId]);
    }

    // Get user's workspaces
    const workspacesResult = await pool.query(
      `SELECT w.id, w.name, wm.role
       FROM workspaces w
       JOIN workspace_memberships wm ON w.id = wm.workspace_id
       WHERE wm.user_id = $1 AND w.archived_at IS NULL
       ORDER BY w.name`,
      [user.id]
    );

    const workspaces = workspacesResult.rows;
    let workspaceId = user.last_workspace_id;
    console.log(`[PIV DEBUG] Workspaces for user ${user.id}:`, { count: workspaces.length, workspaces, is_super_admin: user.is_super_admin });

    // Validate workspace access
    if (workspaceId && !workspaces.some((w: { id: string }) => w.id === workspaceId)) {
      workspaceId = null;
    }
    if (!workspaceId && workspaces.length > 0) {
      workspaceId = workspaces[0].id;
    }

    // Super-admins with no memberships: pick any workspace in the system
    if (!workspaceId && user.is_super_admin) {
      const anyWorkspace = await pool.query(
        'SELECT id FROM workspaces WHERE archived_at IS NULL LIMIT 1'
      );
      if (anyWorkspace.rows[0]) {
        workspaceId = anyWorkspace.rows[0].id;
        console.log(`[PIV DEBUG] Super-admin ${user.email} has no memberships, using workspace ${workspaceId}`);
      } else {
        // No workspaces exist at all - system not bootstrapped
        console.log(`PIV super-admin ${user.email} login failed: no workspaces exist`);
        await logAuditEvent({
          actorUserId: user.id,
          action: 'auth.piv_login_failed',
          details: { reason: 'no_workspaces_exist', email },
          req,
        });
        res.redirect('/login?error=' + encodeURIComponent('No workspaces exist. Create a workspace first.'));
        return;
      }
    }

    // Regular users must have workspace membership
    if (!workspaceId && !user.is_super_admin && workspaces.length === 0) {
      console.log(`PIV user ${email} has no workspace access`);
      await logAuditEvent({
        actorUserId: user.id,
        action: 'auth.piv_login_failed',
        details: { reason: 'no_workspace_access', email, x509Subject },
        req,
      });
      res.redirect('/login?error=' + encodeURIComponent('You are not authorized to access this application. Please contact an administrator to request access.'));
      return;
    }

    // Create new session
    const sessionId = generateSecureSessionId();
    const expiresAt = new Date(Date.now() + SESSION_TIMEOUT_MS);

    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at, last_activity, user_agent, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        sessionId,
        user.id,
        workspaceId,
        expiresAt,
        new Date(),
        req.headers['user-agent'] || 'unknown',
        req.ip || req.socket.remoteAddress || 'unknown',
      ]
    );

    // Update last workspace preference
    if (workspaceId) {
      await pool.query(
        'UPDATE users SET last_workspace_id = $1, updated_at = NOW() WHERE id = $2',
        [workspaceId, user.id]
      );
    }

    // Log audit event
    await logAuditEvent({
      workspaceId: workspaceId || undefined,
      actorUserId: user.id,
      action: 'auth.piv_login',
      details: { x509Subject },
      req,
    });

    // Set session cookie
    res.cookie('session_id', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: SESSION_TIMEOUT_MS,
      path: '/',
    });

    // Redirect to app (OAuth state was already consumed from database above)
    res.redirect('/');

  } catch (error) {
    console.error('PIV callback error:', error);

    // Extract specific error message for user feedback
    let errorMessage = 'Authentication failed';
    const fpkiError = error as { code?: string; details?: { originalError?: { error_description?: string } } };
    let errorCode = fpkiError.code || 'unknown';

    if (fpkiError.code === 'TOKEN_EXCHANGE_FAILED') {
      const desc = fpkiError.details?.originalError?.error_description;
      if (desc?.includes('No matching public key')) {
        errorMessage = 'Server configuration error - please contact administrator';
      } else if (desc) {
        errorMessage = desc;
      }
    }

    await logAuditEvent({
      action: 'auth.piv_login_failed',
      details: { reason: 'callback_error', errorCode, errorMessage },
      req,
    });

    res.redirect(`/login?error=${encodeURIComponent(errorMessage)}`);
  }
});

/**
 * Extract a human-readable name from X.509 subject DN
 * Handles formats like: CN=LASTNAME.FIRSTNAME.MIDDLE.1234567890
 */
function extractNameFromX509Subject(subject: string): string | null {
  if (!subject) return null;

  // Parse CN=LASTNAME.FIRSTNAME.MIDDLE.1234567890
  const cnMatch = subject.match(/CN=([^,]+)/i);
  if (cnMatch && cnMatch[1]) {
    const parts = cnMatch[1].split('.');
    const lastName = parts[0];
    const firstName = parts[1];
    if (lastName && firstName) {
      // LASTNAME.FIRSTNAME -> Firstname Lastname
      const formatName = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
      return `${formatName(firstName)} ${formatName(lastName)}`;
    }
  }

  return null;
}

/**
 * Find user by email OR X.509 subject DN (case-insensitive email match)
 *
 * DUPLICATE USER HANDLING:
 * PIV certificates may return email with different casing than what was originally
 * stored (e.g., "Sean.McBride@treasury.gov" vs "sean.mcbride@treasury.gov").
 * If duplicates exist, we prefer the user with workspace memberships to ensure
 * the user can actually access the application.
 *
 * ORDER BY priority:
 *   1. has_membership DESC - users with workspace access first
 *   2. is_super_admin DESC - super admins next
 *   3. created_at ASC - oldest user as tiebreaker
 *
 * FUTURE CONSIDERATION:
 * Treasury users may have multiple email addresses (role-based, contractor, etc.).
 * A user_emails table could support this use case, allowing PIV login to match
 * any of a user's registered emails. See migration 013 for schema sketch.
 */
async function findUserByEmailOrSubjectDn(email: string | undefined, subjectDn: string | undefined): Promise<{
  id: string;
  email: string;
  name: string;
  is_super_admin: boolean;
  last_workspace_id: string | null;
  x509_subject_dn: string | null;
} | null> {
  const result = await pool.query(
    `SELECT u.id, u.email, u.name, u.is_super_admin, u.last_workspace_id, u.x509_subject_dn,
            EXISTS(SELECT 1 FROM workspace_memberships wm WHERE wm.user_id = u.id) as has_membership
     FROM users u
     WHERE ($1::TEXT IS NOT NULL AND LOWER(u.email) = LOWER($1))
        OR ($2::TEXT IS NOT NULL AND u.x509_subject_dn = $2)
     ORDER BY has_membership DESC, u.is_super_admin DESC, u.created_at ASC
     LIMIT 1`,
    [email || null, subjectDn || null]
  );
  return result.rows[0] || null;
}

/**
 * Invite record from database
 */
interface PendingInvite {
  id: string;
  workspace_id: string;
  workspace_name: string;
  email: string | null;
  x509_subject_dn: string | null;
  role: 'admin' | 'member';
}

/**
 * Find a pending invite matching certificate identity (by email OR subject DN)
 */
async function findPendingInvite(email: string | undefined, subjectDn: string | undefined): Promise<PendingInvite | null> {
  const result = await pool.query(
    `SELECT wi.id, wi.workspace_id, w.name as workspace_name, wi.email, wi.x509_subject_dn, wi.role
     FROM workspace_invites wi
     JOIN workspaces w ON wi.workspace_id = w.id
     WHERE wi.used_at IS NULL
       AND wi.expires_at > NOW()
       AND (
         ($1::TEXT IS NOT NULL AND LOWER(wi.email) = LOWER($1))
         OR ($2::TEXT IS NOT NULL AND wi.x509_subject_dn = $2)
       )
     ORDER BY wi.created_at DESC
     LIMIT 1`,
    [email || null, subjectDn || null]
  );
  return result.rows[0] || null;
}

/**
 * Create a new user from an invite and set up workspace membership
 */
async function createUserFromInvite(
  invite: PendingInvite,
  email: string,
  name: string,
  x509Subject: string
): Promise<{
  id: string;
  email: string;
  name: string;
  is_super_admin: boolean;
  last_workspace_id: string | null;
  x509_subject_dn: string | null;
}> {
  // Create user (no password - PIV only)
  const userResult = await pool.query(
    `INSERT INTO users (email, name, x509_subject_dn, password_hash, last_workspace_id, piv_first_login_at)
     VALUES ($1, $2, $3, NULL, $4, NOW())
     RETURNING id, email, name, is_super_admin, last_workspace_id, x509_subject_dn`,
    [email, name, x509Subject, invite.workspace_id]
  );
  const user = userResult.rows[0];

  // Create workspace membership with invited role
  await pool.query(
    `INSERT INTO workspace_memberships (workspace_id, user_id, role)
     VALUES ($1, $2, $3)`,
    [invite.workspace_id, user.id, invite.role]
  );

  // Create Person document for this user in this workspace (links via properties.user_id)
  await pool.query(
    `INSERT INTO documents (workspace_id, document_type, title, properties)
     VALUES ($1, 'person', $2, $3)`,
    [invite.workspace_id, user.name, JSON.stringify({ user_id: user.id, email })]
  );

  // Mark invite as used
  await pool.query('UPDATE workspace_invites SET used_at = NOW() WHERE id = $1', [invite.id]);

  console.log(`Created PIV user from invite: ${email} (${x509Subject}) -> workspace ${invite.workspace_name}`);
  return user;
}

export default router;
