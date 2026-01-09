/**
 * GitHub Webhook Routes
 *
 * Receives webhook events from GitHub App.
 * Verifies signatures and routes events to appropriate handlers.
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getWebhookSecret, loadGitHubCredentials } from '../services/github-credentials.js';
import { handlePullRequestEvent } from '../services/github-activity.js';

const router = Router();

// Webhook event types we handle
type GitHubEventType =
  | 'pull_request'
  | 'push'
  | 'installation'
  | 'installation_repositories'
  | 'ping';

// Event handlers map
type EventHandler = (payload: unknown, deliveryId: string) => Promise<void>;

const eventHandlers: Partial<Record<GitHubEventType, EventHandler>> = {
  ping: async (_payload, deliveryId) => {
    console.log(`[GitHub Webhook] Ping received (delivery: ${deliveryId})`);
  },
  pull_request: async (payload, deliveryId) => {
    console.log(`[GitHub Webhook] PR event received (delivery: ${deliveryId})`, {
      action: (payload as { action?: string }).action,
    });
    await handlePullRequestEvent(payload);
  },
  installation: async (payload, deliveryId) => {
    // Log installation events for debugging
    console.log(`[GitHub Webhook] Installation event (delivery: ${deliveryId})`, {
      action: (payload as { action?: string }).action,
    });
  },
};

/**
 * Verify GitHub webhook signature using HMAC SHA-256
 * Uses timing-safe comparison to prevent timing attacks
 */
export function verifyWebhookSignature(
  payload: string | Buffer,
  signature: string | undefined,
  secret: string
): boolean {
  if (!signature) {
    return false;
  }

  // GitHub sends signature as "sha256=<hex>"
  const expectedPrefix = 'sha256=';
  if (!signature.startsWith(expectedPrefix)) {
    return false;
  }

  const signatureHex = signature.slice(expectedPrefix.length);

  // Compute expected signature
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(typeof payload === 'string' ? payload : payload);
  const expectedSignature = hmac.digest('hex');

  // Timing-safe comparison
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signatureHex, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  } catch {
    // If buffers are different lengths, timingSafeEqual throws
    return false;
  }
}

/**
 * POST /api/webhooks/github
 *
 * Receives GitHub webhook events.
 * Verifies signature and routes to appropriate handler.
 */
router.post('/', async (req: Request, res: Response) => {
  // Get headers
  const signature = req.headers['x-hub-signature-256'] as string | undefined;
  const eventType = req.headers['x-github-event'] as GitHubEventType | undefined;
  const deliveryId = req.headers['x-github-delivery'] as string | undefined;

  // Validate required headers
  if (!eventType) {
    return res.status(400).json({ error: 'Missing X-GitHub-Event header' });
  }

  if (!deliveryId) {
    return res.status(400).json({ error: 'Missing X-GitHub-Delivery header' });
  }

  // Get webhook secret
  const secret = getWebhookSecret();
  if (!secret) {
    console.warn('[GitHub Webhook] No webhook secret configured');
    return res.status(500).json({ error: 'Webhook not configured' });
  }

  // Get raw body for signature verification
  // Note: We need the raw body, not parsed JSON, for signature verification
  // Express.json() has already parsed it, but we stored raw in req.body before parsing
  // For now, we'll re-stringify (not ideal but works for initial implementation)
  const rawBody = JSON.stringify(req.body);

  // Verify signature
  if (!verifyWebhookSignature(rawBody, signature, secret)) {
    console.warn(`[GitHub Webhook] Invalid signature (delivery: ${deliveryId})`);
    return res.status(401).json({ error: 'Invalid signature' });
  }

  console.log(`[GitHub Webhook] Received ${eventType} event (delivery: ${deliveryId})`);

  // Route to handler
  const handler = eventHandlers[eventType];
  if (handler) {
    try {
      await handler(req.body, deliveryId);
    } catch (err) {
      console.error(`[GitHub Webhook] Handler error for ${eventType}:`, err);
      // Return 500 so GitHub will retry
      return res.status(500).json({ error: 'Handler failed' });
    }
  } else {
    console.log(`[GitHub Webhook] No handler for event type: ${eventType}`);
  }

  // Always return 200 for events we don't handle (don't want GitHub to retry)
  return res.status(200).json({ received: true });
});

/**
 * Initialize GitHub credentials at startup
 */
export async function initializeGitHubWebhooks(): Promise<void> {
  try {
    const credentials = await loadGitHubCredentials();
    if (credentials) {
      console.log('[GitHub Webhook] Credentials loaded');
    } else {
      console.log('[GitHub Webhook] No credentials configured - webhooks disabled');
    }
  } catch (err) {
    console.warn('[GitHub Webhook] Failed to initialize:', err);
  }
}

export default router;
