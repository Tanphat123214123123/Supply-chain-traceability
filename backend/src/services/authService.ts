import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { Actor, ActorRole, ChangePasswordDTO, LoginDTO, RefreshTokenRecord, UpdateProfileDTO } from '../domain/types';
import { ConflictError, NotFoundError, UnauthorizedError } from '../errors';
import { IActorRepo, IAuditLogRepo, IRefreshTokenRepo, ITenantRepo } from '../repository/interfaces';

export interface JwtPayload {
  actorId: string;
  role: ActorRole;
  email: string;
}

export interface AuthTokens {
  token: string;
  refreshToken: string;
  actor: Omit<Actor, 'passwordHash'>;
}

export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Refresh tokens are stored as a SHA-256 digest, not the raw value — unlike a
 * password (low-entropy, needs bcrypt's slow hash), this is already a random
 * 256-bit value, so a fast hash is enough to make a leaked DB/backup useless
 * to an attacker without also having intercepted the original token in transit.
 */
function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

export class AuthService {
  constructor(
    private readonly actorRepo: IActorRepo,
    private readonly refreshTokenRepo: IRefreshTokenRepo,
    private readonly auditLogRepo: IAuditLogRepo,
    private readonly tenantRepo: ITenantRepo,
    private readonly jwtSecret: string,
    private readonly jwtExpiresInSeconds: number = 15 * 60, // short-lived access token; refresh token covers the session
  ) {}

  /**
   * Workspace-slug model (like Slack): joining an existing `tenantSlug` uses
   * the caller's chosen role (still gated by SELF_REGISTERABLE_ROLES upstream
   * in validation); creating a brand-new tenant makes this actor its ADMIN
   * regardless of the role they picked, since every tenant needs at least one
   * admin and nobody else could grant it to them yet. This is NOT the old
   * self-register-as-ADMIN hole — the caller never chooses ADMIN themselves,
   * the system assigns it only for a genuinely new, previously nonexistent tenant.
   */
  async register(
    name: string,
    email: string,
    password: string,
    role: ActorRole,
    organization: string,
    tenantSlug: string,
    tenantName?: string,
  ): Promise<Actor> {
    const existing = await this.actorRepo.findByEmail(email);
    if (existing) throw new ConflictError('Email already registered');

    let tenant = await this.tenantRepo.findBySlug(tenantSlug);
    let isNewTenant = false;
    if (!tenant) {
      tenant = { id: uuidv4(), slug: tenantSlug, name: tenantName?.trim() || tenantSlug, createdAt: new Date() };
      await this.tenantRepo.create(tenant);
      isNewTenant = true;
    }
    const effectiveRole: ActorRole = isNewTenant ? 'ADMIN' : role;

    const passwordHash = await bcrypt.hash(password, 12);
    const actor: Actor = {
      id: uuidv4(),
      name,
      email,
      passwordHash,
      role: effectiveRole,
      organization,
      tenantId: tenant.id,
      createdAt: new Date(),
      isActive: true,
    };

    await this.actorRepo.create(actor);
    await this.logAuditEvent(actor.id, actor.tenantId, 'ACTOR_REGISTERED', { email, role: effectiveRole });
    return actor;
  }

  async login(dto: LoginDTO): Promise<AuthTokens> {
    const actor = await this.actorRepo.findByEmail(dto.email);
    if (!actor || !actor.isActive) {
      // No resolvable tenant for an unknown/inactive account — nothing to
      // attribute an audit entry to, unlike a wrong password on a real
      // account below, which logs under that account's own tenant.
      throw new UnauthorizedError('Invalid credentials');
    }

    const valid = await bcrypt.compare(dto.password, actor.passwordHash);
    if (!valid) {
      await this.logAuditEvent(actor.id, actor.tenantId, 'LOGIN_FAILED', { email: dto.email });
      throw new UnauthorizedError('Invalid credentials');
    }

    await this.logAuditEvent(actor.id, actor.tenantId, 'LOGIN_SUCCESS', { email: dto.email });
    return this.issueTokens(actor);
  }

  private async logAuditEvent(
    actorId: string | null,
    tenantId: string,
    action: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.auditLogRepo.create({
      id: uuidv4(),
      actorId,
      tenantId,
      action,
      entityType: 'actor',
      entityId: actorId,
      metadata,
      createdAt: new Date(),
    });
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const record = await this.refreshTokenRepo.findByToken(hashToken(refreshToken));
    if (!record || record.revoked || record.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedError('Invalid or expired refresh token');
    }

    const actor = await this.actorRepo.findById(record.actorId);
    if (!actor || !actor.isActive) throw new UnauthorizedError('Invalid or expired refresh token');

    // Rotate: the old refresh token is single-use, limiting the blast radius if it leaked.
    await this.refreshTokenRepo.revoke(hashToken(refreshToken));
    return this.issueTokens(actor);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.refreshTokenRepo.revoke(hashToken(refreshToken));
  }

  private async issueTokens(actor: Actor): Promise<AuthTokens> {
    const payload: JwtPayload = { actorId: actor.id, role: actor.role, email: actor.email };
    const token = jwt.sign(payload, this.jwtSecret, { expiresIn: this.jwtExpiresInSeconds });

    const refreshToken = randomBytes(32).toString('hex');
    await this.refreshTokenRepo.create({
      token: hashToken(refreshToken),
      actorId: actor.id,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      revoked: false,
      createdAt: new Date(),
    });

    const { passwordHash: _omit, ...actorPublic } = actor;
    return { token, refreshToken, actor: actorPublic };
  }

  verifyToken(token: string): JwtPayload {
    return jwt.verify(token, this.jwtSecret) as JwtPayload;
  }

  async updateProfile(actorId: string, dto: UpdateProfileDTO): Promise<Actor> {
    const actor = await this.actorRepo.findById(actorId);
    if (!actor) throw new NotFoundError('Actor not found');
    const updated: Actor = {
      ...actor,
      name: dto.name?.trim() || actor.name,
      organization: dto.organization?.trim() || actor.organization,
    };
    await this.actorRepo.update(updated);
    await this.logAuditEvent(actorId, actor.tenantId, 'PROFILE_UPDATED', {});
    return updated;
  }

  async changePassword(actorId: string, dto: ChangePasswordDTO): Promise<void> {
    const actor = await this.actorRepo.findById(actorId);
    if (!actor) throw new NotFoundError('Actor not found');

    const valid = await bcrypt.compare(dto.currentPassword, actor.passwordHash);
    if (!valid) throw new UnauthorizedError('Current password is incorrect');

    const passwordHash = await bcrypt.hash(dto.newPassword, 12);
    await this.actorRepo.update({ ...actor, passwordHash });
    await this.logAuditEvent(actorId, actor.tenantId, 'PASSWORD_CHANGED', {});
  }

  async listSessions(actorId: string): Promise<RefreshTokenRecord[]> {
    return this.refreshTokenRepo.findActiveByActorId(actorId);
  }

  async revokeSession(actorId: string, token: string): Promise<void> {
    const record = await this.refreshTokenRepo.findByToken(token);
    if (!record || record.actorId !== actorId) throw new NotFoundError('Session not found');
    await this.refreshTokenRepo.revoke(token);
  }
}
