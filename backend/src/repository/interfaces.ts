import { Actor, Batch, TraceEvent } from '../domain/types';

export interface IActorRepo {
  create(actor: Actor): Promise<Actor>;
  findById(id: string): Promise<Actor | null>;
  findByEmail(email: string): Promise<Actor | null>;
}

export interface IBatchRepo {
  create(batch: Batch): Promise<Batch>;
  findById(id: string): Promise<Batch | null>;
  findAll(): Promise<Batch[]>;
  update(batch: Batch): Promise<Batch>;
}

export interface IEventRepo {
  create(event: TraceEvent): Promise<TraceEvent>;
  findByBatchId(batchId: string): Promise<TraceEvent[]>;
  countAll(): Promise<number>;
  /** The most recently recorded event for a batch, or null if it has none yet. */
  lastEvent(batchId: string): Promise<Pick<TraceEvent, 'sequenceNumber' | 'hash'> | null>;
}
