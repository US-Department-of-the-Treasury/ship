#!/usr/bin/env node
/**
 * HTTP/2 reverse proxy for local development.
 *
 * Sits in front of the Vite dev server and speaks HTTP/2 (h2) to the browser.
 * This eliminates the browser's 6-connection-per-origin limit for HTTP/1.1,
 * which is critical when using Electric SQL shape streams (each shape holds
 * a long-polling connection for live updates).
 *
 * Architecture:
 *   Browser ──(HTTP/2)──▶ H2 Proxy ──(HTTP/1.1)──▶ Vite ──▶ Express ──▶ Electric
 *
 * The proxy handles:
 *   - HTTP/2 streams → forwarded as HTTP/1.1 requests to Vite
 *   - WebSocket upgrades → forwarded to Vite (for HMR, collaboration, events)
 */

import { createSecureServer } from 'node:http2';
import { request as httpRequest } from 'node:http';
import { createConnection } from 'node:net';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CERT_DIR = resolve(__dirname, 'certs');

const VITE_PORT = parseInt(process.env.VITE_PORT || '5175', 10);
const H2_PORT = parseInt(process.env.H2_PORT || '5176', 10);

function headerValue(value) {
  return Array.isArray(value) ? value.join(', ') : String(value);
}

function sanitizeHttpHeaders(headers) {
  const out = {};
  for (const [rawKey, rawValue] of Object.entries(headers)) {
    if (rawValue == null) continue;
    const key = rawKey.toLowerCase();
    // Strip HTTP/2 pseudo headers and hop-by-hop headers.
    if (key.startsWith(':')) continue;
    if (
      key === 'connection' ||
      key === 'keep-alive' ||
      key === 'proxy-connection' ||
      key === 'transfer-encoding' ||
      key === 'upgrade' ||
      key === 'host'
    ) {
      continue;
    }
    out[key] = headerValue(rawValue);
  }
  return out;
}

function sanitizeHttp2ResponseHeaders(headers) {
  const out = {};
  for (const [rawKey, rawValue] of Object.entries(headers)) {
    if (rawValue == null) continue;
    const key = rawKey.toLowerCase();
    // HTTP/2 forbids HTTP/1.x connection-specific response headers.
    if (
      key === 'connection' ||
      key === 'keep-alive' ||
      key === 'proxy-connection' ||
      key === 'transfer-encoding' ||
      key === 'upgrade' ||
      key === 'te'
    ) {
      continue;
    }
    out[key] = headerValue(rawValue);
  }
  return out;
}

// Load TLS certificates
const keyPath = resolve(CERT_DIR, 'localhost-key.pem');
const certPath = resolve(CERT_DIR, 'localhost.pem');

if (!existsSync(keyPath) || !existsSync(certPath)) {
  console.error('[h2-proxy] TLS certificates not found in scripts/certs/');
  console.error('[h2-proxy] Run: bash scripts/generate-dev-certs.sh');
  process.exit(1);
}

const server = createSecureServer({
  key: readFileSync(keyPath),
  cert: readFileSync(certPath),
  allowHTTP1: true, // Required for WebSocket upgrades (HTTP/1.1)
});

// ── HTTP/2 request handling ─────────────────────────────────────────────────
// The `request` event fires for both HTTP/2 and HTTP/1.1 (when allowHTTP1=true).
// We forward all requests to Vite over HTTP/1.1.
server.on('request', (req, res) => {
  const proxyReq = httpRequest(
    {
      hostname: 'localhost',
      port: VITE_PORT,
      path: req.url,
      method: req.method,
      headers: {
        ...sanitizeHttpHeaders(req.headers),
        // Rewrite host to Vite's expected host
        host: `localhost:${VITE_PORT}`,
      },
    },
    (proxyRes) => {
      // Forward status and headers
      res.writeHead(proxyRes.statusCode ?? 502, sanitizeHttp2ResponseHeaders(proxyRes.headers));
      // Stream response body
      proxyRes.pipe(res);
    }
  );

  proxyReq.on('error', (err) => {
    console.error('[h2-proxy] Proxy error:', err.message);
    if (!res.headersSent) {
      res.writeHead(502);
    }
    res.end('Bad Gateway');
  });

  // Stream request body
  req.pipe(proxyReq);
});

// ── WebSocket upgrade handling ──────────────────────────────────────────────
// WebSocket connections (Vite HMR, collaboration, real-time events) use
// HTTP/1.1 upgrade. We forward the raw TCP connection to Vite.
server.on('upgrade', (req, socket, head) => {
  const proxy = createConnection({ port: VITE_PORT, host: 'localhost' }, () => {
    // Reconstruct the HTTP upgrade request
    const headers = Object.entries(req.headers)
      .filter(([k, v]) => k.toLowerCase() !== 'host' && v != null)
      .map(([k, v]) => `${k}: ${headerValue(v)}`)
      .join('\r\n');

    proxy.write(
      `${req.method} ${req.url} HTTP/1.1\r\n` +
        `host: localhost:${VITE_PORT}\r\n` +
        `${headers}\r\n` +
        '\r\n'
    );

    if (head.length > 0) {
      proxy.write(head);
    }

    // Bi-directional pipe
    socket.pipe(proxy);
    proxy.pipe(socket);
  });

  proxy.on('error', (err) => {
    console.error('[h2-proxy] WebSocket proxy error:', err.message);
    socket.destroy();
  });

  socket.on('error', () => proxy.destroy());
});

// ── Start ───────────────────────────────────────────────────────────────────
server.listen(H2_PORT, '127.0.0.1', () => {
  console.log(`[h2-proxy] HTTP/2 proxy listening on https://localhost:${H2_PORT}`);
  console.log(`[h2-proxy] Forwarding to Vite on http://localhost:${VITE_PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[h2-proxy] Port ${H2_PORT} is already in use`);
    process.exit(1);
  }
  throw err;
});
