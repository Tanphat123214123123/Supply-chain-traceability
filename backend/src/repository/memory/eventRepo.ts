import { TraceEvent } from '../../domain/types';
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

  async countAll(): Promise<number> {
    return this.events.length;
  }

  async lastEvent(batchId: string): Promise<Pick<TraceEvent, 'sequenceNumber' | 'hash'> | null> {
    const existing = await this.findByBatchId(batchId);
    return existing.length === 0 ? null : existing[existing.length - 1];
  }
}
