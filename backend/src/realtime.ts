import { Server as SocketIOServer } from 'socket.io';
import { Anomaly, Batch } from './domain/types';
import { RealtimeEmitter } from './services/supplyChainService';

/** Every actor's personal room — used to target a specific recipient without a broadcast. */
export function actorRoom(tenantId: string, actorId: string): string {
  return `tenant:${tenantId}:actor:${actorId}`;
}

/** ADMIN/INSPECTOR (see `OVERSIGHT_ROLES` in adminService.ts) get every alert in their own tenant, not just ones they're personally involved in. */
export function oversightRoom(tenantId: string): string {
  return `tenant:${tenantId}:oversight`;
}

/**
 * The Socket.IO server only exists once the HTTP server is created in index.ts,
 * but SupplyChainService needs an emitter at construction time in bootstrap.ts —
 * this indirection lets bootstrap wire the emitter in before the transport exists.
 */
export class SocketRealtimeEmitter implements RealtimeEmitter {
  private io: SocketIOServer | null = null;

  attach(io: SocketIOServer): void {
    this.io = io;
  }

  emitAnomaly(anomaly: Anomaly, recipientActorIds: string[]): void {
    const rooms = [oversightRoom(anomaly.tenantId), ...recipientActorIds.map((id) => actorRoom(anomaly.tenantId, id))];
    this.io?.to(rooms).emit('anomaly', anomaly);
  }

  emitRecall(batch: Batch, recipientActorIds: string[]): void {
    const rooms = [oversightRoom(batch.tenantId), ...recipientActorIds.map((id) => actorRoom(batch.tenantId, id))];
    this.io?.to(rooms).emit('recall', batch);
  }
}
