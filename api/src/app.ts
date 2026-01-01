import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import { csrfSync } from 'csrf-sync';
import authRoutes from './routes/auth.js';
import documentsRoutes from './routes/documents.js';
import issuesRoutes from './routes/issues.js';
import feedbackRoutes from './routes/feedback.js';
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

// Validate SESSION_SECRET in production
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET environment variable is required in production');
}

const sessionSecret = process.env.SESSION_SECRET || 'dev-only-secret-do-not-use-in-production';

// CSRF protection setup
const { csrfSynchronisedProtection, generateToken } = csrfSync({
  getTokenFromRequest: (req) => req.headers['x-csrf-token'] as string,
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

  // Middleware
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },  // Allow images to be loaded cross-origin
  }));
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

  // File upload routes (CSRF protected for POST endpoints)
  app.use('/api/files', csrfSynchronisedProtection, filesRouter);

  return app;
}
