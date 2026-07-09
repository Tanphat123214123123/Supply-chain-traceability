import { v4 as uuidv4 } from 'uuid';
import { Anomaly, STAGE_ORDER, TraceEvent } from '../domain/types';

/** A detected anomaly before it's attached to a tenant — this module is a pure scan over events with no tenant context of its own; the caller stamps `tenantId` (from the batch) at persistence time. */
export type DetectedAnomaly = Omit<Anomaly, 'tenantId'>;

/**
 * Anomalies are derived from a batch's event history. Callers may run this
 * over the full history (read paths) or incrementally against just the
 * latest event (write path, to decide what to persist) since the function
 * is a pure, deterministic scan.
 */
export function detectAnomalies(events: TraceEvent[]): DetectedAnomaly[] {
  const anomalies: DetectedAnomaly[] = [];
  const seenStages = new Set<string>();
  let highestStageIndex = -1;

  for (const event of events) {
    const stageIndex = STAGE_ORDER.indexOf(event.stage);

    if (seenStages.has(event.stage)) {
      anomalies.push({
        id: uuidv4(),
        type: 'DUPLICATE_STAGE',
        severity: 'MEDIUM',
        message: `Khâu "${event.stage}" đã được ghi nhận nhiều lần cho lô hàng này`,
        batchId: event.batchId,
        eventId: event.id,
        detectedAt: event.timestamp,
        resolved: false,
      });
    }
    seenStages.add(event.stage);

    if (stageIndex < highestStageIndex) {
      anomalies.push({
        id: uuidv4(),
        type: 'OUT_OF_ORDER',
        severity: 'HIGH',
        message: `Khâu "${event.stage}" được ghi sau khâu có thứ tự cao hơn — sai thứ tự chuỗi cung ứng`,
        batchId: event.batchId,
        eventId: event.id,
        detectedAt: event.timestamp,
        resolved: false,
      });
    } else if (stageIndex > highestStageIndex + 1) {
      const skipped = STAGE_ORDER.slice(highestStageIndex + 1, stageIndex);
      anomalies.push({
        id: uuidv4(),
        type: 'STAGE_SKIPPED',
        severity: 'HIGH',
        message: `Bỏ qua khâu ${skipped.join(', ')} trước khi ghi "${event.stage}"`,
        batchId: event.batchId,
        eventId: event.id,
        detectedAt: event.timestamp,
        resolved: false,
      });
    }

    if (stageIndex > highestStageIndex) highestStageIndex = stageIndex;
  }

  return anomalies;
}

/** Anomalies introduced specifically by the newest event (last in `events`), for persistence at write time. */
export function detectNewAnomalies(events: TraceEvent[]): DetectedAnomaly[] {
  if (events.length === 0) return [];
  const newEvent = events[events.length - 1];
  return detectAnomalies(events).filter((a) => a.eventId === newEvent.id);
}
