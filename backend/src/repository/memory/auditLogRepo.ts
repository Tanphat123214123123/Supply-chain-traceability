import { AuditLogEntry, PaginatedResult } from '../../domain/types';
import { IAuditLogRepo } from '../interfaces';

export class InMemoryAuditLogRepo implements IAuditLogRepo {
  private readonly entries: AuditLogEntry[] = [];

  async create(entry: AuditLogEntry): Promise<AuditLogEntry> {
    this.entries.push(entry);
    return entry;
  }

  async findPageByTenant(tenantId: string, page: number, pageSize: number): Promise<PaginatedResult<AuditLogEntry>> {
    const sorted = this.entries
      .filter((e) => e.tenantId === tenantId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const start = (page - 1) * pageSize;
    return { items: sorted.slice(start, start + pageSize), total: sorted.length, page, pageSize };
  }

  async findByActionAndTenant(action: string, tenantId: string, limit: number): Promise<AuditLogEntry[]> {
    return this.entries
      .filter((e) => e.action === action && e.tenantId === tenantId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  /** Snapshot-only: dumps every record for persistence, ignoring tenant scoping. */
  _dump(): AuditLogEntry[] {
    return [...this.entries];
  }

  /** Snapshot-only: replaces all in-memory data with the given rows. */
  _load(rows: AuditLogEntry[]): void {
    this.entries.length = 0;
    this.entries.push(...rows);
  }
}
