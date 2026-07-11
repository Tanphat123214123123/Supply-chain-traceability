import { Anomaly, AnomalyListQuery, PaginatedResult } from '../../domain/types';
import { IAnomalyRepo } from '../interfaces';

export class InMemoryAnomalyRepo implements IAnomalyRepo {
  private readonly anomalies: Anomaly[] = [];

  async create(anomaly: Anomaly): Promise<Anomaly> {
    this.anomalies.push(anomaly);
    return anomaly;
  }

  async findById(id: string): Promise<Anomaly | null> {
    return this.anomalies.find((a) => a.id === id) ?? null;
  }

  async findByBatchId(batchId: string): Promise<Anomaly[]> {
    return this.anomalies.filter((a) => a.batchId === batchId);
  }

  async findPageByTenant(
    tenantId: string,
    { page, pageSize, resolved, severity }: AnomalyListQuery,
  ): Promise<PaginatedResult<Anomaly>> {
    let filtered = this.anomalies
      .filter((a) => a.tenantId === tenantId)
      .sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime());
    if (resolved !== undefined) filtered = filtered.filter((a) => a.resolved === resolved);
    if (severity) filtered = filtered.filter((a) => a.severity === severity);

    const start = (page - 1) * pageSize;
    return { items: filtered.slice(start, start + pageSize), total: filtered.length, page, pageSize };
  }

  async resolve(id: string, resolvedBy: string): Promise<Anomaly | null> {
    const anomaly = this.anomalies.find((a) => a.id === id);
    if (!anomaly) return null;
    anomaly.resolved = true;
    anomaly.resolvedBy = resolvedBy;
    anomaly.resolvedAt = new Date();
    return anomaly;
  }

  async countAllByTenant(tenantId: string): Promise<number> {
    return this.anomalies.filter((a) => a.tenantId === tenantId).length;
  }

  async findAllByTenant(tenantId: string): Promise<Anomaly[]> {
    return this.anomalies.filter((a) => a.tenantId === tenantId);
  }

  /** Snapshot-only: dumps every record for persistence, ignoring tenant scoping. */
  _dump(): Anomaly[] {
    return [...this.anomalies];
  }

  /** Snapshot-only: replaces all in-memory data with the given rows. */
  _load(rows: Anomaly[]): void {
    this.anomalies.length = 0;
    this.anomalies.push(...rows);
  }
}
