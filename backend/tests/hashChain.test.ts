import { computeEventHash, GENESIS_HASH, verifyChain } from '../src/ledger/hashChain';
import { SupplyChainStage, TraceEvent } from '../src/domain/types';

function makeEvent(overrides: Partial<TraceEvent> = {}): TraceEvent {
  const base: Omit<TraceEvent, 'hash'> = {
    id: 'evt-1',
    batchId: 'batch-1',
    stage: SupplyChainStage.HARVEST,
    actorId: 'actor-1',
    timestamp: new Date('2024-01-01T00:00:00Z'),
    location: 'Farm',
    data: {},
    prevHash: GENESIS_HASH,
    sequenceNumber: 0,
  };
  return { ...base, hash: computeEventHash(base), ...overrides };
}

describe('computeEventHash', () => {
  test('returns a 64-char lowercase hex string', () => {
    const { hash, ...rest } = makeEvent();
    const h = computeEventHash(rest);
    expect(h).toHaveLength(64);
    expect(h).toMatch(/^[0-9a-f]+$/);
  });

  test('is deterministic for the same input', () => {
    const { hash, ...rest } = makeEvent();
    expect(computeEventHash(rest)).toBe(computeEventHash(rest));
  });

  test('changes when any field changes', () => {
    const e = makeEvent();
    const { hash: _h, ...rest } = e;
    const original = computeEventHash(rest);
    expect(computeEventHash({ ...rest, location: 'Other Place' })).not.toBe(original);
    expect(computeEventHash({ ...rest, sequenceNumber: 1 })).not.toBe(original);
  });
});

describe('verifyChain', () => {
  test('empty array is valid', () => {
    expect(verifyChain([])).toEqual({ valid: true });
  });

  test('single correct event is valid', () => {
    expect(verifyChain([makeEvent()])).toEqual({ valid: true });
  });

  test('two correctly linked events are valid', () => {
    const e1 = makeEvent();
    const e2Base: Omit<TraceEvent, 'hash'> = {
      id: 'evt-2',
      batchId: 'batch-1',
      stage: SupplyChainStage.PROCESSING,
      actorId: 'actor-2',
      timestamp: new Date('2024-01-02T00:00:00Z'),
      location: 'Factory',
      data: {},
      prevHash: e1.hash,
      sequenceNumber: 1,
    };
    const e2: TraceEvent = { ...e2Base, hash: computeEventHash(e2Base) };
    expect(verifyChain([e1, e2])).toEqual({ valid: true });
  });

  test('detects a tampered hash', () => {
    const event = makeEvent({ hash: 'deadbeef' + '0'.repeat(56) });
    const result = verifyChain([event]);
    expect(result.valid).toBe(false);
    expect(result.tamperedAt).toBe(0);
  });

  test('detects a broken prevHash link', () => {
    const e1 = makeEvent();
    const e2Base: Omit<TraceEvent, 'hash'> = {
      id: 'evt-2',
      batchId: 'batch-1',
      stage: SupplyChainStage.PROCESSING,
      actorId: 'actor-2',
      timestamp: new Date('2024-01-02T00:00:00Z'),
      location: 'Factory',
      data: {},
      prevHash: 'wrong_prev_hash',
      sequenceNumber: 1,
    };
    const e2: TraceEvent = { ...e2Base, hash: computeEventHash(e2Base) };
    expect(verifyChain([e1, e2]).valid).toBe(false);
  });

  test('input order does not matter — events are sorted by sequenceNumber', () => {
    const e1 = makeEvent();
    const e2Base: Omit<TraceEvent, 'hash'> = {
      id: 'evt-2', batchId: 'batch-1', stage: SupplyChainStage.PROCESSING,
      actorId: 'actor-2', timestamp: new Date(), location: 'Factory',
      data: {}, prevHash: e1.hash, sequenceNumber: 1,
    };
    const e2: TraceEvent = { ...e2Base, hash: computeEventHash(e2Base) };
    expect(verifyChain([e2, e1])).toEqual({ valid: true });
  });
});
