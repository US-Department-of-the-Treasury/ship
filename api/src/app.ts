import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/auth.js';
import documentsRoutes from './routes/documents.js';
import issuesRoutes from './routes/issues.js';
import projectsRoutes from './routes/projects.js';
import sprintsRoutes from './routes/sprints.js';

export function createApp(corsOrigin: string = 'http://localhost:5173') {
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
  app.use('/api/projects', projectsRoutes);
  app.use('/api/sprints', sprintsRoutes);

  return app;
}
