import { detectAnomalies } from '../src/services/anomalyDetector';
import { TraceEvent, SupplyChainStage } from '../src/domain/types';

let seq = 0;
function makeEvent(stage: SupplyChainStage, overrides: Partial<TraceEvent> = {}): TraceEvent {
  return {
    id: `evt-${seq}`,
    batchId: 'batch-1',
    stage,
    actorId: 'actor-1',
    timestamp: new Date(),
    location: 'Somewhere',
    data: {},
    hash: `hash-${seq}`,
    prevHash: `hash-${seq - 1}`,
    sequenceNumber: seq++,
    ...overrides,
  };
}

beforeEach(() => {
  seq = 0;
});

describe('detectAnomalies', () => {
  it('reports no anomalies for a correctly ordered chain', () => {
    const events = [
      makeEvent('HARVEST'),
      makeEvent('PROCESSING'),
      makeEvent('QUALITY_CHECK'),
      makeEvent('PACKAGING'),
      makeEvent('DISTRIBUTION'),
      makeEvent('RETAIL'),
    ];
    expect(detectAnomalies(events)).toHaveLength(0);
  });

  it('flags a duplicate stage', () => {
    const events = [makeEvent('HARVEST'), makeEvent('HARVEST')];
    const anomalies = detectAnomalies(events);
    expect(anomalies.some((a) => a.type === 'DUPLICATE_STAGE')).toBe(true);
  });

  it('flags a skipped stage', () => {
    const events = [makeEvent('HARVEST'), makeEvent('PACKAGING')];
    const anomalies = detectAnomalies(events);
    expect(anomalies.some((a) => a.type === 'STAGE_SKIPPED')).toBe(true);
  });

  it('flags an out-of-order stage', () => {
    const events = [makeEvent('PROCESSING'), makeEvent('HARVEST')];
    const anomalies = detectAnomalies(events);
    expect(anomalies.some((a) => a.type === 'OUT_OF_ORDER')).toBe(true);
  });

  it('returns no anomalies for an empty event list', () => {
    expect(detectAnomalies([])).toHaveLength(0);
  });

  it('tags each anomaly with the batchId and eventId', () => {
    const events = [makeEvent('HARVEST'), makeEvent('HARVEST')];
    const [anomaly] = detectAnomalies(events);
    expect(anomaly.batchId).toBe('batch-1');
    expect(anomaly.eventId).toBe(events[1].id);
  });
});
