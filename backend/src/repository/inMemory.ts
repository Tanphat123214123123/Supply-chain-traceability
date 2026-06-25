import { Actor, Batch, TraceEvent } from '../domain/types';
import { IActorRepo, IBatchRepo, IEventRepo } from './interfaces';

export class InMemoryBatchRepo implements IBatchRepo {
  private store = new Map<string, Batch>();

  async create(batch: Batch): Promise<Batch> {
    this.store.set(batch.id, { ...batch });
    return batch;
  }

  async findById(id: string): Promise<Batch | null> {
    return this.store.get(id) ?? null;
  }

  async findAll(): Promise<Batch[]> {
    return Array.from(this.store.values());
  }

  async update(id: string, updates: Partial<Batch>): Promise<Batch | null> {
    const existing = this.store.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.store.set(id, updated);
    return updated;
  }
}

export class InMemoryActorRepo implements IActorRepo {
  private store = new Map<string, Actor>();
  private emailIndex = new Map<string, string>();

  async create(actor: Actor): Promise<Actor> {
    this.store.set(actor.id, { ...actor });
    this.emailIndex.set(actor.email, actor.id);
    return actor;
  }

  async findById(id: string): Promise<Actor | null> {
    return this.store.get(id) ?? null;
  }

  async findByEmail(email: string): Promise<Actor | null> {
    const id = this.emailIndex.get(email);
    if (!id) return null;
    return this.store.get(id) ?? null;
  }

  async findAll(): Promise<Actor[]> {
    return Array.from(this.store.values());
  }

  async update(id: string, updates: Partial<Actor>): Promise<Actor | null> {
    const existing = this.store.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.store.set(id, updated);
    if (updates.email && updates.email !== existing.email) {
      this.emailIndex.delete(existing.email);
      this.emailIndex.set(updates.email, id);
    }
    return updated;
  }
}

export class InMemoryEventRepo implements IEventRepo {
  private store = new Map<string, TraceEvent>();
  private batchIndex = new Map<string, Set<string>>();

  async create(event: TraceEvent): Promise<TraceEvent> {
    this.store.set(event.id, { ...event });
    if (!this.batchIndex.has(event.batchId)) {
      this.batchIndex.set(event.batchId, new Set());
    }
    this.batchIndex.get(event.batchId)!.add(event.id);
    return event;
  }

  async findByBatchId(batchId: string): Promise<TraceEvent[]> {
    const ids = this.batchIndex.get(batchId);
    if (!ids) return [];
    return Array.from(ids)
      .map((id) => this.store.get(id)!)
      .filter(Boolean)
      .sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  }

  async findById(id: string): Promise<TraceEvent | null> {
    return this.store.get(id) ?? null;
  }

  async findLastByBatchId(batchId: string): Promise<TraceEvent | null> {
    const events = await this.findByBatchId(batchId);
    return events.length > 0 ? events[events.length - 1] : null;
  }

  async countByBatchId(batchId: string): Promise<number> {
    return this.batchIndex.get(batchId)?.size ?? 0;
  }
}
