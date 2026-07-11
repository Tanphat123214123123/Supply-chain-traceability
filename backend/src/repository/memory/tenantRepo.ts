import { Tenant } from '../../domain/types';
import { ITenantRepo } from '../interfaces';

export class InMemoryTenantRepo implements ITenantRepo {
  private readonly tenants = new Map<string, Tenant>();

  async create(tenant: Tenant): Promise<Tenant> {
    this.tenants.set(tenant.id, tenant);
    return tenant;
  }

  async findById(id: string): Promise<Tenant | null> {
    return this.tenants.get(id) ?? null;
  }

  async findBySlug(slug: string): Promise<Tenant | null> {
    for (const tenant of this.tenants.values()) {
      if (tenant.slug === slug) return tenant;
    }
    return null;
  }

  /** Snapshot-only: dumps every record for persistence. */
  _dump(): Tenant[] {
    return [...this.tenants.values()];
  }

  /** Snapshot-only: replaces all in-memory data with the given rows. */
  _load(rows: Tenant[]): void {
    this.tenants.clear();
    for (const row of rows) this.tenants.set(row.id, row);
  }
}
