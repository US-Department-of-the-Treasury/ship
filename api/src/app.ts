import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/auth.js';
import documentsRoutes from './routes/documents.js';
import issuesRoutes from './routes/issues.js';
import programsRoutes from './routes/programs.js';
import sprintsRoutes from './routes/sprints.js';
import teamRoutes from './routes/team.js';

export function createApp(corsOrigin: string = 'http://localhost:5173'): express.Express {
  const app = express();

  // Middleware
  app.use(helmet());
  app.use(cors({
    origin: corsOrigin,
    credentials: true,
  }));
  app.use(express.json());
  app.use(cookieParser());

  // Routes
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/documents', documentsRoutes);
  app.use('/api/issues', issuesRoutes);
  app.use('/api/programs', programsRoutes);
  app.use('/api/sprints', sprintsRoutes);
  app.use('/api/team', teamRoutes);

  return app;
}
