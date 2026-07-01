import { Anomaly, STAGE_ORDER, TraceEvent } from '../domain/types';

/**
 * Anomalies are derived on demand from a batch's event history rather than
 * stored — recomputing from the (immutable, hash-verified) events is always
 * consistent and needs no extra persistence layer.
 */
export function detectAnomalies(events: TraceEvent[]): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const seenStages = new Set<string>();
  let highestStageIndex = -1;

  for (const event of events) {
    const stageIndex = STAGE_ORDER.indexOf(event.stage);

    if (seenStages.has(event.stage)) {
      anomalies.push({
        type: 'DUPLICATE_STAGE',
        severity: 'MEDIUM',
        message: `Khâu "${event.stage}" đã được ghi nhận nhiều lần cho lô hàng này`,
        batchId: event.batchId,
        eventId: event.id,
        detectedAt: event.timestamp,
      });
    }
    seenStages.add(event.stage);

    if (stageIndex < highestStageIndex) {
      anomalies.push({
        type: 'OUT_OF_ORDER',
        severity: 'HIGH',
        message: `Khâu "${event.stage}" được ghi sau khâu có thứ tự cao hơn — sai thứ tự chuỗi cung ứng`,
        batchId: event.batchId,
        eventId: event.id,
        detectedAt: event.timestamp,
      });
    } else if (stageIndex > highestStageIndex + 1) {
      const skipped = STAGE_ORDER.slice(highestStageIndex + 1, stageIndex);
      anomalies.push({
        type: 'STAGE_SKIPPED',
        severity: 'HIGH',
        message: `Bỏ qua khâu ${skipped.join(', ')} trước khi ghi "${event.stage}"`,
        batchId: event.batchId,
        eventId: event.id,
        detectedAt: event.timestamp,
      });
    }

    if (stageIndex > highestStageIndex) highestStageIndex = stageIndex;
  }

  return anomalies;
}
