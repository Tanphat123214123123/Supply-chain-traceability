import { SupplyChainStage, TraceEvent } from '../../domain/types';
import { IEventRepo } from '../interfaces';

export class InMemoryEventRepo implements IEventRepo {
  private readonly events: TraceEvent[] = [];

  async create(event: TraceEvent): Promise<TraceEvent> {
    this.events.push(event);
    return event;
  }

  async findByBatchId(batchId: string): Promise<TraceEvent[]> {
    return this.events
      .filter((e) => e.batchId === batchId)
      .sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  }

  async findByActorId(actorId: string): Promise<TraceEvent[]> {
    return this.events
      .filter((e) => e.actorId === actorId)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  async countAll(): Promise<number> {
    return this.events.length;
  }

  async lastEvent(batchId: string): Promise<Pick<TraceEvent, 'sequenceNumber' | 'hash'> | null> {
    const existing = await this.findByBatchId(batchId);
    return existing.length === 0 ? null : existing[existing.length - 1];
  }

  async countByStage(): Promise<Partial<Record<SupplyChainStage, number>>> {
    const counts: Partial<Record<SupplyChainStage, number>> = {};
    for (const event of this.events) {
      counts[event.stage] = (counts[event.stage] ?? 0) + 1;
    }
    return counts;
  }

  async countAllForBatchIds(batchIds: string[]): Promise<number> {
    const ids = new Set(batchIds);
    return this.events.filter((e) => ids.has(e.batchId)).length;
  }

  async countByStageForBatchIds(batchIds: string[]): Promise<Partial<Record<SupplyChainStage, number>>> {
    const ids = new Set(batchIds);
    const counts: Partial<Record<SupplyChainStage, number>> = {};
    for (const event of this.events) {
      if (!ids.has(event.batchId)) continue;
      counts[event.stage] = (counts[event.stage] ?? 0) + 1;
    }
    return counts;
  }

  /** Snapshot-only: dumps every record for persistence. */
  _dump(): TraceEvent[] {
    return [...this.events];
  }

  /** Snapshot-only: replaces all in-memory data with the given rows. */
  _load(rows: TraceEvent[]): void {
    this.events.length = 0;
    this.events.push(...rows);
  }
}
