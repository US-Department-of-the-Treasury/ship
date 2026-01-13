/**
 * CAIA OAuth Client Service
 *
 * Provides PIV smartcard authentication via Treasury's CAIA (Customer Authentication
 * & Identity Architecture) OAuth server. Uses openid-client directly for OIDC flows.
 *
 * Key differences from FPKI Validator:
 * - CAIA's `sub` claim is NOT persistent (changes on re-provisioning)
 * - Email is the primary identifier for user matching
 * - No x509_subject_dn claim (CAIA acts as broker, doesn't expose certificate details)
 * - Uses client_secret_post authentication (no private_key_jwt needed)
 */

import { Issuer, generators, type Client, type TokenSet } from 'openid-client';
import { getCachedCredentials, loadCredentials } from './credential-store.js';

// CAIA client singleton
let caiaIssuer: Issuer | null = null;
let caiaClient: Client | null = null;
let initializationAttempted = false;

/**
 * User information extracted from CAIA ID token
 */
export interface CAIAUserInfo {
  /** Subject identifier (NOT persistent - do not use for permanent storage) */
  sub: string;
  /** Email address (primary identifier) */
  email: string;
  /** Given name (first name) - only available for IAL2+ */
  givenName?: string;
  /** Family name (last name) - only available for IAL2+ */
  familyName?: string;
  /** Credential Service Provider used: 'X509Cert', 'Login.gov', 'ID.me' */
  csp?: string;
  /** Identity Assurance Level */
  ial?: string;
  /** Authentication Assurance Level */
  aal?: string;
  /** Raw ID token claims */
  rawClaims: Record<string, unknown>;
}

/**
 * Authorization URL result (matches FPKI pattern)
 */
export interface CAIAAuthorizationUrlResult {
  /** Full authorization URL to redirect user to */
  url: string;
  /** State parameter for CSRF protection */
  state: string;
  /** Nonce for replay protection */
  nonce: string;
  /** PKCE code verifier (store in session) */
  codeVerifier: string;
}

/**
 * Callback result with user info
 */
export interface CAIACallbackResult {
  /** Authenticated user information */
  user: CAIAUserInfo;
  /** Raw token set (for debugging, not stored) */
  tokens: TokenSet;
}

/**
 * Check if CAIA integration is configured
 */
export function isCAIAConfigured(): boolean {
  const cached = getCachedCredentials('caia');

  // Check Secrets Manager credentials
  if (cached?.clientId && cached?.issuerUrl && cached?.redirectUri) {
    return true;
  }

  // Fall back to env vars
  return !!(
    process.env.CAIA_ISSUER_URL &&
    process.env.CAIA_CLIENT_ID &&
    process.env.CAIA_REDIRECT_URI
  );
}

/**
 * Initialize CAIA client by loading credentials from Secrets Manager
 * Call this at startup to ensure credentials are loaded
 */
export async function initializeCAIA(): Promise<void> {
  if (initializationAttempted) return;
  initializationAttempted = true;

  try {
    await loadCredentials('caia');
    console.log('CAIA credentials loaded from Secrets Manager');
  } catch (err) {
    console.log('No CAIA credentials in Secrets Manager, using env vars');
  }
}

/**
 * Discover the CAIA issuer (lazy, cached)
 */
async function getIssuer(): Promise<Issuer> {
  if (caiaIssuer) {
    return caiaIssuer;
  }

  const cached = getCachedCredentials('caia');
  const issuerUrl = cached?.issuerUrl || process.env.CAIA_ISSUER_URL;

  if (!issuerUrl) {
    throw new Error('CAIA issuerUrl not configured');
  }

  console.log('Discovering CAIA issuer:', issuerUrl);
  caiaIssuer = await Issuer.discover(issuerUrl);
  console.log('CAIA issuer discovered:', caiaIssuer.issuer);

  return caiaIssuer;
}

/**
 * Get the CAIA OpenID Client (lazy, cached)
 */
async function getClient(): Promise<Client> {
  if (caiaClient) {
    return caiaClient;
  }

  const issuer = await getIssuer();
  const cached = getCachedCredentials('caia');

  const clientId = cached?.clientId || process.env.CAIA_CLIENT_ID;
  const clientSecret = cached?.clientSecret || process.env.CAIA_CLIENT_SECRET;
  const redirectUri = cached?.redirectUri || process.env.CAIA_REDIRECT_URI;

  if (!clientId) {
    throw new Error('CAIA clientId not configured');
  }

  if (!redirectUri) {
    throw new Error('CAIA redirectUri not configured');
  }

  console.log('Creating CAIA client:', { clientId, hasSecret: !!clientSecret });

  caiaClient = new issuer.Client({
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uris: [redirectUri],
    response_types: ['code'],
    token_endpoint_auth_method: clientSecret ? 'client_secret_post' : 'none',
  });

  return caiaClient;
}

/**
 * Get authorization URL for CAIA login
 * Uses PKCE for security (required for public clients, recommended for all)
 */
export async function getAuthorizationUrl(): Promise<CAIAAuthorizationUrlResult> {
  const client = await getClient();
  const cached = getCachedCredentials('caia');
  const redirectUri = cached?.redirectUri || process.env.CAIA_REDIRECT_URI;

  if (!redirectUri) {
    throw new Error('CAIA redirectUri not configured');
  }

  // Generate PKCE and OAuth state
  const codeVerifier = generators.codeVerifier();
  const codeChallenge = generators.codeChallenge(codeVerifier);
  const state = generators.state();
  const nonce = generators.nonce();

  const url = client.authorizationUrl({
    scope: 'openid email profile',
    redirect_uri: redirectUri,
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return { url, state, nonce, codeVerifier };
}

/**
 * Handle OAuth callback from CAIA
 * Exchanges authorization code for tokens and extracts user info
 */
export async function handleCallback(
  code: string,
  params: { state: string; nonce: string; codeVerifier: string }
): Promise<CAIACallbackResult> {
  const client = await getClient();
  const cached = getCachedCredentials('caia');
  const redirectUri = cached?.redirectUri || process.env.CAIA_REDIRECT_URI;

  if (!redirectUri) {
    throw new Error('CAIA redirectUri not configured');
  }

  // Exchange code for tokens with PKCE verification
  const tokenSet = await client.callback(
    redirectUri,
    { code, state: params.state },
    {
      state: params.state,
      nonce: params.nonce,
      code_verifier: params.codeVerifier,
    }
  );

  // Extract claims from ID token with runtime type validation (SEC-02)
  const claims = tokenSet.claims();

  // Type-safe claim extraction with validation
  const sub = claims.sub;
  const email = typeof claims.email === 'string' ? claims.email : undefined;
  const givenName = typeof claims.given_name === 'string' ? claims.given_name : undefined;
  const familyName = typeof claims.family_name === 'string' ? claims.family_name : undefined;
  const csp = typeof claims.csp === 'string' ? claims.csp : undefined;
  const ial = typeof claims.ial === 'string' ? String(claims.ial) : undefined;
  const aal = typeof claims.aal === 'string' ? String(claims.aal) : undefined;

  const user: CAIAUserInfo = {
    sub,
    email: email || '', // Will be validated in callback route
    givenName,
    familyName,
    csp,
    ial,
    aal,
    rawClaims: claims as Record<string, unknown>,
  };

  return { user, tokens: tokenSet };
}

/**
 * Reset the CAIA client singleton (for credential updates or testing)
 */
export function resetCAIAClient(): void {
  caiaIssuer = null;
  caiaClient = null;
  initializationAttempted = false;
}
