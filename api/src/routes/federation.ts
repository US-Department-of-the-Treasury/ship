/**
 * Federation Routes - RFC 7591 Dynamic Client Registration
 *
 * Provides admin endpoints for registering the application with an FPKI Validator
 * using PIV card authentication. These routes enable dynamic OAuth client setup.
 */

import { Router, Request, Response, NextFunction } from 'express';
import type { Router as RouterType } from 'express';
import {
  getFederationPageHtml,
  createFederationDiscoveryHandler,
  generateRsaKeypair,
} from '@fpki/auth-client';
import { saveCredentials, getPublicJwk, getCachedCredentials, type StoredCredentials } from '../services/credential-store.js';
import { resetFPKIClient } from '../services/fpki.js';
import { authMiddleware, superAdminMiddleware } from '../middleware/auth.js';
import { logAuditEvent } from '../services/audit.js';

const router: RouterType = Router();

// For HTML pages: intercept 401/403 JSON responses and redirect to login instead
// This lets us reuse authMiddleware/superAdminMiddleware while giving proper UX for HTML
function redirectOnAuthFailure(req: Request, res: Response, next: NextFunction): void {
  const redirectPath = '/login?redirect=/api/federation';

  // Intercept JSON responses - if auth failed (401/403), redirect instead
  const originalJson = res.json.bind(res);
  res.json = function(body: unknown): Response {
    if (res.statusCode === 401 || res.statusCode === 403) {
      res.redirect(redirectPath);
      return res; // Return res to satisfy type, but redirect already sent
    }
    return originalJson(body);
  };

  next();
}

// Get base URL from environment or derive from request
function getBaseUrl(req: Request): string {
  if (process.env.APP_BASE_URL) {
    return process.env.APP_BASE_URL;
  }
  const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  return `${protocol}://${req.headers.host}`;
}

// ============================================================================
// Input Validation for Federation Credentials (SEC-05)
// ============================================================================

const VALID_AUTH_METHODS = ['private_key_jwt', 'client_secret_post', 'client_secret_basic'] as const;

/**
 * Validate issuerUrl is a proper HTTPS URL
 */
function validateIssuerUrl(url: unknown): { valid: boolean; error?: string } {
  if (typeof url !== 'string') {
    return { valid: false, error: 'issuerUrl must be a string' };
  }
  try {
    const parsed = new URL(url);
    // In production, require HTTPS
    if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
      return { valid: false, error: 'issuerUrl must use HTTPS in production' };
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { valid: false, error: 'issuerUrl must be HTTP or HTTPS' };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: 'issuerUrl must be a valid URL' };
  }
}

/**
 * Validate clientId is safe (alphanumeric + limited special chars)
 */
function validateClientId(clientId: unknown): { valid: boolean; error?: string } {
  if (typeof clientId !== 'string') {
    return { valid: false, error: 'clientId must be a string' };
  }
  if (clientId.length < 1 || clientId.length > 256) {
    return { valid: false, error: 'clientId must be 1-256 characters' };
  }
  // Allow alphanumeric, hyphens, underscores, and periods (common OAuth client ID formats)
  if (!/^[a-zA-Z0-9._-]+$/.test(clientId)) {
    return { valid: false, error: 'clientId must be alphanumeric with dots, hyphens, or underscores' };
  }
  return { valid: true };
}

/**
 * Validate tokenEndpointAuthMethod is from allowed list
 */
function validateAuthMethod(method: unknown): { valid: boolean; error?: string } {
  if (typeof method !== 'string') {
    return { valid: false, error: 'tokenEndpointAuthMethod must be a string' };
  }
  if (!VALID_AUTH_METHODS.includes(method as typeof VALID_AUTH_METHODS[number])) {
    return { valid: false, error: `tokenEndpointAuthMethod must be one of: ${VALID_AUTH_METHODS.join(', ')}` };
  }
  return { valid: true };
}

/**
 * Validate privateKeyPem is a valid PEM-formatted RSA private key
 */
function validatePrivateKeyPem(pem: unknown): { valid: boolean; error?: string } {
  if (typeof pem !== 'string') {
    return { valid: false, error: 'privateKeyPem must be a string' };
  }
  // Check for PEM header/footer
  const pemRegex = /^-----BEGIN (RSA |EC |)PRIVATE KEY-----[\s\S]+-----END (RSA |EC |)PRIVATE KEY-----\s*$/;
  if (!pemRegex.test(pem)) {
    return { valid: false, error: 'privateKeyPem must be a valid PEM-formatted private key' };
  }
  // Basic size check (RSA 2048+ should be at least 1500 chars)
  if (pem.length < 500 || pem.length > 10000) {
    return { valid: false, error: 'privateKeyPem has invalid length' };
  }
  return { valid: true };
}

/**
 * Validate publicJwk is a valid JWK object
 */
function validatePublicJwk(jwk: unknown): { valid: boolean; error?: string } {
  if (typeof jwk !== 'object' || jwk === null) {
    return { valid: false, error: 'publicJwk must be an object' };
  }
  const j = jwk as Record<string, unknown>;
  // Must have kty (key type)
  if (typeof j.kty !== 'string' || !['RSA', 'EC'].includes(j.kty)) {
    return { valid: false, error: 'publicJwk must have kty of RSA or EC' };
  }
  // Must have kid (key id)
  if (typeof j.kid !== 'string' || j.kid.length === 0) {
    return { valid: false, error: 'publicJwk must have a kid' };
  }
  // RSA keys need n and e
  if (j.kty === 'RSA') {
    if (typeof j.n !== 'string' || typeof j.e !== 'string') {
      return { valid: false, error: 'RSA publicJwk must have n and e' };
    }
  }
  // EC keys need x, y, crv
  if (j.kty === 'EC') {
    if (typeof j.x !== 'string' || typeof j.y !== 'string' || typeof j.crv !== 'string') {
      return { valid: false, error: 'EC publicJwk must have x, y, and crv' };
    }
  }
  return { valid: true };
}

/**
 * Validate clientSecret is reasonable
 */
function validateClientSecret(secret: unknown): { valid: boolean; error?: string } {
  if (typeof secret !== 'string') {
    return { valid: false, error: 'clientSecret must be a string' };
  }
  if (secret.length < 16) {
    return { valid: false, error: 'clientSecret must be at least 16 characters' };
  }
  if (secret.length > 512) {
    return { valid: false, error: 'clientSecret must be at most 512 characters' };
  }
  return { valid: true };
}

// GET /federation - DCR registration page (HTML - redirects to login on any auth failure)
router.get('/', redirectOnAuthFailure, authMiddleware, superAdminMiddleware, (req: Request, res: Response): void => {
  const baseUrl = getBaseUrl(req);
  const error = req.query.error as string | undefined;
  const errorDescription = req.query.error_description as string | undefined;

  // Pre-fill from existing credentials if available
  const cached = getCachedCredentials();

  const html = getFederationPageHtml({
    issuerUrl: cached?.issuerUrl || '',
    clientName: 'Ship',
    redirectUri: cached?.redirectUri || `${baseUrl}/api/auth/piv/callback`,
    homeUrl: '/',
    saveEndpoint: '/api/federation/save-credentials',
    generateKeyEndpoint: '/api/federation/generate-keypair',
    discoverEndpoint: '/api/federation/discover',
    csrfTokenEndpoint: '/api/csrf-token',
    error,
    errorDescription,
  });

  // Override CSP to allow inline scripts for this admin-only page
  // The federation page template uses inline <script> tags for the registration flow
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline'; " +  // Allow inline scripts for this page
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob: https:; " +
    "connect-src 'self' https:; " +  // Allow fetch to external FPKI Validator
    "font-src 'self' data:; " +
    "object-src 'none'; " +
    "frame-src 'none'; " +
    "base-uri 'self'; " +
    "form-action 'self' https:;"  // Allow form submission to external mTLS endpoint
  );
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

// POST /federation/discover - Server-side OIDC discovery
// Returns registration_endpoint for browser to POST directly with mTLS
const discoveryHandler = createFederationDiscoveryHandler({
  rejectUnauthorized: process.env.NODE_ENV === 'production',
  internalUrl: process.env.FPKI_INTERNAL_URL,
});

router.post('/discover', authMiddleware, superAdminMiddleware, async (req: Request, res: Response): Promise<void> => {
  const issuerUrl = req.body.issuerUrl;

  // Wrap the response to capture success/failure for audit logging
  const originalJson = res.json.bind(res);
  res.json = function(body: unknown): Response {
    // Log after the SDK handler completes
    const success = res.statusCode >= 200 && res.statusCode < 300;
    logAuditEvent({
      actorUserId: req.userId!,
      action: 'federation.discover',
      details: {
        issuerUrl,
        success,
        registrationEndpoint: success ? (body as { registrationEndpoint?: string })?.registrationEndpoint : undefined,
      },
      req,
    }).catch(err => console.error('Failed to log audit event:', err));

    return originalJson(body);
  };

  await discoveryHandler(req, res);
});

// POST /federation/generate-keypair - Create RSA keypair for private_key_jwt
router.post('/generate-keypair', authMiddleware, superAdminMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const { privateKeyPem, jwk } = await generateRsaKeypair();

    await logAuditEvent({
      actorUserId: req.userId!,
      action: 'federation.generate_keypair',
      details: { algorithm: 'RS256', keyId: jwk.kid },
      req,
    });

    res.json({ privateKeyPem, jwk });
  } catch (err) {
    console.error('Failed to generate keypair:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /federation/save-credentials - Save credentials after RFC 7591 registration
router.post('/save-credentials', authMiddleware, superAdminMiddleware, async (req: Request, res: Response): Promise<void> => {
  const clientId = req.body.clientId || req.body.client_id;
  const authMethod = req.body.tokenEndpointAuthMethod || 'client_secret_post';
  const issuerUrl = req.body.issuerUrl;

  // Validate all inputs (SEC-05)
  const clientIdValidation = validateClientId(clientId);
  if (!clientIdValidation.valid) {
    res.status(400).json({ error: clientIdValidation.error });
    return;
  }

  const issuerValidation = validateIssuerUrl(issuerUrl);
  if (!issuerValidation.valid) {
    res.status(400).json({ error: issuerValidation.error });
    return;
  }

  const authMethodValidation = validateAuthMethod(authMethod);
  if (!authMethodValidation.valid) {
    res.status(400).json({ error: authMethodValidation.error });
    return;
  }

  // Validate auth method specific fields
  if (authMethod === 'private_key_jwt') {
    const pemValidation = validatePrivateKeyPem(req.body.privateKeyPem);
    if (!pemValidation.valid) {
      res.status(400).json({ error: pemValidation.error });
      return;
    }
    const jwkValidation = validatePublicJwk(req.body.publicJwk);
    if (!jwkValidation.valid) {
      res.status(400).json({ error: jwkValidation.error });
      return;
    }
  } else if (authMethod === 'client_secret_post' || authMethod === 'client_secret_basic') {
    const secret = req.body.clientSecret || req.body.client_secret;
    const secretValidation = validateClientSecret(secret);
    if (!secretValidation.valid) {
      res.status(400).json({ error: secretValidation.error });
      return;
    }
  }

  try {
    // Build credentials object for storage (includes issuerUrl and redirectUri)
    const baseUrl = getBaseUrl(req);
    const credentials: StoredCredentials = {
      clientId,
      tokenEndpointAuthMethod: authMethod,
      issuerUrl,
      redirectUri: `${baseUrl}/api/auth/piv/callback`,
    };

    if (authMethod === 'private_key_jwt') {
      credentials.privateKeyPem = req.body.privateKeyPem;
      credentials.privateKeyAlgorithm = req.body.privateKeyAlgorithm || 'RS256';
      credentials.publicJwk = req.body.publicJwk;
    } else {
      credentials.clientSecret = req.body.clientSecret || req.body.client_secret;
    }

    const success = await saveCredentials(credentials);
    if (!success) {
      res.status(500).json({ error: 'Failed to save credentials to Secrets Manager' });
      return;
    }

    // Reset the FPKI client to pick up new credentials
    resetFPKIClient();

    await logAuditEvent({
      actorUserId: req.userId!,
      action: 'federation.save_credentials',
      details: {
        clientId,
        issuerUrl,
        authMethod,
        // Note: privateKeyPem and clientSecret are intentionally NOT logged
      },
      req,
    });

    console.log('OAuth credentials saved:', clientId, 'issuer:', issuerUrl, '(method:', authMethod + ')');
    res.json({ success: true, message: 'Credentials saved' });
  } catch (err) {
    console.error('Failed to save credentials:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /.well-known/jwks.json - Public key endpoint for private_key_jwt
// Note: This is mounted at the app level, not under /api/federation
// Returns 503 (not 404) when unavailable to avoid CloudFront's SPA error handling
export function jwksHandler(_req: Request, res: Response): void {
  const publicJwk = getPublicJwk();

  console.log('JWKS endpoint hit:', {
    hasPublicJwk: !!publicJwk,
    kid: publicJwk?.kid || 'none',
    kty: publicJwk?.kty || 'none',
  });

  if (!publicJwk) {
    console.warn('JWKS unavailable: no credentials configured');
    res.status(503).json({ error: 'JWKS not available - no credentials configured' });
    return;
  }

  res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
  res.json({ keys: [publicJwk] });
}

export default router;
