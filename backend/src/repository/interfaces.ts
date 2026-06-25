import { Actor, Batch, TraceEvent } from '../domain/types';

export interface IBatchRepo {
  create(batch: Batch): Promise<Batch>;
  findById(id: string): Promise<Batch | null>;
  findAll(): Promise<Batch[]>;
  update(id: string, updates: Partial<Batch>): Promise<Batch | null>;
}

export interface IActorRepo {
  create(actor: Actor): Promise<Actor>;
  findById(id: string): Promise<Actor | null>;
  findByEmail(email: string): Promise<Actor | null>;
  findAll(): Promise<Actor[]>;
  update(id: string, updates: Partial<Actor>): Promise<Actor | null>;
}

export interface IEventRepo {
  create(event: TraceEvent): Promise<TraceEvent>;
  findByBatchId(batchId: string): Promise<TraceEvent[]>;
  findById(id: string): Promise<TraceEvent | null>;
  findLastByBatchId(batchId: string): Promise<TraceEvent | null>;
  countByBatchId(batchId: string): Promise<number>;
}
