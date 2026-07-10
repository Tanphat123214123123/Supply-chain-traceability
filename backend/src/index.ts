import 'dotenv/config';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { createApp } from './app';
import { bootstrap } from './bootstrap';
import { Actor } from './domain/types';
import { OVERSIGHT_ROLES } from './services/adminService';
import { actorRoom, oversightRoom } from './realtime';

async function main(): Promise<void> {
  const ctx = await bootstrap();
  const port = Number(process.env.PORT ?? 3000);
  const publicOrigin = process.env.PUBLIC_ORIGIN ?? `http://localhost:${port}`;

  const app = createApp(ctx, publicOrigin);
  const httpServer = createServer(app);

  const io = new SocketIOServer(httpServer, { cors: { origin: publicOrigin, credentials: true } });
  // Anyone who could open a websocket to this server (no login required by
  // Socket.IO itself) would otherwise receive every anomaly/recall broadcast
  // system-wide — require a valid access token at handshake time, same as REST,
  // AND resolve the full actor (role + tenantId) so the connection can be
  // placed in the right rooms below — a decoded JWT payload alone isn't
  // enough to know current tenant/role if either ever changed after the
  // token was issued.
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (typeof token !== 'string') {
      next(new Error('unauthorized'));
      return;
    }
    try {
      const payload = ctx.authService.verifyToken(token);
      const actor = await ctx.actorRepo.findById(payload.actorId);
      if (!actor || !actor.isActive) {
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
    console.log(`TraceChain backend listening on :${port} (store: ${ctx.usingPostgres ? 'PostgreSQL' : 'in-memory'})`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
