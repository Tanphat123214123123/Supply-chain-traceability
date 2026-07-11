import { Pool } from 'pg';
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
  constructor(private readonly pool: Pool) {}

  async create(tenant: Tenant): Promise<Tenant> {
    await this.pool.query(
      `INSERT INTO tenants (id, slug, name, created_at) VALUES ($1, $2, $3, $4)`,
      [tenant.id, tenant.slug, tenant.name, tenant.createdAt],
    );
    return tenant;
  }

  async findById(id: string): Promise<Tenant | null> {
    const result = await this.pool.query<TenantRow>('SELECT * FROM tenants WHERE id = $1', [id]);
    return result.rows[0] ? toTenant(result.rows[0]) : null;
  }

  async findBySlug(slug: string): Promise<Tenant | null> {
    const result = await this.pool.query<TenantRow>('SELECT * FROM tenants WHERE slug = $1', [slug]);
    return result.rows[0] ? toTenant(result.rows[0]) : null;
  }
}
