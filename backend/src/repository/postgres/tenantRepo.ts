import { Database } from '../../db/database';
import { Tenant } from '../../domain/types';
import { ITenantRepo } from '../interfaces';

interface TenantRow {
  id: string;
  slug: string;
  name: string;
  created_at: Date;
}

function toTenant(row: TenantRow): Tenant {
  return { id: row.id, slug: row.slug, name: row.name, createdAt: row.created_at };
}

export class PostgresTenantRepo implements ITenantRepo {
  constructor(private readonly db: Database) {}

  async insertIfAbsent(tenant: Tenant): Promise<Tenant | null> {
    const result = await this.db.query<TenantRow>(
      `INSERT INTO tenants (id, slug, name, created_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (slug) DO NOTHING
       RETURNING id, slug, name, created_at`,
      [tenant.id, tenant.slug, tenant.name, tenant.createdAt],
    );
    return result.rows[0] ? toTenant(result.rows[0]) : null;
  }

  async findById(id: string): Promise<Tenant | null> {
    const result = await this.db.query<TenantRow>('SELECT id, slug, name, created_at FROM tenants WHERE id = $1', [id]);
    return result.rows[0] ? toTenant(result.rows[0]) : null;
  }

  async findBySlug(slug: string): Promise<Tenant | null> {
    const result = await this.db.query<TenantRow>('SELECT id, slug, name, created_at FROM tenants WHERE slug = $1', [slug]);
    return result.rows[0] ? toTenant(result.rows[0]) : null;
  }

  async listIds(): Promise<string[]> {
    const result = await this.db.query<{ id: string }>('SELECT id FROM tenants ORDER BY created_at');
    return result.rows.map((r) => r.id);
  }
}
