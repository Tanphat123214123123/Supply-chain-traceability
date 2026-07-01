import cors from 'cors';
import express, { Express } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { AppContext } from './bootstrap';
import { authRoutes } from './api/routes/auth';
import { batchRoutes } from './api/routes/batches';
import { eventRoutes } from './api/routes/events';
import { statsRoutes } from './api/routes/stats';
import { traceRoutes } from './api/routes/trace';
import { errorHandler } from './api/middleware/error';

export function createApp(ctx: AppContext, publicOrigin: string): Express {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  app.get('/health', (_req, res) => res.json({ status: 'ok', usingPostgres: ctx.usingPostgres }));

  app.use('/api/auth', authRoutes(ctx.authService));
  app.use('/api/batches', batchRoutes(ctx.supplyChainService, ctx.authService, ctx.actorRepo, publicOrigin));
  app.use('/api/events', eventRoutes(ctx.supplyChainService, ctx.authService, ctx.actorRepo));
  app.use('/api/trace', traceRoutes(ctx.traceService, ctx.authService, ctx.actorRepo));
  app.use('/api/stats', statsRoutes(ctx.statsService, ctx.authService, ctx.actorRepo));

  app.use(errorHandler);

  return app;
}
