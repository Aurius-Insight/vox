import cookieParser from 'cookie-parser';
import express from 'express';
import { applySecurity } from './middleware/security.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { csrfGuard } from './middleware/csrf.js';
import { attachPortalStudent, attachUser } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { observability } from './middleware/observability.js';
import authRouter from './routes/auth.js';
import classesRouter from './routes/classes.js';
import dashboardRouter from './routes/dashboard.js';
import healthRouter from './routes/health.js';
import leadsRouter from './routes/leads.js';
import packagesRouter from './routes/packages.js';
import portalRouter from './routes/portal.js';
import studentsRouter from './routes/students.js';
import subjectsRouter from './routes/subjects.js';
import unitsRouter from './routes/units.js';
import usersRouter from './routes/users.js';
import webhooksRouter from './routes/webhooks.js';

export function createApp() {
  const app = express();

  // Atras de reverse proxy (Render, Railway, Nginx): garante `req.ip` real
  // (rate limit por IP funciona) e cookie `Secure` interpretado certo.
  app.set('trust proxy', 1);

  applySecurity(app);
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());
  app.use(csrfGuard);
  app.use(attachUser);
  app.use(attachPortalStudent);
  // Depois de attachUser para capturar o userId; antes do rate limit para
  // tambem registrar os 429.
  app.use(observability);

  app.use('/api', apiLimiter);
  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/leads', leadsRouter);
  app.use('/api/students', studentsRouter);
  app.use('/api/subjects', subjectsRouter);
  app.use('/api/classes', classesRouter);
  app.use('/api/units', unitsRouter);
  app.use('/api/packages', packagesRouter);
  app.use('/api/portal', portalRouter);
  app.use('/api/webhooks', webhooksRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
