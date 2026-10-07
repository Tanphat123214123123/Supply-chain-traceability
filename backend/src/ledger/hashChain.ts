import { createHash, createHmac, randomBytes } from 'crypto';
import { TraceEvent } from '../domain/types';
import { canonicalize } from './canonicalJson';

export const GENESIS_HASH = '0'.repeat(64);

/**
 * v1 — HMAC-SHA256 keyed with a server secret. Only the server can recompute
 *      it, so it can't be checked by a third party or anchored meaningfully.
 *      Still verified for events written before v2 existed.
 * v2 — SHA-256 over the RFC 8785 canonical JSON of the event plus a random
 *      per-event salt. Anyone holding the event (and its salt) can recompute
 *      it; the salt stops someone who only sees the hash (e.g. once anchored
 *      on a public chain) from brute-forcing low-entropy fields like a
 *      quantity or a stage name.
 */
export type HashVersion = 1 | 2;
export const CURRENT_HASH_VERSION: HashVersion = 2;

export type HashableEvent = Pick<
  TraceEvent,
  'batchId' | 'stage' | 'actorId' | 'timestamp' | 'location' | 'notes' | 'data' | 'prevHash' | 'sequenceNumber'
>;

export function newEventSalt(): string {
  return randomBytes(32).toString('hex');
}

/**
 * The exact byte string hashed for a v2 event. Specified field-by-field in
 * docs/DATABASE.md so an external verifier can rebuild it independently.
 */
export function eventPreimageV2(event: HashableEvent, salt: string): string {
  return canonicalize({
    v: 2,
    salt,
    batchId: event.batchId,
    sequenceNumber: event.sequenceNumber,
    prevHash: event.prevHash,
    stage: event.stage,
    actorId: event.actorId,
    timestamp: event.timestamp.toISOString(),
    location: event.location,
    notes: event.notes ?? null,
    data: event.data ?? {},
  });
}

export function computeEventHashV2(event: HashableEvent, salt: string): string {
  return createHash('sha256').update(eventPreimageV2(event, salt), 'utf8').digest('hex');
}

/** v1 preimage, byte-for-byte what was signed before v2 — must never change. */
function legacyPayloadV1(event: HashableEvent): string {
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

export function computeEventHashV1(event: HashableEvent, signingKey: string): string {
  return createHmac('sha256', signingKey).update(legacyPayloadV1(event)).digest('hex');
}

/** What the database records as the head of a batch's chain (batches.head_hash / event_count). */
export interface ChainHead {
  hash: string;
  eventCount: number;
}

export type ChainProblem = 'TAMPERED_EVENT' | 'BROKEN_LINK' | 'HEAD_MISMATCH' | 'UNVERIFIABLE_LEGACY';

export interface EventCheck {
  eventId: string;
  sequenceNumber: number;
  hashVersion: HashVersion;
  /** null when the hash can't be recomputed here (a v1 event and no legacy key configured). */
  recomputedHash: string | null;
  matchesStoredHash: boolean;
  linksToPrevious: boolean;
  /** True for v2 events: verifiable by anyone from the published event data alone. */
  publiclyVerifiable: boolean;
}

export interface ChainVerification {
  valid: boolean;
  /** Index (within the given event array) of the first event that fails verification, if any. */
  brokenAtIndex?: number;
  /** The first problem found, if any. */
  problem?: ChainProblem;
  /** Whether the chain ends exactly at the head the database recorded; null if no head was supplied. */
  headMatches: boolean | null;
  legacyEventCount: number;
  perEvent: EventCheck[];
}

export interface VerifyOptions {
  /** Key for recomputing v1 (HMAC) events. Without it, v1 events are reported as unverifiable. */
  legacyKey?: string;
  /**
   * The recorded chain head. Supplying it catches truncation: deleting the
   * last N events leaves a chain that still links perfectly — only the head
   * comparison reveals that it's shorter than what was written.
   */
  head?: ChainHead;
}

export function verifyChainDetailed(events: TraceEvent[], options: VerifyOptions = {}): ChainVerification {
  let expectedPrevHash = GENESIS_HASH;
  let brokenAtIndex: number | undefined;
  let problem: ChainProblem | undefined;
  let legacyEventCount = 0;
  const perEvent: EventCheck[] = [];

  events.forEach((event, index) => {
    const linksToPrevious = event.prevHash === expectedPrevHash && event.sequenceNumber === index;

    let recomputedHash: string | null;
    if (event.hashVersion === 2) {
      recomputedHash = event.salt ? computeEventHashV2(event, event.salt) : null;
    } else {
      legacyEventCount += 1;
      recomputedHash = options.legacyKey ? computeEventHashV1(event, options.legacyKey) : null;
    }
    const matchesStoredHash = recomputedHash !== null && recomputedHash === event.hash;

    if (brokenAtIndex === undefined) {
      if (!linksToPrevious) {
        brokenAtIndex = index;
        problem = 'BROKEN_LINK';
      } else if (!matchesStoredHash) {
        brokenAtIndex = index;
        problem = recomputedHash === null && event.hashVersion === 1 ? 'UNVERIFIABLE_LEGACY' : 'TAMPERED_EVENT';
      }
    }

    perEvent.push({
      eventId: event.id,
      sequenceNumber: event.sequenceNumber,
      hashVersion: event.hashVersion,
      recomputedHash,
      matchesStoredHash,
      linksToPrevious,
      publiclyVerifiable: event.hashVersion === 2,
    });
    expectedPrevHash = event.hash;
  });

  let headMatches: boolean | null = null;
  if (options.head) {
    headMatches = options.head.eventCount === events.length && options.head.hash === expectedPrevHash;
    if (!headMatches && problem === undefined) problem = 'HEAD_MISMATCH';
  }

  return { valid: problem === undefined, brokenAtIndex, problem, headMatches, legacyEventCount, perEvent };
}

export function verifyChain(events: TraceEvent[], options: VerifyOptions = {}): boolean {
  return verifyChainDetailed(events, options).valid;
}
