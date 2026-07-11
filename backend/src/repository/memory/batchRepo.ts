import { Batch, BatchListQuery, PaginatedResult } from '../../domain/types';
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

  async findAllByTenant(tenantId: string): Promise<Batch[]> {
    return (await this.findAll()).filter((b) => b.tenantId === tenantId);
  }

  async findPageByTenant(tenantId: string, { page, pageSize, search }: BatchListQuery): Promise<PaginatedResult<Batch>> {
    let all = await this.findAllByTenant(tenantId);
    if (search) {
      const needle = search.toLowerCase();
      all = all.filter(
        (b) =>
          b.productName.toLowerCase().includes(needle) ||
          b.origin.toLowerCase().includes(needle) ||
          b.id.startsWith(search),
      );
    }
    const start = (page - 1) * pageSize;
    return { items: all.slice(start, start + pageSize), total: all.length, page, pageSize };
  }

  async update(batch: Batch): Promise<Batch> {
    this.batches.set(batch.id, batch);
    return batch;
  }

  /** Snapshot-only: dumps every record for persistence, ignoring tenant scoping. */
  _dump(): Batch[] {
    return [...this.batches.values()];
  }

  /** Snapshot-only: replaces all in-memory data with the given rows. */
  _load(rows: Batch[]): void {
    this.batches.clear();
    for (const row of rows) this.batches.set(row.id, row);
  }
}
