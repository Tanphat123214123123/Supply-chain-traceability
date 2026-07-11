import { computeEventHash, GENESIS_HASH, verifyChain } from '../src/ledger/hashChain';
import { TraceEvent } from '../src/domain/types';

const KEY = 'test-signing-key';
const OTHER_KEY = 'a-different-signing-key';

function makeEvent(overrides: Partial<TraceEvent> = {}): TraceEvent {
  const base = {
    id: 'evt-1',
    batchId: 'batch-1',
    stage: 'HARVEST' as const,
    actorId: 'actor-1',
    timestamp: new Date('2026-01-01T00:00:00.000Z'),
    location: 'Đà Lạt',
    notes: undefined,
    data: {},
    prevHash: GENESIS_HASH,
    sequenceNumber: 0,
  };
  const merged = { ...base, ...overrides };
  return { ...merged, hash: computeEventHash(merged, KEY) };
}

describe('hashChain', () => {
  it('computes a 64-char hex hash', () => {
    const event = makeEvent();
    expect(event.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for identical input', () => {
    const a = makeEvent();
    const b = makeEvent();
    expect(a.hash).toBe(b.hash);
  });

  it('changes when any field changes', () => {
    const a = makeEvent();
    const b = makeEvent({ location: 'Nha Trang' });
    expect(a.hash).not.toBe(b.hash);
  });

  it('changes when the signing key changes (same content)', () => {
    const base = {
      batchId: 'batch-1',
      stage: 'HARVEST' as const,
      actorId: 'actor-1',
      timestamp: new Date('2026-01-01T00:00:00.000Z'),
      location: 'Đà Lạt',
      notes: undefined,
      data: {},
      prevHash: GENESIS_HASH,
      sequenceNumber: 0,
    };
    expect(computeEventHash(base, KEY)).not.toBe(computeEventHash(base, OTHER_KEY));
  });

  it('verifies a valid single-event chain', () => {
    const event = makeEvent();
    expect(verifyChain([event], KEY)).toBe(true);
  });

  it('verifies a valid multi-event chain', () => {
    const first = makeEvent({ id: 'e1', sequenceNumber: 0, prevHash: GENESIS_HASH });
    const second = makeEvent({ id: 'e2', stage: 'PROCESSING', sequenceNumber: 1, prevHash: first.hash });
    expect(verifyChain([first, second], KEY)).toBe(true);
  });

  it('rejects a chain with a tampered field', () => {
    const first = makeEvent({ id: 'e1', sequenceNumber: 0, prevHash: GENESIS_HASH });
    const second = makeEvent({ id: 'e2', stage: 'PROCESSING', sequenceNumber: 1, prevHash: first.hash });
    const tamperedFirst = { ...first, location: 'HACKED' };
    expect(verifyChain([tamperedFirst, second], KEY)).toBe(false);
  });

  it('rejects a chain with a broken prevHash link', () => {
    const first = makeEvent({ id: 'e1', sequenceNumber: 0, prevHash: GENESIS_HASH });
    const second = makeEvent({ id: 'e2', stage: 'PROCESSING', sequenceNumber: 1, prevHash: 'f'.repeat(64) });
    expect(verifyChain([first, second], KEY)).toBe(false);
  });

  it('rejects a chain that does not start from GENESIS_HASH', () => {
    const first = makeEvent({ id: 'e1', sequenceNumber: 0, prevHash: 'a'.repeat(64) });
    expect(verifyChain([first], KEY)).toBe(false);
  });

  it('rejects a tampered chain re-signed with the wrong key (recomputing hashes alone is not enough)', () => {
    const event = makeEvent();
    expect(verifyChain([event], OTHER_KEY)).toBe(false);
  });

  it('treats an empty chain as valid', () => {
    expect(verifyChain([], KEY)).toBe(true);
  });
});
