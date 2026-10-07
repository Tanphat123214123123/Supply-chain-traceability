import { Database, isUuid } from '../../db/database';
import { Actor, ActorRole } from '../../domain/types';
import { ActorIdentity, IActorRepo } from '../interfaces';

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

const COLUMNS = 'id, name, email, password_hash, role, organization, tenant_id, created_at, is_active';

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
  constructor(private readonly db: Database) {}

  async create(actor: Actor): Promise<Actor> {
    await this.db.query(
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
    if (!isUuid(id)) return null;
    const result = await this.db.query<ActorRow>(`SELECT ${COLUMNS} FROM actors WHERE id = $1`, [id]);
    return result.rows[0] ? toActor(result.rows[0]) : null;
  }

  async findAllByTenant(tenantId: string): Promise<Actor[]> {
    const result = await this.db.query<ActorRow>(
      `SELECT ${COLUMNS} FROM actors WHERE tenant_id = $1 ORDER BY name ASC, id ASC`,
      [tenantId],
    );
    return result.rows.map(toActor);
  }

  async lookupByEmail(email: string): Promise<ActorIdentity | null> {
    const result = await this.db.query<{ actor_id: string; tenant_id: string }>(
      'SELECT actor_id, tenant_id FROM auth_lookup_actor($1)',
      [email],
    );
    const row = result.rows[0];
    return row ? { actorId: row.actor_id, tenantId: row.tenant_id } : null;
  }

  async updateProfile(id: string, changes: { name: string; organization: string }): Promise<Actor | null> {
    const result = await this.db.query<ActorRow>(
      `UPDATE actors SET name = $2, organization = $3 WHERE id = $1 RETURNING ${COLUMNS}`,
      [id, changes.name, changes.organization],
    );
    return result.rows[0] ? toActor(result.rows[0]) : null;
  }

  async setActive(id: string, isActive: boolean): Promise<Actor | null> {
    const result = await this.db.query<ActorRow>(
      `UPDATE actors SET is_active = $2 WHERE id = $1 RETURNING ${COLUMNS}`,
      [id, isActive],
    );
    return result.rows[0] ? toActor(result.rows[0]) : null;
  }

  async setRole(id: string, role: ActorRole): Promise<Actor | null> {
    const result = await this.db.query<ActorRow>(`UPDATE actors SET role = $2 WHERE id = $1 RETURNING ${COLUMNS}`, [
      id,
      role,
    ]);
    return result.rows[0] ? toActor(result.rows[0]) : null;
  }

  async setPasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.db.query('UPDATE actors SET password_hash = $2 WHERE id = $1', [id, passwordHash]);
  }
}
