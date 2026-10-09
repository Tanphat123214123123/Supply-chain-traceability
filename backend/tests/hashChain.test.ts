import { createHash, createHmac } from 'crypto';
import { TraceEvent } from '../src/domain/types';
import {
  computeEventHashV1,
  computeEventHashV2,
  eventPreimageV2,
  GENESIS_HASH,
  HashableEvent,
  newEventSalt,
  verifyChain,
  verifyChainDetailed,
} from '../src/ledger/hashChain';

const LEGACY_KEY = 'legacy-key';
const SALT = 'ab'.repeat(32);

function base(overrides: Partial<HashableEvent> = {}): HashableEvent {
  return {
    batchId: '6f1c1f9e-2a8d-4a43-9d3f-6f0b1f2a3c4d',
    stage: 'HARVEST',
    actorId: '0d6c3a51-9b1e-4a11-8f5a-1c2d3e4f5a6b',
    timestamp: new Date('2026-01-01T00:00:00.000Z'),
    location: 'Đà Lạt',
    notes: undefined,
    data: {},
    prevHash: GENESIS_HASH,
    sequenceNumber: 0,
    ...overrides,
  };
}

function v2Event(id: string, overrides: Partial<HashableEvent> = {}, salt = newEventSalt()): TraceEvent {
  const unhashed = base(overrides);
  return { ...unhashed, id, tenantId: 'tenant', hashVersion: 2, salt, hash: computeEventHashV2(unhashed, salt), kind: 'OBSERVE', links: [] };
}

function v1Event(id: string, overrides: Partial<HashableEvent> = {}): TraceEvent {
  const unhashed = base(overrides);
  return { ...unhashed, id, tenantId: 'tenant', hashVersion: 1, hash: computeEventHashV1(unhashed, LEGACY_KEY), kind: 'OBSERVE', links: [] };
}

/** A valid v2 chain of `n` events. */
function chain(n: number): TraceEvent[] {
  const stages = ['HARVEST', 'PROCESSING', 'QUALITY_CHECK', 'PACKAGING', 'DISTRIBUTION', 'RETAIL'] as const;
  const events: TraceEvent[] = [];
  for (let i = 0; i < n; i++) {
    events.push(
      v2Event(`e${i}`, { stage: stages[i % 6], sequenceNumber: i, prevHash: i === 0 ? GENESIS_HASH : events[i - 1].hash }),
    );
  }
  return events;
}

describe('hash v2 (public, salted SHA-256 over RFC 8785 JSON)', () => {
  it('pins the exact preimage format — changing it breaks every anchored proof', () => {
    expect(eventPreimageV2(base({ notes: 'ẩm 11.5%', data: { b: 2, a: [1, 'x'] } }), SALT)).toBe(
      `{"actorId":"0d6c3a51-9b1e-4a11-8f5a-1c2d3e4f5a6b","batchId":"6f1c1f9e-2a8d-4a43-9d3f-6f0b1f2a3c4d",` +
        `"data":{"a":[1,"x"],"b":2},"location":"Đà Lạt","notes":"ẩm 11.5%","prevHash":"${GENESIS_HASH}",` +
        `"salt":"${SALT}","sequenceNumber":0,"stage":"HARVEST","timestamp":"2026-01-01T00:00:00.000Z","v":2}`,
    );
  });

  it('is plain SHA-256 of that preimage — recomputable with no server secret', () => {
    const event = base();
    const expected = createHash('sha256').update(eventPreimageV2(event, SALT), 'utf8').digest('hex');
    expect(computeEventHashV2(event, SALT)).toBe(expected);
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not depend on the key order of event.data', () => {
    expect(computeEventHashV2(base({ data: { x: 1, y: 2 } }), SALT)).toBe(computeEventHashV2(base({ data: { y: 2, x: 1 } }), SALT));
  });

  it('changes with the salt, so equal events cannot be correlated by hash alone', () => {
    expect(computeEventHashV2(base(), SALT)).not.toBe(computeEventHashV2(base(), 'cd'.repeat(32)));
    expect(newEventSalt()).toMatch(/^[0-9a-f]{64}$/);
    expect(newEventSalt()).not.toBe(newEventSalt());
  });

  it('changes when any hashed field changes', () => {
    const reference = computeEventHashV2(base(), SALT);
    const variants: Partial<HashableEvent>[] = [
      { location: 'Nha Trang' },
      { stage: 'PROCESSING' },
      { sequenceNumber: 1 },
      { prevHash: 'f'.repeat(64) },
      { notes: 'x' },
      { data: { a: 1 } },
      { timestamp: new Date('2026-01-01T00:00:00.001Z') },
    ];
    for (const v of variants) expect(computeEventHashV2(base(v), SALT)).not.toBe(reference);
  });
});

describe('verifyChainDetailed', () => {
  it('accepts a valid v2 chain without any key', () => {
    const result = verifyChainDetailed(chain(3));
    expect(result.valid).toBe(true);
    expect(result.perEvent.every((p) => p.publiclyVerifiable && p.matchesStoredHash && p.linksToPrevious)).toBe(true);
  });

  it('treats an empty chain as valid', () => {
    expect(verifyChain([])).toBe(true);
    expect(verifyChain([], { head: { hash: GENESIS_HASH, eventCount: 0 } })).toBe(true);
  });

  it('detects an edited field and points at the event', () => {
    const events = chain(3);
    events[1] = { ...events[1], location: 'HACKED' };
    const result = verifyChainDetailed(events);
    expect(result).toMatchObject({ valid: false, brokenAtIndex: 1, problem: 'TAMPERED_EVENT' });
  });

  it('detects a broken prevHash link', () => {
    const events = chain(2);
    events[1] = { ...events[1], prevHash: 'f'.repeat(64) };
    expect(verifyChainDetailed(events)).toMatchObject({ valid: false, brokenAtIndex: 1, problem: 'BROKEN_LINK' });
  });

  it('detects an event removed from the middle', () => {
    const events = chain(3);
    expect(verifyChainDetailed([events[0], events[2]])).toMatchObject({ valid: false, brokenAtIndex: 1, problem: 'BROKEN_LINK' });
  });

  it('detects a chain that does not start from genesis', () => {
    const [first] = chain(1);
    expect(verifyChain([{ ...first, prevHash: 'a'.repeat(64) }])).toBe(false);
  });

  it('detects a truncated tail ONLY through the recorded head', () => {
    const events = chain(3);
    const head = { hash: events[2].hash, eventCount: 3 };
    const truncated = events.slice(0, 2);

    // The remaining prefix is internally perfect...
    expect(verifyChain(truncated)).toBe(true);
    // ...which is exactly why the head comparison exists.
    expect(verifyChainDetailed(truncated, { head })).toMatchObject({ valid: false, problem: 'HEAD_MISMATCH', headMatches: false });
    expect(verifyChainDetailed(events, { head })).toMatchObject({ valid: true, headMatches: true });
  });

  it('verifies legacy v1 (HMAC) events only with the legacy key', () => {
    const first = v1Event('e0');
    const second = v2Event('e1', { stage: 'PROCESSING', sequenceNumber: 1, prevHash: first.hash });
    const mixed = [first, second];

    expect(verifyChainDetailed(mixed, { legacyKey: LEGACY_KEY })).toMatchObject({ valid: true, legacyEventCount: 1 });
    expect(verifyChainDetailed(mixed, { legacyKey: 'wrong-key' })).toMatchObject({ valid: false, problem: 'TAMPERED_EVENT' });

    const noKey = verifyChainDetailed(mixed);
    expect(noKey).toMatchObject({ valid: false, brokenAtIndex: 0, problem: 'UNVERIFIABLE_LEGACY' });
    expect(noKey.perEvent[0]).toMatchObject({ recomputedHash: null, publiclyVerifiable: false });
  });

  it('keeps the v1 preimage byte-for-byte what the pre-v2 code signed (legacy rows must stay verifiable)', () => {
    // Independent re-statement of the original algorithm: HMAC over JSON.stringify
    // with exactly this key order. If computeEventHashV1 ever drifts, every stored v1 event breaks.
    const e = base({ notes: 'n', data: { k: 'v' } });
    const original = createHmac('sha256', LEGACY_KEY)
      .update(
        JSON.stringify({
          batchId: e.batchId,
          stage: e.stage,
          actorId: e.actorId,
          timestamp: e.timestamp.toISOString(),
          location: e.location,
          notes: e.notes ?? null,
          data: e.data ?? {},
          prevHash: e.prevHash,
          sequenceNumber: e.sequenceNumber,
        }),
      )
      .digest('hex');
    expect(computeEventHashV1(e, LEGACY_KEY)).toBe(original);
  });

  it('rejects a v2 event whose salt is missing', () => {
    const [event] = chain(1);
    expect(verifyChainDetailed([{ ...event, salt: undefined }])).toMatchObject({ valid: false, problem: 'TAMPERED_EVENT' });
  });
});
