import dotenv from 'dotenv';
dotenv.config();

import { bootstrap } from './bootstrap';
import { createApp } from './api/server';

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-in-production';

bootstrap(JWT_SECRET)
  .then(({ authService, supplyChainService }) => {
    const app = createApp(authService, supplyChainService);
    app.listen(PORT, () => {
      console.log(`\nTraceChain API  →  http://localhost:${PORT}`);
      console.log(`Health check    →  http://localhost:${PORT}/health`);
    });
  })
  .catch((err) => {
    console.error('Failed to start:', err);
    process.exit(1);
  });
