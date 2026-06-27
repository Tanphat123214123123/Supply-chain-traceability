import express from 'express';
import cors from 'cors';
import { AuthService } from '../services/authService';
import { SupplyChainService } from '../services/supplyChainService';
import { authRouter } from './routes/auth.routes';
import { batchRouter } from './routes/batch.routes';
import { eventRouter } from './routes/event.routes';
import { traceRouter } from './routes/trace.routes';
import { errorMiddleware } from './middleware/error.middleware';

export function createApp(authService: AuthService, supplyChainService: SupplyChainService) {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

  app.use('/api/auth', authRouter(authService));
  app.use('/api/batches', batchRouter(supplyChainService, authService));
  app.use('/api/events', eventRouter(supplyChainService, authService));
  app.use('/api/trace', traceRouter(supplyChainService, authService));

  app.use(errorMiddleware);

  return app;
}
