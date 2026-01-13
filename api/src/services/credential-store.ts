/**
 * OAuth Credential Store Service
 *
 * Manages OAuth client credentials using AWS Secrets Manager via the SDK.
 * Supports multiple OAuth providers (FPKI Validator, CAIA) with separate secrets.
 */

import {
  SecretsManagerCredentialStore,
  type StoredCredentials,
  type JsonWebKey,
} from '@fpki/auth-client';

// Re-export StoredCredentials for convenience
export type { StoredCredentials };

/**
 * Supported OAuth providers
 */
export type OAuthProvider = 'fpki' | 'caia';

/**
 * Secret names for each provider
 */
const PROVIDER_SECRET_NAMES: Record<OAuthProvider, string> = {
  fpki: process.env.FPKI_SECRET_NAME || 'ship/fpki-oauth-credentials',
  caia: process.env.CAIA_SECRET_NAME || 'ship/caia-credentials',
};

// Singleton credential stores (one per provider)
const credentialStores: Map<OAuthProvider, SecretsManagerCredentialStore> = new Map();

// In-memory cache of credentials per provider
const cachedCredentials: Map<OAuthProvider, StoredCredentials> = new Map();

/**
 * Get the credential store for a specific provider
 */
export function getCredentialStore(provider: OAuthProvider = 'fpki'): SecretsManagerCredentialStore {
  if (!credentialStores.has(provider)) {
    credentialStores.set(provider, new SecretsManagerCredentialStore({
      secretName: PROVIDER_SECRET_NAMES[provider],
      region: process.env.AWS_REGION || 'us-east-1',
    }));
  }
  return credentialStores.get(provider)!;
}

/**
 * Load credentials from Secrets Manager for a provider (cached)
 */
export async function loadCredentials(provider: OAuthProvider = 'fpki'): Promise<StoredCredentials | null> {
  if (cachedCredentials.has(provider)) {
    return cachedCredentials.get(provider)!;
  }

  try {
    const store = getCredentialStore(provider);
    const credentials = await store.load();
    if (credentials) {
      cachedCredentials.set(provider, credentials);
      console.log(`Loaded ${provider.toUpperCase()} OAuth credentials from Secrets Manager`);
    }
    return credentials;
  } catch (err) {
    console.warn(`Failed to load ${provider} credentials from Secrets Manager:`, err);
    return null;
  }
}

/**
 * Save credentials to Secrets Manager for a provider
 */
export async function saveCredentials(credentials: StoredCredentials, provider: OAuthProvider = 'fpki'): Promise<boolean> {
  try {
    const store = getCredentialStore(provider);
    const success = await store.save(credentials);
    if (success) {
      // Update cache
      cachedCredentials.set(provider, credentials);
      console.log(`Saved ${provider.toUpperCase()} OAuth credentials to Secrets Manager`);
    }
    return success;
  } catch (err) {
    console.error(`Failed to save ${provider} credentials to Secrets Manager:`, err);
    return false;
  }
}

/**
 * Get cached credentials for a provider (without loading from Secrets Manager)
 */
export function getCachedCredentials(provider: OAuthProvider = 'fpki'): StoredCredentials | null {
  return cachedCredentials.get(provider) || null;
}

/**
 * Get the public JWK for JWKS endpoint (FPKI only - for private_key_jwt)
 */
export function getPublicJwk(): JsonWebKey | null {
  const fpkiCreds = cachedCredentials.get('fpki');
  if (!fpkiCreds) return null;
  if (fpkiCreds.tokenEndpointAuthMethod !== 'private_key_jwt') return null;
  return fpkiCreds.publicJwk || null;
}

/**
 * Clear the credential cache for a provider (for testing)
 */
export function clearCredentialCache(provider?: OAuthProvider): void {
  if (provider) {
    cachedCredentials.delete(provider);
  } else {
    cachedCredentials.clear();
  }
}

/**
 * Check if credential store is available for a provider
 */
export async function isCredentialStoreAvailable(provider: OAuthProvider = 'fpki'): Promise<boolean> {
  const store = getCredentialStore(provider);
  return store.isAvailable();
}

/**
 * List all configured providers (that have credentials)
 */
export function getConfiguredProviders(): OAuthProvider[] {
  const providers: OAuthProvider[] = [];
  for (const [provider, creds] of cachedCredentials) {
    if (creds?.clientId && creds?.issuerUrl) {
      providers.push(provider);
    }
  }
  return providers;
}
