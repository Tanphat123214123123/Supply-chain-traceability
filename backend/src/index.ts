import 'dotenv/config';
import { createApp } from './app';
import { bootstrap } from './bootstrap';

async function main(): Promise<void> {
  const ctx = await bootstrap();
  const port = Number(process.env.PORT ?? 3000);
  const publicOrigin = process.env.PUBLIC_ORIGIN ?? `http://localhost:${port}`;

  const app = createApp(ctx, publicOrigin);

  app.listen(port, () => {
    console.log(`TraceChain backend listening on :${port} (store: ${ctx.usingPostgres ? 'PostgreSQL' : 'in-memory'})`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
