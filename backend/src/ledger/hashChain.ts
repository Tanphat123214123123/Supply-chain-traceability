import { createHash, createHmac, randomBytes } from 'crypto';
import { EventKind, EventLink, PUBLIC_EVENT_FIELDS, SupplyChainStage, TraceEvent } from '../domain/types';
import { canonicalize } from './canonicalJson';

export const GENESIS_HASH = '0'.repeat(64);

/**
 * v1 — HMAC-SHA256 keyed with a server secret. Only the server can recompute
 *      it, so it can't be checked by a third party or anchored meaningfully.
 *      Still verified for events written before v2 existed.
 * v2 — SHA-256 over the RFC 8785 canonical JSON of the event plus a random
 *      per-event salt. Anyone holding the WHOLE event (and its salt) can
 *      recompute it — so verifying publicly means publishing everything.
 * v3 — per-field commitments (docs/SPEC_PHASE1.md §1.1): every field is
 *      committed with its own salt, the event hash covers the sorted
 *      commitments. A verifier can check the fields it is shown without the
 *      hidden ones ever leaving the tenant (selective disclosure).
 */
export type HashVersion = 1 | 2 | 3;
export const CURRENT_HASH_VERSION: HashVersion = 3;

export type HashableEvent = Pick<
  TraceEvent,
  'batchId' | 'stage' | 'actorId' | 'timestamp' | 'location' | 'notes' | 'data' | 'prevHash' | 'sequenceNumber'
> &
  Partial<Pick<TraceEvent, 'kind' | 'links'>>;

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function newEventSalt(): string {
  return randomBytes(32).toString('hex');
}

// ── v2 ──────────────────────────────────────────────────────────────────────

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
  return sha256Hex(eventPreimageV2(event, salt));
}

// ── v3: selective disclosure ────────────────────────────────────────────────

/** One committed field of a v3 event. `name` is "actorId" | "location" | "notes" | "data.<key>". */
export interface Claim {
  name: string;
  value: unknown;
}

/** The always-public skeleton of a v3 event (SPEC §1.1). */
export interface EnvelopeV3 {
  v: 3;
  batchId: string;
  sequenceNumber: number;
  prevHash: string;
  stage: SupplyChainStage;
  kind: EventKind;
  timestamp: string;
  links: EventLink[];
}

/** Fields present on the event, in a stable order. Empty notes / absent data keys produce no claim. */
export function eventClaims(event: HashableEvent): Claim[] {
  const claims: Claim[] = [
    { name: 'actorId', value: event.actorId },
    { name: 'location', value: event.location },
  ];
  if (event.notes) claims.push({ name: 'notes', value: event.notes });
  for (const key of Object.keys(event.data ?? {}).sort()) {
    const value = event.data[key];
    if (value !== undefined && value !== null) claims.push({ name: `data.${key}`, value });
  }
  return claims;
}

export function newClaimSalts(event: HashableEvent): Record<string, string> {
  return Object.fromEntries(eventClaims(event).map((c) => [c.name, newEventSalt()]));
}

export function claimCommitment(name: string, value: unknown, salt: string): string {
  return sha256Hex(canonicalize({ name, salt, value }));
}

/** Links are part of the hash, so their order must not depend on how the caller listed the inputs. */
export function sortLinks(links: EventLink[]): EventLink[] {
  return [...links].sort((a, b) => (a.lotId < b.lotId ? -1 : a.lotId > b.lotId ? 1 : 0));
}

export function envelopeV3(event: HashableEvent): EnvelopeV3 {
  return {
    v: 3,
    batchId: event.batchId,
    sequenceNumber: event.sequenceNumber,
    prevHash: event.prevHash,
    stage: event.stage,
    kind: event.kind ?? 'OBSERVE',
    timestamp: event.timestamp.toISOString(),
    links: sortLinks(event.links ?? []),
  };
}

export function hashFromCommitments(envelope: EnvelopeV3, commitments: string[]): string {
  return sha256Hex(canonicalize({ ...envelope, claims: [...commitments].sort() }));
}

export function computeEventHashV3(event: HashableEvent, claimSalts: Record<string, string>): string {
  const commitments = eventClaims(event).map((c) => {
    const salt = claimSalts[c.name];
    if (!salt) throw new Error(`hash v3: no salt for claim "${c.name}"`);
    return claimCommitment(c.name, c.value, salt);
  });
  return hashFromCommitments(envelopeV3(event), commitments);
}

/** Hash a new event the current way: fresh per-claim salts, v3 hash. */
export function sealEventV3(event: HashableEvent): { hash: string; claimSalts: Record<string, string> } {
  const claimSalts = newClaimSalts(event);
  return { hash: computeEventHashV3(event, claimSalts), claimSalts };
}

/** Claims shown on the public verification page (SPEC §1.1 table). */
export function publicClaimNames(stage: SupplyChainStage): Set<string> {
  return new Set(['location', ...PUBLIC_EVENT_FIELDS[stage].map((k) => `data.${k}`)]);
}

/** What a verifier receives for one v3 event: the envelope, some opened claims, the rest as bare commitments. */
export interface DisclosureV3 {
  envelope: EnvelopeV3;
  disclosed: Array<{ name: string; value: unknown; salt: string }>;
  hidden: string[];
}

export function discloseV3(event: HashableEvent, claimSalts: Record<string, string>, reveal: (name: string) => boolean): DisclosureV3 {
  const disclosed: DisclosureV3['disclosed'] = [];
  const hidden: string[] = [];
  for (const c of eventClaims(event)) {
    const salt = claimSalts[c.name];
    if (reveal(c.name)) disclosed.push({ name: c.name, value: c.value, salt });
    else hidden.push(claimCommitment(c.name, c.value, salt));
  }
  return { envelope: envelopeV3(event), disclosed, hidden: hidden.sort() };
}

/** Recomputes the event hash from a disclosure — what the browser does (frontend/src/lib/verify). */
export function hashOfDisclosure(d: DisclosureV3): string {
  const opened = d.disclosed.map((c) => claimCommitment(c.name, c.value, c.salt));
  return hashFromCommitments(d.envelope, [...opened, ...d.hidden]);
}

// ── v1 ──────────────────────────────────────────────────────────────────────

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

/** Recomputes a stored event's hash from its own data; null when that is impossible here. */
export function recomputeEventHash(event: TraceEvent, legacyKey?: string): string | null {
  switch (event.hashVersion) {
    case 3:
      try {
        return event.claimSalts ? computeEventHashV3(event, event.claimSalts) : null;
      } catch {
        return null; // a claim without its salt — the event was altered after it was written
      }
    case 2:
      return event.salt ? computeEventHashV2(event, event.salt) : null;
    default:
      return legacyKey ? computeEventHashV1(event, legacyKey) : null;
  }
}

// ── Chain verification ──────────────────────────────────────────────────────

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
  /** True for v2/v3 events: verifiable by anyone from the published event data alone. */
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
    if (event.hashVersion === 1) legacyEventCount += 1;
    const recomputedHash = recomputeEventHash(event, options.legacyKey);
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
      publiclyVerifiable: event.hashVersion !== 1,
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
