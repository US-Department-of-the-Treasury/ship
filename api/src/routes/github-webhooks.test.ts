import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../app.js';
import { verifyWebhookSignature } from './github-webhooks.js';

// Mock the github-credentials module
vi.mock('../services/github-credentials.js', () => ({
  getWebhookSecret: vi.fn(),
  loadGitHubCredentials: vi.fn().mockResolvedValue(null),
}));

import { getWebhookSecret } from '../services/github-credentials.js';

const TEST_SECRET = 'test-webhook-secret-12345';

/**
 * Generate a valid GitHub webhook signature for a payload
 */
function generateSignature(payload: string, secret: string): string {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  return `sha256=${hmac.digest('hex')}`;
}

describe('verifyWebhookSignature', () => {
  it('returns true for valid signature', () => {
    const payload = JSON.stringify({ test: 'data' });
    const signature = generateSignature(payload, TEST_SECRET);

    expect(verifyWebhookSignature(payload, signature, TEST_SECRET)).toBe(true);
  });

  it('returns false for invalid signature', () => {
    const payload = JSON.stringify({ test: 'data' });
    const wrongSignature = generateSignature(payload, 'wrong-secret');

    expect(verifyWebhookSignature(payload, wrongSignature, TEST_SECRET)).toBe(false);
  });

  it('returns false for missing signature', () => {
    const payload = JSON.stringify({ test: 'data' });

    expect(verifyWebhookSignature(payload, undefined, TEST_SECRET)).toBe(false);
  });

  it('returns false for signature without sha256 prefix', () => {
    const payload = JSON.stringify({ test: 'data' });
    const hmac = crypto.createHmac('sha256', TEST_SECRET);
    hmac.update(payload);
    const signatureWithoutPrefix = hmac.digest('hex');

    expect(verifyWebhookSignature(payload, signatureWithoutPrefix, TEST_SECRET)).toBe(false);
  });

  it('returns false for tampered payload', () => {
    const originalPayload = JSON.stringify({ test: 'data' });
    const signature = generateSignature(originalPayload, TEST_SECRET);
    const tamperedPayload = JSON.stringify({ test: 'tampered' });

    expect(verifyWebhookSignature(tamperedPayload, signature, TEST_SECRET)).toBe(false);
  });

  it('works with Buffer payload', () => {
    const payload = Buffer.from(JSON.stringify({ test: 'data' }));
    const signature = generateSignature(payload.toString(), TEST_SECRET);

    expect(verifyWebhookSignature(payload, signature, TEST_SECRET)).toBe(true);
  });
});

describe('POST /api/webhooks/github', () => {
  const app = createApp('http://localhost:5173');
  const mockedGetWebhookSecret = vi.mocked(getWebhookSecret);

  beforeEach(() => {
    mockedGetWebhookSecret.mockReturnValue(TEST_SECRET);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 without X-GitHub-Event header', async () => {
    const payload = { test: 'data' };
    const payloadStr = JSON.stringify(payload);
    const signature = generateSignature(payloadStr, TEST_SECRET);

    const res = await request(app)
      .post('/api/webhooks/github')
      .set('X-Hub-Signature-256', signature)
      .set('X-GitHub-Delivery', 'test-delivery-id')
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Missing X-GitHub-Event header');
  });

  it('returns 400 without X-GitHub-Delivery header', async () => {
    const payload = { test: 'data' };
    const payloadStr = JSON.stringify(payload);
    const signature = generateSignature(payloadStr, TEST_SECRET);

    const res = await request(app)
      .post('/api/webhooks/github')
      .set('X-Hub-Signature-256', signature)
      .set('X-GitHub-Event', 'ping')
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Missing X-GitHub-Delivery header');
  });

  it('returns 500 when webhook secret not configured', async () => {
    mockedGetWebhookSecret.mockReturnValue(null);

    const res = await request(app)
      .post('/api/webhooks/github')
      .set('X-GitHub-Event', 'ping')
      .set('X-GitHub-Delivery', 'test-delivery-id')
      .send({ zen: 'test' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Webhook not configured');
  });

  it('returns 401 for invalid signature', async () => {
    const payload = { test: 'data' };
    const wrongSignature = generateSignature(JSON.stringify(payload), 'wrong-secret');

    const res = await request(app)
      .post('/api/webhooks/github')
      .set('X-Hub-Signature-256', wrongSignature)
      .set('X-GitHub-Event', 'ping')
      .set('X-GitHub-Delivery', 'test-delivery-id')
      .send(payload);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid signature');
  });

  it('returns 200 for valid ping event', async () => {
    const payload = { zen: 'Keep it logically awesome.' };
    const payloadStr = JSON.stringify(payload);
    const signature = generateSignature(payloadStr, TEST_SECRET);

    const res = await request(app)
      .post('/api/webhooks/github')
      .set('X-Hub-Signature-256', signature)
      .set('X-GitHub-Event', 'ping')
      .set('X-GitHub-Delivery', 'test-delivery-123')
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });

  it('returns 200 for pull_request event', async () => {
    const payload = {
      action: 'opened',
      pull_request: {
        number: 1,
        title: 'Test PR',
      },
    };
    const payloadStr = JSON.stringify(payload);
    const signature = generateSignature(payloadStr, TEST_SECRET);

    const res = await request(app)
      .post('/api/webhooks/github')
      .set('X-Hub-Signature-256', signature)
      .set('X-GitHub-Event', 'pull_request')
      .set('X-GitHub-Delivery', 'test-delivery-456')
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });

  it('returns 200 for unknown event types', async () => {
    const payload = { data: 'test' };
    const payloadStr = JSON.stringify(payload);
    const signature = generateSignature(payloadStr, TEST_SECRET);

    const res = await request(app)
      .post('/api/webhooks/github')
      .set('X-Hub-Signature-256', signature)
      .set('X-GitHub-Event', 'unknown_event')
      .set('X-GitHub-Delivery', 'test-delivery-789')
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });
});
