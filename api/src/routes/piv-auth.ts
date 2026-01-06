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
      String(code),
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

    // Find or create user by email
    let user = await findUserByEmail(email);

    if (!user) {
      // Auto-provision new PIV users (they'll need workspace access separately)
      user = await createPIVUser(email, name, x509Subject);
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

    // Validate workspace access
    if (workspaceId && !workspaces.some((w: { id: string }) => w.id === workspaceId)) {
      workspaceId = null;
    }
    if (!workspaceId && workspaces.length > 0) {
      workspaceId = workspaces[0].id;
    }

    // Super-admins can log in without workspace membership
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
 * Find user by email (case-insensitive)
 */
async function findUserByEmail(email: string): Promise<{
  id: string;
  email: string;
  name: string;
  is_super_admin: boolean;
  last_workspace_id: string | null;
} | null> {
  const result = await pool.query(
    'SELECT id, email, name, is_super_admin, last_workspace_id FROM users WHERE LOWER(email) = LOWER($1)',
    [email]
  );
  return result.rows[0] || null;
}

/**
 * Create a new PIV-only user (no password)
 */
async function createPIVUser(email: string, name: string, x509Subject: string): Promise<{
  id: string;
  email: string;
  name: string;
  is_super_admin: boolean;
  last_workspace_id: string | null;
}> {
  const result = await pool.query(
    `INSERT INTO users (email, name, password_hash)
     VALUES ($1, $2, NULL)
     RETURNING id, email, name, is_super_admin, last_workspace_id`,
    [email, name]
  );

  console.log(`Created PIV user: ${email} (${x509Subject})`);
  return result.rows[0];
}

export default router;
