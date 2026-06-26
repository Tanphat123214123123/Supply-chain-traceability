import {
  Actor,
  Anomaly,
  AnomalySeverity,
  Batch,
  ROLE_STAGE_PERMISSIONS,
  STAGE_ORDER,
  SupplyChainStage,
  TraceEvent,
} from '../domain/types';

export class AnomalyDetector {
  checkBeforeRecord(
    batch: Batch,
    stage: SupplyChainStage,
    actor: Actor,
    existingEvents: TraceEvent[],
  ): Anomaly[] {
    const anomalies: Anomaly[] = [];
    const now = new Date();

    if (batch.isRecalled) {
      anomalies.push(this.make('BATCH_RECALLED', 'CRITICAL', batch.id, undefined,
        `Batch ${batch.id} has been recalled: ${batch.recallReason ?? 'no reason given'}`, now));
    }

    const allowedStages = ROLE_STAGE_PERMISSIONS[actor.role];
    if (!allowedStages.includes(stage)) {
      anomalies.push(this.make('UNAUTHORIZED_STAGE', 'HIGH', batch.id, undefined,
        `Role ${actor.role} cannot record stage ${stage}`, now));
    }

    const recordedStages = existingEvents.map((e) => e.stage);

    if (recordedStages.includes(stage)) {
      anomalies.push(this.make('DUPLICATE_STAGE', 'MEDIUM', batch.id, undefined,
        `Stage ${stage} was already recorded for batch ${batch.id}`, now));
    }

    const stageIndex = STAGE_ORDER.indexOf(stage);
    const lastStage = recordedStages.length > 0 ? recordedStages[recordedStages.length - 1] : null;
    if (lastStage !== null) {
      const lastIndex = STAGE_ORDER.indexOf(lastStage);
      if (stageIndex < lastIndex) {
        anomalies.push(this.make('STAGE_OUT_OF_ORDER', 'HIGH', batch.id, undefined,
          `Stage ${stage} (pos ${stageIndex}) comes before current stage ${lastStage} (pos ${lastIndex})`, now));
      }
    }

    return anomalies;
  }

  analyzeChain(batch: Batch, events: TraceEvent[]): Anomaly[] {
    const anomalies: Anomaly[] = [];
    const now = new Date();
    const stagesSeen = new Set<SupplyChainStage>();
    let lastIndex = -1;

    for (const event of events) {
      if (stagesSeen.has(event.stage)) {
        anomalies.push(this.make('DUPLICATE_STAGE', 'MEDIUM', batch.id, event.id,
          `Duplicate stage ${event.stage} at sequence ${event.sequenceNumber}`, now));
      }

      const idx = STAGE_ORDER.indexOf(event.stage);
      if (idx < lastIndex) {
        anomalies.push(this.make('STAGE_OUT_OF_ORDER', 'HIGH', batch.id, event.id,
          `Stage ${event.stage} (pos ${idx}) appears after stage at pos ${lastIndex}`, now));
      }

      stagesSeen.add(event.stage);
      lastIndex = Math.max(lastIndex, idx);
    }

    return anomalies;
  }

  private make(
    type: Anomaly['type'],
    severity: AnomalySeverity,
    batchId: string,
    eventId: string | undefined,
    message: string,
    detectedAt: Date,
  ): Anomaly {
    return { type, severity, batchId, eventId, message, detectedAt };
  }
}
