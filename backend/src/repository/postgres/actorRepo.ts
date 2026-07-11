import { Pool } from 'pg';
import { Actor, ActorRole } from '../../domain/types';
import { IActorRepo } from '../interfaces';

interface ActorRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: ActorRole;
  organization: string;
  tenant_id: string;
  created_at: Date;
  is_active: boolean;
}

function toActor(row: ActorRow): Actor {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    organization: row.organization,
    tenantId: row.tenant_id,
    createdAt: row.created_at,
    isActive: row.is_active,
  };
}

export class PostgresActorRepo implements IActorRepo {
  constructor(private readonly pool: Pool) {}

  async create(actor: Actor): Promise<Actor> {
    await this.pool.query(
      `INSERT INTO actors (id, name, email, password_hash, role, organization, tenant_id, created_at, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        actor.id,
        actor.name,
        actor.email,
        actor.passwordHash,
        actor.role,
        actor.organization,
        actor.tenantId,
        actor.createdAt,
        actor.isActive,
      ],
    );
    return actor;
  }

  async findById(id: string): Promise<Actor | null> {
    const result = await this.pool.query<ActorRow>('SELECT * FROM actors WHERE id = $1', [id]);
    return result.rows[0] ? toActor(result.rows[0]) : null;
  }

  async findByEmail(email: string): Promise<Actor | null> {
    const result = await this.pool.query<ActorRow>('SELECT * FROM actors WHERE lower(email) = lower($1)', [email]);
    return result.rows[0] ? toActor(result.rows[0]) : null;
  }

  async findAllByTenant(tenantId: string): Promise<Actor[]> {
    const result = await this.pool.query<ActorRow>(
      'SELECT * FROM actors WHERE tenant_id = $1 ORDER BY name ASC',
      [tenantId],
    );
    return result.rows.map(toActor);
  }

  async update(actor: Actor): Promise<Actor> {
    await this.pool.query(
      `UPDATE actors SET name = $2, organization = $3, role = $4, is_active = $5, password_hash = $6 WHERE id = $1`,
      [actor.id, actor.name, actor.organization, actor.role, actor.isActive, actor.passwordHash],
    );
    return actor;
  }
}
