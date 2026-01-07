/**
 * OAuth Credential Store Service
 *
 * Manages OAuth client credentials using AWS Secrets Manager via the SDK.
 * Credentials are loaded at startup and can be updated via the federation endpoints.
 */

import {
  SecretsManagerCredentialStore,
  type StoredCredentials,
  type JsonWebKey,
} from '@fpki/auth-client';

// Re-export StoredCredentials for convenience
export type { StoredCredentials };

// Singleton credential store
let credentialStore: SecretsManagerCredentialStore | null = null;

// In-memory cache of credentials (loaded from Secrets Manager)
let cachedCredentials: StoredCredentials | null = null;

/**
 * Get the credential store singleton
 */
export function getCredentialStore(): SecretsManagerCredentialStore {
  if (!credentialStore) {
    credentialStore = new SecretsManagerCredentialStore({
      secretName: process.env.FPKI_SECRET_NAME || 'ship/fpki-oauth-credentials',
      region: process.env.AWS_REGION || 'us-east-1',
    });
  }
  return credentialStore;
}

/**
 * Load credentials from Secrets Manager (cached)
 */
export async function loadCredentials(): Promise<StoredCredentials | null> {
  if (cachedCredentials) {
    return cachedCredentials;
  }

  try {
    const store = getCredentialStore();
    cachedCredentials = await store.load();
    if (cachedCredentials) {
      console.log('Loaded OAuth credentials from Secrets Manager');
    }
    return cachedCredentials;
  } catch (err) {
    console.warn('Failed to load credentials from Secrets Manager:', err);
    return null;
  }
}

/**
 * Save credentials to Secrets Manager
 */
export async function saveCredentials(credentials: StoredCredentials): Promise<boolean> {
  try {
    const store = getCredentialStore();
    const success = await store.save(credentials);
    if (success) {
      // Update cache
      cachedCredentials = credentials;
      console.log('Saved OAuth credentials to Secrets Manager');
    }
    return success;
  } catch (err) {
    console.error('Failed to save credentials to Secrets Manager:', err);
    return false;
  }
}

/**
 * Get cached credentials (without loading from Secrets Manager)
 */
export function getCachedCredentials(): StoredCredentials | null {
  return cachedCredentials;
}

/**
 * Get the public JWK for JWKS endpoint
 */
export function getPublicJwk(): JsonWebKey | null {
  if (!cachedCredentials) return null;
  if (cachedCredentials.tokenEndpointAuthMethod !== 'private_key_jwt') return null;
  return cachedCredentials.publicJwk || null;
}

/**
 * Clear the credential cache (for testing)
 */
export function clearCredentialCache(): void {
  cachedCredentials = null;
}

/**
 * Check if credential store is available
 */
export async function isCredentialStoreAvailable(): Promise<boolean> {
  const store = getCredentialStore();
  return store.isAvailable();
}
