/**
 * GitHub App Credential Store Service
 *
 * Manages GitHub App credentials using AWS Secrets Manager.
 * Stores: App ID, Private Key, Webhook Secret, Installation ID
 */

import {
  SecretsManagerClient,
  GetSecretValueCommand,
  CreateSecretCommand,
  UpdateSecretCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-secrets-manager';

export interface GitHubAppCredentials {
  appId: string;
  privateKey: string;
  webhookSecret: string;
  clientId?: string;
  clientSecret?: string;
}

// Singleton secrets manager client
let secretsClient: SecretsManagerClient | null = null;

// In-memory cache of credentials
let cachedCredentials: GitHubAppCredentials | null = null;

const SECRET_NAME = process.env.GITHUB_APP_SECRET_NAME || 'ship/github-app-credentials';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

/**
 * Get the Secrets Manager client singleton
 */
function getSecretsClient(): SecretsManagerClient {
  if (!secretsClient) {
    secretsClient = new SecretsManagerClient({ region: AWS_REGION });
  }
  return secretsClient;
}

/**
 * Load GitHub App credentials from Secrets Manager (cached)
 */
export async function loadGitHubCredentials(): Promise<GitHubAppCredentials | null> {
  if (cachedCredentials) {
    return cachedCredentials;
  }

  try {
    const client = getSecretsClient();
    const response = await client.send(
      new GetSecretValueCommand({ SecretId: SECRET_NAME })
    );

    if (response.SecretString) {
      cachedCredentials = JSON.parse(response.SecretString) as GitHubAppCredentials;
      console.log('[GitHubCredentials] Loaded credentials from Secrets Manager');
      return cachedCredentials;
    }
    return null;
  } catch (err) {
    if (err instanceof ResourceNotFoundException) {
      console.log('[GitHubCredentials] Secret not found - GitHub integration not configured');
      return null;
    }
    console.warn('[GitHubCredentials] Failed to load credentials:', err);
    return null;
  }
}

/**
 * Save GitHub App credentials to Secrets Manager
 */
export async function saveGitHubCredentials(credentials: GitHubAppCredentials): Promise<boolean> {
  try {
    const client = getSecretsClient();
    const secretString = JSON.stringify(credentials);

    try {
      // Try to update existing secret
      await client.send(
        new UpdateSecretCommand({
          SecretId: SECRET_NAME,
          SecretString: secretString,
        })
      );
    } catch (err) {
      if (err instanceof ResourceNotFoundException) {
        // Create new secret if it doesn't exist
        await client.send(
          new CreateSecretCommand({
            Name: SECRET_NAME,
            SecretString: secretString,
          })
        );
      } else {
        throw err;
      }
    }

    // Update cache
    cachedCredentials = credentials;
    console.log('[GitHubCredentials] Saved credentials to Secrets Manager');
    return true;
  } catch (err) {
    console.error('[GitHubCredentials] Failed to save credentials:', err);
    return false;
  }
}

/**
 * Get cached credentials (without loading from Secrets Manager)
 */
export function getCachedGitHubCredentials(): GitHubAppCredentials | null {
  return cachedCredentials;
}

/**
 * Get webhook secret for signature verification
 */
export function getWebhookSecret(): string | null {
  return cachedCredentials?.webhookSecret || null;
}

/**
 * Clear the credential cache (for testing)
 */
export function clearGitHubCredentialCache(): void {
  cachedCredentials = null;
}

/**
 * Check if GitHub credentials are configured
 */
export function hasGitHubCredentials(): boolean {
  return cachedCredentials !== null;
}
