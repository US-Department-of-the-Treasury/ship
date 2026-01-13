/**
 * Admin Credentials Routes
 *
 * Provides admin endpoints for configuring CAIA OAuth credentials.
 * Credentials are stored in AWS Secrets Manager.
 */

import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import { authMiddleware, superAdminMiddleware } from '../middleware/auth.js';
import { logAuditEvent } from '../services/audit.js';
import {
  isCAIAConfigured,
  validateIssuerDiscovery,
  resetCAIAClient,
} from '../services/caia.js';
import {
  getCAIACredentials,
  saveCAIACredentials,
  getCAIASecretPath,
  getChangedFields,
  type CAIACredentials,
} from '../services/secrets-manager.js';

const router: RouterType = Router();

// Get base URL from environment
function getBaseUrl(): string {
  return process.env.APP_BASE_URL || '';
}

// Get auto-derived redirect URI
function getRedirectUri(): string {
  const baseUrl = getBaseUrl();
  return baseUrl ? `${baseUrl}/api/auth/caia/callback` : '';
}

/**
 * Render the admin credentials page HTML
 */
function renderPage(options: {
  currentConfig: {
    issuerUrl: string;
    clientId: string;
    hasClientSecret: boolean;
  };
  isConfigured: boolean;
  redirectUri: string;
  secretPath: string;
  error?: string;
  success?: string;
}): string {
  const { currentConfig, isConfigured, redirectUri, secretPath, error, success } = options;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CAIA Credentials - Ship Admin</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
      background: #0a0a0b;
      color: #e4e4e7;
      margin: 0;
      padding: 20px;
      min-height: 100vh;
    }
    .container { max-width: 600px; margin: 0 auto; }
    h1 { color: #fff; margin-bottom: 8px; }
    .subtitle { color: #71717a; margin-bottom: 24px; }
    .card {
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 8px;
      padding: 24px;
      margin-bottom: 16px;
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 4px 12px;
      border-radius: 9999px;
      font-size: 14px;
      margin-bottom: 16px;
    }
    .status.configured { background: #052e16; color: #4ade80; }
    .status.not-configured { background: #450a0a; color: #f87171; }
    .field { margin-bottom: 16px; }
    label {
      display: block;
      font-size: 14px;
      font-weight: 500;
      margin-bottom: 6px;
      color: #a1a1aa;
    }
    input, textarea {
      width: 100%;
      padding: 10px 12px;
      background: #27272a;
      border: 1px solid #3f3f46;
      border-radius: 6px;
      color: #e4e4e7;
      font-size: 14px;
    }
    input:focus, textarea:focus {
      outline: none;
      border-color: #3b82f6;
    }
    input:read-only {
      background: #1f1f23;
      color: #71717a;
    }
    .hint {
      font-size: 12px;
      color: #71717a;
      margin-top: 4px;
    }
    button {
      background: #3b82f6;
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      width: 100%;
    }
    button:hover { background: #2563eb; }
    button:disabled { background: #3f3f46; cursor: not-allowed; }
    .btn-secondary {
      background: #27272a;
      border: 1px solid #3f3f46;
    }
    .btn-secondary:hover { background: #3f3f46; }
    .alert {
      padding: 12px 16px;
      border-radius: 6px;
      margin-bottom: 16px;
      font-size: 14px;
    }
    .alert.error { background: #450a0a; border: 1px solid #7f1d1d; color: #fca5a5; }
    .alert.success { background: #052e16; border: 1px solid #166534; color: #86efac; }
    .back-link {
      display: inline-block;
      color: #3b82f6;
      text-decoration: none;
      margin-bottom: 16px;
    }
    .back-link:hover { text-decoration: underline; }
    .info-box {
      background: #1e3a5f;
      border: 1px solid #2563eb;
      border-radius: 6px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .info-box h3 { margin: 0 0 8px; color: #93c5fd; font-size: 14px; }
    .info-box p { margin: 0; font-size: 13px; color: #bfdbfe; }
    .info-box code {
      background: #1e40af;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: monospace;
    }
    .button-group {
      display: flex;
      gap: 12px;
      margin-top: 16px;
    }
    .button-group button {
      flex: 1;
    }
  </style>
</head>
<body>
  <div class="container">
    <a href="/" class="back-link">← Back to Ship</a>

    <h1>CAIA Credentials</h1>
    <p class="subtitle">Configure Treasury CAIA OAuth integration for PIV authentication</p>

    ${error ? `<div class="alert error">${escapeHtml(error)}</div>` : ''}
    ${success ? `<div class="alert success">${escapeHtml(success)}</div>` : ''}

    <div class="card">
      <div class="status ${isConfigured ? 'configured' : 'not-configured'}">
        <span>${isConfigured ? '✓ Configured' : '○ Not Configured'}</span>
      </div>

      <div class="info-box">
        <h3>Secrets Manager Storage</h3>
        <p>
          Credentials are stored in AWS Secrets Manager at:<br>
          <code>${escapeHtml(secretPath)}</code>
        </p>
      </div>

      <form action="/api/admin/credentials" method="POST">
        <div class="field">
          <label for="issuer_url">Issuer URL *</label>
          <input
            type="url"
            id="issuer_url"
            name="issuer_url"
            value="${escapeHtml(currentConfig.issuerUrl)}"
            placeholder="https://caia.treasury.gov"
            required
          />
          <p class="hint">The CAIA OAuth issuer URL (OIDC discovery endpoint base)</p>
        </div>

        <div class="field">
          <label for="client_id">Client ID *</label>
          <input
            type="text"
            id="client_id"
            name="client_id"
            value="${escapeHtml(currentConfig.clientId)}"
            placeholder="your-client-id"
            required
          />
          <p class="hint">OAuth client identifier registered with CAIA</p>
        </div>

        <div class="field">
          <label for="client_secret">Client Secret *</label>
          <input
            type="password"
            id="client_secret"
            name="client_secret"
            placeholder="${currentConfig.hasClientSecret ? '••••••••••••••••' : 'Enter client secret'}"
            ${currentConfig.hasClientSecret ? '' : 'required'}
          />
          <p class="hint">
            OAuth client secret.
            ${currentConfig.hasClientSecret ? 'Leave blank to keep existing secret.' : ''}
          </p>
        </div>

        <div class="field">
          <label>Redirect URI (auto-derived)</label>
          <input type="text" value="${escapeHtml(redirectUri)}" readonly />
          <p class="hint">Register this URI with CAIA. Derived from APP_BASE_URL.</p>
        </div>

        <div class="button-group">
          <button type="submit">Save Credentials</button>
        </div>
      </form>
    </div>

    <div class="card">
      <h3 style="margin-top: 0; color: #e4e4e7;">Test Configuration</h3>
      <p style="color: #71717a; font-size: 14px; margin-bottom: 16px;">
        Test that the issuer URL is reachable and returns valid OIDC metadata.
        Note: Client ID/Secret cannot be fully validated until a real login attempt.
      </p>
      <form action="/api/admin/credentials/test" method="POST">
        <button type="submit" class="btn-secondary" ${!isConfigured ? 'disabled' : ''}>
          Test CAIA Connection
        </button>
      </form>
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * GET /api/admin/credentials - Show credential configuration form
 */
router.get('/', authMiddleware, superAdminMiddleware, async (req: Request, res: Response): Promise<void> => {
  const error = req.query.error as string | undefined;
  const success = req.query.success as string | undefined;

  // Fetch current config from Secrets Manager
  const result = await getCAIACredentials();
  const currentConfig = {
    issuerUrl: result.credentials?.issuer_url || '',
    clientId: result.credentials?.client_id || '',
    hasClientSecret: !!result.credentials?.client_secret,
  };

  const html = renderPage({
    currentConfig,
    isConfigured: result.configured,
    redirectUri: getRedirectUri(),
    secretPath: getCAIASecretPath(),
    error,
    success,
  });

  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

/**
 * POST /api/admin/credentials - Save credentials to Secrets Manager
 */
router.post('/', authMiddleware, superAdminMiddleware, async (req: Request, res: Response): Promise<void> => {
  const { issuer_url, client_id, client_secret } = req.body;

  // Validate required fields
  if (!issuer_url || !client_id) {
    res.redirect('/api/admin/credentials?error=' + encodeURIComponent('Issuer URL and Client ID are required'));
    return;
  }

  // Get existing credentials to check what changed
  const existingResult = await getCAIACredentials();
  const existingCreds = existingResult.credentials;

  // Build new credentials (keep existing secret if not provided)
  const newSecret = client_secret || existingCreds?.client_secret;
  if (!newSecret) {
    res.redirect('/api/admin/credentials?error=' + encodeURIComponent('Client Secret is required'));
    return;
  }

  const newCredentials: CAIACredentials = {
    issuer_url: issuer_url.trim(),
    client_id: client_id.trim(),
    client_secret: newSecret,
  };

  // Validate issuer discovery before saving
  try {
    await validateIssuerDiscovery(
      newCredentials.issuer_url,
      newCredentials.client_id,
      newCredentials.client_secret
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    res.redirect('/api/admin/credentials?error=' + encodeURIComponent(`Issuer discovery failed: ${errorMessage}`));
    return;
  }

  // Determine which fields changed for audit logging
  const changedFields = getChangedFields(existingCreds, newCredentials);

  // Save to Secrets Manager
  try {
    await saveCAIACredentials(newCredentials);

    // Reset CAIA client to pick up new credentials
    resetCAIAClient();

    // Audit log the change
    await logAuditEvent({
      actorUserId: req.userId!,
      action: 'admin.update_caia_credentials',
      details: {
        changedFields,
        secretPath: getCAIASecretPath(),
      },
      req,
    });

    res.redirect('/api/admin/credentials?success=' + encodeURIComponent('Credentials saved successfully. Issuer discovery validated.'));
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';

    await logAuditEvent({
      actorUserId: req.userId!,
      action: 'admin.update_caia_credentials_failed',
      details: {
        error: errorMessage,
        secretPath: getCAIASecretPath(),
      },
      req,
    });

    res.redirect('/api/admin/credentials?error=' + encodeURIComponent(`Failed to save credentials: ${errorMessage}`));
  }
});

/**
 * POST /api/admin/credentials/test - Test CAIA connection
 */
router.post('/test', authMiddleware, superAdminMiddleware, async (req: Request, res: Response): Promise<void> => {
  const configured = await isCAIAConfigured();
  if (!configured) {
    res.redirect('/api/admin/credentials?error=' + encodeURIComponent('CAIA is not configured. Save credentials first.'));
    return;
  }

  try {
    // Fetch credentials and test discovery
    const result = await getCAIACredentials();
    if (!result.credentials) {
      throw new Error('Credentials not found');
    }

    const { issuer } = await validateIssuerDiscovery(
      result.credentials.issuer_url,
      result.credentials.client_id,
      result.credentials.client_secret
    );

    await logAuditEvent({
      actorUserId: req.userId!,
      action: 'admin.test_caia_connection',
      details: { success: true, issuer },
      req,
    });

    res.redirect('/api/admin/credentials?success=' + encodeURIComponent(`CAIA connection successful! Issuer: ${issuer}`));
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';

    await logAuditEvent({
      actorUserId: req.userId!,
      action: 'admin.test_caia_connection',
      details: { success: false, error: errorMessage },
      req,
    });

    res.redirect('/api/admin/credentials?error=' + encodeURIComponent(`CAIA connection failed: ${errorMessage}`));
  }
});

/**
 * GET /api/admin/credentials/status - API endpoint for credential status
 */
router.get('/status', authMiddleware, superAdminMiddleware, async (_req: Request, res: Response): Promise<void> => {
  const result = await getCAIACredentials();

  res.json({
    success: true,
    data: {
      configured: result.configured,
      issuerUrl: result.credentials?.issuer_url || null,
      clientId: result.credentials?.client_id || null,
      hasClientSecret: !!result.credentials?.client_secret,
      redirectUri: getRedirectUri(),
      secretPath: getCAIASecretPath(),
      error: result.error,
    },
  });
});

export default router;
