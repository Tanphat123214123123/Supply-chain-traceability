import { Batch } from '../../domain/types';
import { IBatchRepo } from '../interfaces';

export class InMemoryBatchRepo implements IBatchRepo {
  private readonly batches = new Map<string, Batch>();

  async create(batch: Batch): Promise<Batch> {
    this.batches.set(batch.id, batch);
    return batch;
  }

  async findById(id: string): Promise<Batch | null> {
    return this.batches.get(id) ?? null;
  }

  async findAll(): Promise<Batch[]> {
    return [...this.batches.values()].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }

  async update(batch: Batch): Promise<Batch> {
    this.batches.set(batch.id, batch);
    return batch;
  }
}
