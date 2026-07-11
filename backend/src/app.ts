import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Express } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { AppContext } from './bootstrap';
import { openApiSpec } from './openapi';
import { actorsRoutes } from './api/routes/actors';
import { adminRoutes } from './api/routes/admin';
import { authRoutes } from './api/routes/auth';
import { batchRoutes } from './api/routes/batches';
import { eventRoutes } from './api/routes/events';
import { notificationsRoutes } from './api/routes/notifications';
import { statsRoutes } from './api/routes/stats';
import { traceRoutes } from './api/routes/trace';
import { errorHandler } from './api/middleware/error';

export function createApp(ctx: AppContext, publicOrigin: string): Express {
  const app = express();

  app.use(helmet());
  // Refresh tokens now travel as an httpOnly cookie, which requires an explicit
  // origin (not '*') plus credentials: true for the browser to send/accept it.
  app.use(cors({ origin: publicOrigin, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  app.get('/health', (_req, res) => res.json({ status: 'ok', usingPostgres: ctx.usingPostgres }));

  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));
  app.get('/api/openapi.json', (_req, res) => res.json(openApiSpec));

  app.use('/api/auth', authRoutes(ctx.authService, ctx.actorRepo));
  app.use('/api/batches', batchRoutes(ctx.supplyChainService, ctx.authService, ctx.actorRepo, publicOrigin));
  app.use('/api/events', eventRoutes(ctx.supplyChainService, ctx.authService, ctx.actorRepo));
  app.use('/api/trace', traceRoutes(ctx.traceService, ctx.authService, ctx.actorRepo));
  app.use('/api/stats', statsRoutes(ctx.statsService, ctx.authService, ctx.actorRepo));
  app.use('/api/admin', adminRoutes(ctx.auditLogRepo, ctx.adminService, ctx.authService, ctx.actorRepo));
  app.use('/api/actors', actorsRoutes(ctx.adminService, ctx.authService, ctx.actorRepo));
  app.use('/api/notifications', notificationsRoutes(ctx.adminService, ctx.authService, ctx.actorRepo));

  app.use(errorHandler);

  return app;
}
