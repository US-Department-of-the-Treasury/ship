import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import { csrfSync } from 'csrf-sync';
import rateLimit from 'express-rate-limit';
import authRoutes from './routes/auth.js';
import documentsRoutes from './routes/documents.js';
import issuesRoutes from './routes/issues.js';
import feedbackRoutes, { publicFeedbackRouter } from './routes/feedback.js';
import programsRoutes from './routes/programs.js';
import sprintsRoutes from './routes/sprints.js';
import teamRoutes from './routes/team.js';
import workspacesRoutes from './routes/workspaces.js';
import adminRoutes from './routes/admin.js';
import invitesRoutes from './routes/invites.js';
import setupRoutes from './routes/setup.js';
import backlinksRoutes from './routes/backlinks.js';
import { searchRouter } from './routes/search.js';
import { filesRouter } from './routes/files.js';
import pivAuthRoutes from './routes/piv-auth.js';
import federationRoutes from './routes/federation.js';
import githubWebhooksRoutes, { initializeGitHubWebhooks } from './routes/github-webhooks.js';
import githubActivityRoutes from './routes/github-activity.js';
import { createJwksHandler } from '@fpki/auth-client';
import { getPublicJwk } from './services/credential-store.js';
import { initializeFPKI } from './services/fpki.js';

// Validate SESSION_SECRET in production
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET environment variable is required in production');
}

const sessionSecret = process.env.SESSION_SECRET || 'dev-only-secret-do-not-use-in-production';

// CSRF protection setup
const { csrfSynchronisedProtection, generateToken } = csrfSync({
  getTokenFromRequest: (req) => req.headers['x-csrf-token'] as string,
});

// Rate limiting configurations
// In test environment, use much higher limits to avoid flaky tests
// Production limits: login=5/15min (failed only), api=100/min
const isTestEnv = process.env.NODE_ENV === 'test' || process.env.E2E_TEST === '1';

// Strict rate limit for login (5 failed attempts / 15 min) - brute force protection
// skipSuccessfulRequests: true means only failed attempts count toward the limit
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isTestEnv ? 1000 : 5, // High limit for tests
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
  skipSuccessfulRequests: true, // Only count failed login attempts
});

// General API rate limit (100 req/min)
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: isTestEnv ? 10000 : 100, // High limit for tests
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

// JWKS handler with built-in rate limiting from SDK (30 req/min)
const jwksHandler = createJwksHandler({
  getPublicJwk,
  rateLimit: isTestEnv ? false : { windowMs: 60000, maxRequests: 30 },
});

export function createApp(corsOrigin: string = 'http://localhost:5173'): express.Express {
  const app = express();

  // Trust proxy headers (CloudFront) for secure cookies and correct protocol detection
  if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);

    // CloudFront with viewer_protocol_policy="redirect-to-https" always serves viewers over HTTPS.
    // However, CloudFront -> EB uses HTTP (origin_protocol_policy="http-only"), so CloudFront
    // sets X-Forwarded-Proto to "http". Override it to "https" when request comes via CloudFront.
    app.use((req, _res, next) => {
      // CloudFront adds Via header like "2.0 <id>.cloudfront.net (CloudFront)"
      const viaHeader = req.headers['via'] as string;
      if (viaHeader && viaHeader.includes('cloudfront')) {
        req.headers['x-forwarded-proto'] = 'https';
      }
      next();
    });
  }

  // Middleware - Security headers
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },  // Allow images to be loaded cross-origin
    // Content Security Policy - prevents XSS attacks
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // TipTap editor needs inline styles
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        connectSrc: ["'self'", "wss:", "ws:"], // WebSocket connections
        fontSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        frameSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      }
    },
    // HTTP Strict Transport Security
    hsts: {
      maxAge: 31536000, // 1 year in seconds
      includeSubDomains: true,
      preload: true,
    },
  }));

  // Apply rate limiting to all API routes
  app.use('/api/', apiLimiter);
  app.use(cors({
    origin: corsOrigin,
    credentials: true,
  }));
  app.use(express.json());
  app.use(cookieParser(sessionSecret));

  // Session middleware for CSRF token storage
  app.use(session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 15 * 60 * 1000, // 15 minutes
    },
  }));

  // CSRF token endpoint (must be before CSRF protection middleware)
  app.get('/api/csrf-token', (req, res) => {
    res.json({ token: generateToken(req) });
  });

  // Health check (no CSRF needed)
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Setup routes (CSRF protected - first-time setup only)
  app.use('/api/setup', csrfSynchronisedProtection, setupRoutes);

  // Public feedback routes - no auth or CSRF required (must be before protected routes)
  app.use('/api/feedback', publicFeedbackRouter);

  // Apply stricter rate limiting to login endpoint (brute force protection)
  app.use('/api/auth/login', loginLimiter);

  // Apply CSRF protection to all state-changing API routes
  app.use('/api/auth', csrfSynchronisedProtection, authRoutes);
  app.use('/api/documents', csrfSynchronisedProtection, documentsRoutes);
  app.use('/api/documents', csrfSynchronisedProtection, backlinksRoutes);
  app.use('/api/issues', csrfSynchronisedProtection, issuesRoutes);
  app.use('/api/feedback', csrfSynchronisedProtection, feedbackRoutes);
  app.use('/api/programs', csrfSynchronisedProtection, programsRoutes);
  app.use('/api/sprints', csrfSynchronisedProtection, sprintsRoutes);
  app.use('/api/team', csrfSynchronisedProtection, teamRoutes);
  app.use('/api/workspaces', csrfSynchronisedProtection, workspacesRoutes);
  app.use('/api/admin', csrfSynchronisedProtection, adminRoutes);
  app.use('/api/invites', csrfSynchronisedProtection, invitesRoutes);

  // Search routes are read-only GET endpoints - no CSRF needed
  app.use('/api/search', searchRouter);

  // GitHub activity routes - read-only GET endpoints - no CSRF needed
  app.use('/api/github/activity', githubActivityRoutes);

  // PIV auth routes - no CSRF protection (OAuth flow with external callback)
  app.use('/api/auth/piv', pivAuthRoutes);

  // Federation routes - CSRF protected (admin credential management)
  // Note: mTLS happens between browser and FPKI Validator, not browser and this API.
  // These endpoints are standard POSTs from our frontend and need CSRF protection.
  app.use('/api/federation', csrfSynchronisedProtection, federationRoutes);

  // JWKS endpoint for private_key_jwt - public, no auth needed
  // Rate limiting is built into the SDK handler
  app.get('/.well-known/jwks.json', jwksHandler);

  // File upload routes (CSRF protected for POST endpoints)
  app.use('/api/files', csrfSynchronisedProtection, filesRouter);

  // GitHub webhook routes - NO CSRF protection (external source with signature verification)
  app.use('/api/webhooks/github', githubWebhooksRoutes);

  // Initialize FPKI credentials from Secrets Manager at startup
  initializeFPKI().catch((err) => {
    console.warn('FPKI initialization failed:', err);
  });

  // Initialize GitHub webhook credentials
  initializeGitHubWebhooks().catch((err) => {
    console.warn('GitHub webhook initialization failed:', err);
  });

  return app;
}
