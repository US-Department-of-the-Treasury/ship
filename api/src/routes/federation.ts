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
  validateIssuerUrl,
  validateClientId,
  validateAuthMethod,
  validatePrivateKeyPem,
  validatePublicJwk,
  validateClientSecret,
} from '@fpki/auth-client';
import { saveCredentials, getCachedCredentials, type StoredCredentials, type OAuthProvider } from '../services/credential-store.js';
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

// Provider-specific callback paths
const PROVIDER_CALLBACKS: Record<OAuthProvider, string> = {
  fpki: '/api/auth/piv/callback',
  caia: '/api/auth/caia/callback',
};

// Provider display names and descriptions
const PROVIDER_INFO: Record<OAuthProvider, { name: string; description: string; supportsDcr: boolean }> = {
  fpki: {
    name: 'FPKI Validator',
    description: 'Supports Dynamic Client Registration (DCR) via PIV card',
    supportsDcr: true,
  },
  caia: {
    name: 'Treasury CAIA',
    description: 'Manual credential entry only (no DCR support)',
    supportsDcr: false,
  },
};

/**
 * Generate provider selector tabs HTML
 * Shows tabs for each provider with visual indication of current selection
 */
function getProviderSelectorHtml(currentProvider: OAuthProvider): string {
  const tabs = (Object.keys(PROVIDER_INFO) as OAuthProvider[])
    .map(p => {
      const info = PROVIDER_INFO[p];
      const isActive = p === currentProvider;
      const activeStyle = isActive
        ? 'background: #1a73e8; color: white; border-color: #1a73e8;'
        : 'background: #f8f9fa; color: #5f6368; border-color: #dadce0;';
      return `
        <a href="/api/federation?provider=${p}" style="
          display: inline-block;
          padding: 12px 24px;
          margin-right: 8px;
          border: 2px solid;
          border-radius: 8px 8px 0 0;
          text-decoration: none;
          font-weight: 500;
          ${activeStyle}
        ">
          ${info.name}
          ${!info.supportsDcr ? '<span style="font-size: 11px; opacity: 0.8;">(Manual)</span>' : ''}
        </a>
      `;
    })
    .join('');

  const currentInfo = PROVIDER_INFO[currentProvider];

  return `
    <div style="font-family: 'Google Sans', Roboto, Arial, sans-serif; max-width: 800px; margin: 0 auto 0; padding: 20px 20px 0;">
      <div style="margin-bottom: 16px;">
        <h2 style="margin: 0 0 8px; color: #202124;">Identity Provider Registration</h2>
        <p style="margin: 0; color: #5f6368; font-size: 14px;">
          Select the identity provider you want to configure. ${currentInfo.supportsDcr
            ? 'Use PIV card to register via Dynamic Client Registration.'
            : 'Enter credentials manually (obtained from the CAIA team).'}
        </p>
      </div>
      <div style="border-bottom: 2px solid #dadce0;">
        ${tabs}
      </div>
    </div>
  `;
}

// GET /federation - DCR registration page (HTML - redirects to login on any auth failure)
// Accepts ?provider=fpki|caia query param to select which provider to configure
router.get('/', redirectOnAuthFailure, authMiddleware, superAdminMiddleware, (req: Request, res: Response): void => {
  const baseUrl = getBaseUrl(req);
  const error = req.query.error as string | undefined;
  const errorDescription = req.query.error_description as string | undefined;
  const provider = (req.query.provider as OAuthProvider) || 'fpki';

  console.log(`[Federation] Page loaded for provider: ${provider}, baseUrl: ${baseUrl}`);

  // Pre-fill from existing credentials for selected provider
  const cached = getCachedCredentials(provider);

  // Get SDK-generated registration form HTML
  const sdkHtml = getFederationPageHtml({
    issuerUrl: cached?.issuerUrl || '',
    clientName: 'Ship',
    redirectUri: cached?.redirectUri || `${baseUrl}${PROVIDER_CALLBACKS[provider]}`,
    homeUrl: '/',
    saveEndpoint: `/api/federation/save-credentials?provider=${provider}`,
    generateKeyEndpoint: '/api/federation/generate-keypair',
    discoverEndpoint: '/api/federation/discover',
    csrfTokenEndpoint: '/api/csrf-token',
    error,
    errorDescription,
  });

  // Inject provider selector tabs at the top of the page body
  const providerSelector = getProviderSelectorHtml(provider);
  const html = sdkHtml.replace(/<body[^>]*>/, (match) => `${match}${providerSelector}`);

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

  console.log(`[Federation] Discovering OIDC endpoints for issuer: ${issuerUrl}`);

  // Wrap the response to capture success/failure for audit logging
  const originalJson = res.json.bind(res);
  res.json = function(body: unknown): Response {
    // Log after the SDK handler completes
    const success = res.statusCode >= 200 && res.statusCode < 300;
    const registrationEndpoint = success ? (body as { registrationEndpoint?: string })?.registrationEndpoint : undefined;

    if (success) {
      console.log(`[Federation] Discovery successful for ${issuerUrl}, registration_endpoint: ${registrationEndpoint}`);
    } else {
      console.log(`[Federation] Discovery failed for ${issuerUrl}:`, body);
    }

    logAuditEvent({
      actorUserId: req.userId!,
      action: 'federation.discover',
      details: {
        issuerUrl,
        success,
        registrationEndpoint,
      },
      req,
    }).catch(err => console.error('Failed to log audit event:', err));

    return originalJson(body);
  };

  await discoveryHandler(req, res);
});

// POST /federation/generate-keypair - Create RSA keypair for private_key_jwt
router.post('/generate-keypair', authMiddleware, superAdminMiddleware, async (req: Request, res: Response): Promise<void> => {
  console.log('[Federation] Generating RSA keypair for private_key_jwt auth');

  try {
    const { privateKeyPem, jwk } = await generateRsaKeypair();

    console.log(`[Federation] Keypair generated successfully, keyId: ${jwk.kid}`);

    await logAuditEvent({
      actorUserId: req.userId!,
      action: 'federation.generate_keypair',
      details: { algorithm: 'RS256', keyId: jwk.kid },
      req,
    });

    res.json({ privateKeyPem, jwk });
  } catch (err) {
    console.error('[Federation] Failed to generate keypair:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /federation/save-credentials - Save credentials after RFC 7591 registration
// Accepts ?provider=fpki|caia query param
router.post('/save-credentials', authMiddleware, superAdminMiddleware, async (req: Request, res: Response): Promise<void> => {
  const clientId = req.body.clientId || req.body.client_id;
  const authMethod = req.body.tokenEndpointAuthMethod || 'client_secret_post';
  const issuerUrl = req.body.issuerUrl;
  const provider = (req.query.provider as OAuthProvider) || 'fpki';
  const baseUrl = getBaseUrl(req);
  const redirectUri = `${baseUrl}${PROVIDER_CALLBACKS[provider]}`;

  console.log(`[Federation] Saving credentials for provider: ${provider}`);
  console.log(`[Federation]   clientId: ${clientId}`);
  console.log(`[Federation]   issuerUrl: ${issuerUrl}`);
  console.log(`[Federation]   redirectUri: ${redirectUri}`);
  console.log(`[Federation]   authMethod: ${authMethod}`);

  // Validate all inputs (SEC-05)
  const clientIdValidation = validateClientId(clientId);
  if (!clientIdValidation.valid) {
    res.status(400).json({ error: clientIdValidation.error });
    return;
  }

  // Require HTTPS in production
  const issuerValidation = validateIssuerUrl(issuerUrl, process.env.NODE_ENV === 'production');
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
    const credentials: StoredCredentials = {
      clientId,
      tokenEndpointAuthMethod: authMethod,
      issuerUrl,
      redirectUri,
    };

    if (authMethod === 'private_key_jwt') {
      credentials.privateKeyPem = req.body.privateKeyPem;
      credentials.privateKeyAlgorithm = req.body.privateKeyAlgorithm || 'RS256';
      credentials.publicJwk = req.body.publicJwk;
    } else {
      credentials.clientSecret = req.body.clientSecret || req.body.client_secret;
    }

    const success = await saveCredentials(credentials, provider);
    if (!success) {
      res.status(500).json({ error: 'Failed to save credentials to Secrets Manager' });
      return;
    }

    // Reset the appropriate client to pick up new credentials
    if (provider === 'fpki') {
      resetFPKIClient();
    } else if (provider === 'caia') {
      // Import dynamically to avoid circular dependency
      const { resetCAIAClient } = await import('../services/caia.js');
      resetCAIAClient();
    }

    await logAuditEvent({
      actorUserId: req.userId!,
      action: 'federation.save_credentials',
      details: {
        provider,
        clientId,
        issuerUrl,
        authMethod,
        // Note: privateKeyPem and clientSecret are intentionally NOT logged
      },
      req,
    });

    console.log(`[Federation] ${provider.toUpperCase()} credentials saved successfully`);
    console.log(`[Federation]   clientId: ${clientId}`);
    console.log(`[Federation]   issuerUrl: ${issuerUrl}`);
    console.log(`[Federation]   redirectUri: ${redirectUri}`);
    console.log(`[Federation]   authMethod: ${authMethod}`);
    res.json({ success: true, message: 'Credentials saved' });
  } catch (err) {
    console.error(`[Federation] Failed to save ${provider.toUpperCase()} credentials:`, err);
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
