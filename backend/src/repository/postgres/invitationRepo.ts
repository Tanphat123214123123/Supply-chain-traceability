import { Database, isUuid } from '../../db/database';
import { ActorRole, Invitation, InvitationPreview } from '../../domain/types';
import { IInvitationRepo } from '../interfaces';

interface InvitationRow {
  id: string;
  tenant_id: string;
  role: ActorRole;
  email: string | null;
  note: string | null;
  created_by: string;
  created_at: Date;
  expires_at: Date;
  used_at: Date | null;
  used_by: string | null;
  revoked_at: Date | null;
}

const COLUMNS = 'id, tenant_id, role, email, note, created_by, created_at, expires_at, used_at, used_by, revoked_at';

function toInvitation(row: InvitationRow): Invitation {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    role: row.role,
    email: row.email ?? undefined,
    note: row.note ?? undefined,
    createdBy: row.created_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    usedAt: row.used_at ?? undefined,
    usedBy: row.used_by ?? undefined,
    revokedAt: row.revoked_at ?? undefined,
  };
}

export class PostgresInvitationRepo implements IInvitationRepo {
  constructor(private readonly db: Database) {}

  async create(invitation: Invitation, codeHash: string): Promise<Invitation> {
    const result = await this.db.query<InvitationRow>(
      `INSERT INTO invitations (id, tenant_id, code_hash, role, email, note, created_by, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${COLUMNS}`,
      [
        invitation.id,
        invitation.tenantId,
        codeHash,
        invitation.role,
        invitation.email ?? null,
        invitation.note ?? null,
        invitation.createdBy,
        invitation.createdAt,
        invitation.expiresAt,
      ],
    );
    return toInvitation(result.rows[0]);
  }

  async resolve(codeHash: string): Promise<InvitationPreview | null> {
    const result = await this.db.query<{
      invitation_id: string;
      tenant_id: string;
      tenant_name: string;
      role: ActorRole;
      email: string | null;
      expires_at: Date;
    }>('SELECT invitation_id, tenant_id, tenant_name, role, email, expires_at FROM auth_resolve_invitation($1)', [
      codeHash,
    ]);
    const row = result.rows[0];
    if (!row) return null;
    return {
      invitationId: row.invitation_id,
      tenantId: row.tenant_id,
      tenantName: row.tenant_name,
      role: row.role,
      email: row.email ?? undefined,
      expiresAt: row.expires_at,
    };
  }

  async findRedeemableForUpdate(id: string): Promise<Invitation | null> {
    if (!isUuid(id)) return null;
    const result = await this.db.query<InvitationRow>(
      `SELECT ${COLUMNS} FROM invitations
        WHERE id = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
        FOR UPDATE`,
      [id],
    );
    return result.rows[0] ? toInvitation(result.rows[0]) : null;
  }

  async markUsed(id: string, actorId: string): Promise<void> {
    await this.db.query('UPDATE invitations SET used_at = now(), used_by = $2 WHERE id = $1', [id, actorId]);
  }

  async revoke(id: string): Promise<Invitation | null> {
    if (!isUuid(id)) return null;
    const result = await this.db.query<InvitationRow>(
      `UPDATE invitations SET revoked_at = now()
        WHERE id = $1 AND used_at IS NULL AND revoked_at IS NULL
        RETURNING ${COLUMNS}`,
      [id],
    );
    return result.rows[0] ? toInvitation(result.rows[0]) : null;
  }

  async findRecentByTenant(tenantId: string, limit: number): Promise<Invitation[]> {
    const result = await this.db.query<InvitationRow>(
      `SELECT ${COLUMNS} FROM invitations WHERE tenant_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
      [tenantId, limit],
    );
    return result.rows.map(toInvitation);
  }
}
