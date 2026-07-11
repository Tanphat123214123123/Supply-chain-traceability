import { createHmac } from 'crypto';
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

/**
 * HMAC-keyed rather than a plain hash: recomputing a valid hash for a tampered
 * row requires knowing `signingKey`, which lives only in server config/env —
 * never in the database itself. A plain SHA-256 would let anyone with direct
 * DB write access (leaked credentials, insider, SQLi elsewhere) edit a row and
 * transparently recompute all downstream hashes so `verifyChain` still passes.
 */
export function computeEventHash(event: UnhashedEvent, signingKey: string): string {
  return createHmac('sha256', signingKey).update(canonicalPayload(event)).digest('hex');
}

export function verifyChain(events: TraceEvent[], signingKey: string): boolean {
  return verifyChainDetailed(events, signingKey).valid;
}

export interface ChainVerification {
  valid: boolean;
  /** Index (within the given event array) of the first event that fails verification, if any. */
  brokenAtIndex?: number;
  perEvent: Array<{ eventId: string; recomputedHash: string; matchesStoredHash: boolean; linksToPrevious: boolean }>;
}

/** Same check as `verifyChain`, but reports exactly which event (if any) breaks the chain — for audit/verifier tooling. */
export function verifyChainDetailed(events: TraceEvent[], signingKey: string): ChainVerification {
  let expectedPrevHash = GENESIS_HASH;
  let brokenAtIndex: number | undefined;
  const perEvent: ChainVerification['perEvent'] = [];

  events.forEach((event, index) => {
    const linksToPrevious = event.prevHash === expectedPrevHash;
    const recomputedHash = computeEventHash(
      {
        batchId: event.batchId,
        stage: event.stage,
        actorId: event.actorId,
        timestamp: event.timestamp,
        location: event.location,
        notes: event.notes,
        data: event.data,
        prevHash: event.prevHash,
        sequenceNumber: event.sequenceNumber,
      },
      signingKey,
    );
    const matchesStoredHash = recomputedHash === event.hash;

    if (brokenAtIndex === undefined && (!linksToPrevious || !matchesStoredHash)) {
      brokenAtIndex = index;
    }
    perEvent.push({ eventId: event.id, recomputedHash, matchesStoredHash, linksToPrevious });
    expectedPrevHash = event.hash;
  });

  return { valid: brokenAtIndex === undefined, brokenAtIndex, perEvent };
}
