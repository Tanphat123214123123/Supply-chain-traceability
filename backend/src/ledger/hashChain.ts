import { createHash } from 'crypto';
import { TraceEvent } from '../domain/types';

export const GENESIS_HASH = '0'.repeat(64);

type UnhashedEvent = Pick<
  TraceEvent,
  'batchId' | 'stage' | 'actorId' | 'timestamp' | 'location' | 'notes' | 'data' | 'prevHash' | 'sequenceNumber'
>;

/** Deterministic JSON so identical event content always yields the same hash. */
function canonicalPayload(event: UnhashedEvent): string {
  return JSON.stringify({
    batchId: event.batchId,
    stage: event.stage,
    actorId: event.actorId,
    timestamp: event.timestamp.toISOString(),
    location: event.location,
    notes: event.notes ?? null,
    data: event.data ?? {},
    prevHash: event.prevHash,
    sequenceNumber: event.sequenceNumber,
  });
}

export function computeEventHash(event: UnhashedEvent): string {
  return createHash('sha256').update(canonicalPayload(event)).digest('hex');
}

/**
 * Verifies that a batch's event chain is intact: hashes recompute correctly
 * and each event's prevHash links to the previous event's hash.
 * Events must be passed sorted by sequenceNumber ascending.
 */
export function verifyChain(events: TraceEvent[]): boolean {
  let expectedPrevHash = GENESIS_HASH;

  for (const event of events) {
    if (event.prevHash !== expectedPrevHash) return false;

    const recomputed = computeEventHash({
      batchId: event.batchId,
      stage: event.stage,
      actorId: event.actorId,
      timestamp: event.timestamp,
      location: event.location,
      notes: event.notes,
      data: event.data,
      prevHash: event.prevHash,
      sequenceNumber: event.sequenceNumber,
    });
    if (recomputed !== event.hash) return false;

    expectedPrevHash = event.hash;
  }

  return true;
}
