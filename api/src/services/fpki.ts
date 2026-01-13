/**
 * FPKI Validator OAuth Client Service
 *
 * Provides PIV smartcard authentication via the FPKI Validator OAuth server.
 * Configuration is optional - if not configured, PIV auth is simply unavailable.
 *
 * Credentials can come from:
 * 1. AWS Secrets Manager (preferred, via credential store)
 * 2. Environment variables (fallback)
 */

import { FPKIAuthClient, type JsonWebKey } from '@fpki/auth-client';
import { getCachedCredentials, loadCredentials } from './credential-store.js';

let fpkiClient: FPKIAuthClient | null = null;
let initializationAttempted = false;

/**
 * Check if FPKI integration is configured
 * Returns true if we have complete credentials from Secrets Manager OR env vars
 */
export function isFPKIConfigured(): boolean {
  const cached = getCachedCredentials('fpki');

  // Check Secrets Manager credentials (preferred - includes issuerUrl and redirectUri)
  if (cached?.clientId && cached?.issuerUrl && cached?.redirectUri) {
    return true;
  }

  // Fall back to env vars (legacy)
  return !!(
    process.env.FPKI_ISSUER_URL &&
    process.env.FPKI_CLIENT_ID &&
    process.env.FPKI_REDIRECT_URI
  );
}

/**
 * Initialize FPKI client by loading credentials from Secrets Manager
 * Call this at startup to ensure credentials are loaded
 */
export async function initializeFPKI(): Promise<void> {
  if (initializationAttempted) return;
  initializationAttempted = true;

  try {
    await loadCredentials('fpki');
    console.log('FPKI credentials loaded from Secrets Manager');
  } catch (err) {
    console.log('No FPKI credentials in Secrets Manager, using env vars');
  }
}

/**
 * Get the FPKI Auth Client singleton
 * @throws Error if FPKI is not configured
 */
export function getFPKIClient(): FPKIAuthClient {
  if (!fpkiClient) {
    // Try credentials from Secrets Manager first (includes issuerUrl and redirectUri)
    const cached = getCachedCredentials('fpki');

    let issuerUrl: string;
    let redirectUri: string;
    let clientId: string;
    let tokenEndpointAuthMethod: 'private_key_jwt' | 'client_secret_post';
    let privateKeyPem: string | undefined;
    let clientSecret: string | undefined;
    let publicJwk: JsonWebKey | undefined;

    if (cached?.clientId && cached?.issuerUrl && cached?.redirectUri) {
      // Use Secrets Manager credentials (preferred)
      issuerUrl = cached.issuerUrl;
      redirectUri = cached.redirectUri;
      clientId = cached.clientId;
      tokenEndpointAuthMethod = cached.tokenEndpointAuthMethod || 'client_secret_post';
      privateKeyPem = cached.privateKeyPem;
      clientSecret = cached.clientSecret;
      publicJwk = cached.publicJwk;
      console.log('Using FPKI credentials from Secrets Manager');
    } else {
      // Fall back to env vars (legacy)
      issuerUrl = process.env.FPKI_ISSUER_URL || '';
      redirectUri = process.env.FPKI_REDIRECT_URI || '';
      clientId = process.env.FPKI_CLIENT_ID || '';
      privateKeyPem = process.env.FPKI_PRIVATE_KEY_PEM;
      clientSecret = process.env.FPKI_CLIENT_SECRET;
      tokenEndpointAuthMethod = privateKeyPem ? 'private_key_jwt' : 'client_secret_post';
      console.log('Using FPKI credentials from environment variables');
    }

    if (!issuerUrl || !redirectUri) {
      throw new Error('FPKI issuerUrl and redirectUri not configured');
    }

    if (!clientId) {
      throw new Error('FPKI clientId not configured');
    }

    console.log('Creating FPKIAuthClient:', {
      issuerUrl,
      clientId,
      tokenEndpointAuthMethod,
      hasPrivateKey: !!privateKeyPem,
      hasClientSecret: !!clientSecret,
      hasPublicJwk: !!publicJwk,
      publicJwkKid: publicJwk?.kid || 'none',
    });

    fpkiClient = new FPKIAuthClient({
      issuerUrl,
      clientId,
      redirectUri,
      tokenEndpointAuthMethod,
      privateKeyPem,
      clientSecret,
      publicJwk,
      trustSelfSigned: process.env.NODE_ENV !== 'production',
    });
  }

  return fpkiClient;
}

/**
 * Reset the client singleton (for credential updates or testing)
 */
export function resetFPKIClient(): void {
  fpkiClient = null;
}
