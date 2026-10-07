import 'dotenv/config';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { createApp } from './app';
import { bootstrap } from './bootstrap';
import { Actor } from './domain/types';
import { OVERSIGHT_ROLES } from './services/adminService';
import { actorRoom, oversightRoom } from './realtime';

const SESSION_PURGE_INTERVAL_MS = 60 * 60 * 1000;
const SHUTDOWN_GRACE_MS = 10_000;

async function main(): Promise<void> {
  const ctx = await bootstrap();
  const port = Number(process.env.PORT ?? 3000);
  const publicOrigin = process.env.PUBLIC_ORIGIN ?? `http://localhost:${port}`;

  const app = createApp(ctx, publicOrigin);
  const httpServer = createServer(app);

  const io = new SocketIOServer(httpServer, { cors: { origin: publicOrigin, credentials: true } });
  // Anyone who could open a websocket to this server (no login required by
  // Socket.IO itself) would otherwise receive every anomaly/recall broadcast
  // — require a valid access token at handshake time, same as REST, and
  // resolve the full current actor (role + tenant) to place the socket in
  // the right rooms.
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (typeof token !== 'string') {
      next(new Error('unauthorized'));
      return;
    }
    try {
      const actor = await ctx.authService.authenticate(token);
      if (!actor) {
        next(new Error('unauthorized'));
        return;
      }
      socket.data.actor = actor;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });
  io.on('connection', (socket) => {
    const actor = socket.data.actor as Actor;
    socket.join(actorRoom(actor.tenantId, actor.id));
    if (OVERSIGHT_ROLES.includes(actor.role)) socket.join(oversightRoom(actor.tenantId));
  });
  ctx.realtime.attach(io);

  httpServer.listen(port, () => {
    console.log(`TraceChain backend listening on :${port}`);
  });

  // Detect tampering that happened while the server was down. Runs after
  // listen() in the background: its cost grows with the data, and it must
  // never delay (or, by failing, prevent) the server from coming up.
  ctx.adminService
    .scanForTamperedChains()
    .then((flagged) => {
      if (flagged.length > 0) console.warn(`Integrity scan flagged ${flagged.length} batch(es) with a broken hash chain.`);
    })
    .catch((err) => console.error('Startup integrity scan failed:', err));

  const purgeTimer = setInterval(() => {
    ctx.authService.purgeStaleSessions().catch((err) => console.error('Session purge failed:', err));
  }, SESSION_PURGE_INTERVAL_MS);
  purgeTimer.unref();

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received — draining connections...`);
    clearInterval(purgeTimer);

    const force = setTimeout(() => {
      console.error('Graceful shutdown timed out — forcing exit.');
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    force.unref();

    // Stop accepting connections and wait for in-flight HTTP requests (and
    // their transactions) to finish before the pool is closed under them...
    httpServer.close(async () => {
      try {
        await ctx.db.close();
      } finally {
        process.exit(0);
      }
    });
    // ...while dropping websocket clients, which would otherwise hold the server open.
    io.disconnectSockets(true);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
