import { createHash } from 'crypto';
import { TraceEvent } from '../domain/types';

export const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

export function computeEventHash(event: Omit<TraceEvent, 'hash'>): string {
  const payload = JSON.stringify({
    id: event.id,
    batchId: event.batchId,
    stage: event.stage,
    actorId: event.actorId,
    timestamp: event.timestamp.toISOString(),
    location: event.location,
    notes: event.notes ?? null,
    data: event.data,
    prevHash: event.prevHash,
    sequenceNumber: event.sequenceNumber,
  });
  return createHash('sha256').update(payload).digest('hex');
}

export function verifyChain(events: TraceEvent[]): { valid: boolean; tamperedAt?: number } {
  if (events.length === 0) return { valid: true };

  const sorted = [...events].sort((a, b) => a.sequenceNumber - b.sequenceNumber);

  for (let i = 0; i < sorted.length; i++) {
    const event = sorted[i];
    const expectedPrevHash = i === 0 ? GENESIS_HASH : sorted[i - 1].hash;

    if (event.prevHash !== expectedPrevHash) {
      return { valid: false, tamperedAt: i };
    }

    const { hash, ...rest } = event;
    const recomputed = computeEventHash(rest);
    if (recomputed !== hash) {
      return { valid: false, tamperedAt: i };
    }
  }

  return { valid: true };
}
