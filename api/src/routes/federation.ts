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
router.post('/discover', authMiddleware, superAdminMiddleware, createFederationDiscoveryHandler({
  rejectUnauthorized: process.env.NODE_ENV === 'production',
  internalUrl: process.env.FPKI_INTERNAL_URL,
}));

// POST /federation/generate-keypair - Create RSA keypair for private_key_jwt
router.post('/generate-keypair', authMiddleware, superAdminMiddleware, async (_req: Request, res: Response): Promise<void> => {
  try {
    const { privateKeyPem, jwk } = await generateRsaKeypair();
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

  if (!clientId) {
    res.status(400).json({ error: 'Missing clientId' });
    return;
  }

  if (!issuerUrl) {
    res.status(400).json({ error: 'Missing issuerUrl' });
    return;
  }

  // Validate auth method specific fields
  if (authMethod === 'private_key_jwt') {
    if (!req.body.privateKeyPem) {
      res.status(400).json({ error: 'Missing privateKeyPem for private_key_jwt' });
      return;
    }
    if (!req.body.publicJwk) {
      res.status(400).json({ error: 'Missing publicJwk for private_key_jwt' });
      return;
    }
  } else if (authMethod === 'client_secret_post') {
    const secret = req.body.clientSecret || req.body.client_secret;
    if (!secret) {
      res.status(400).json({ error: 'Missing clientSecret for client_secret_post' });
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
