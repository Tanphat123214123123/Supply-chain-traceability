import bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomInt } from 'crypto';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { Database, isUniqueViolation, isUuid } from '../db/database';
import {
  Actor,
  ActorRole,
  ChangePasswordDTO,
  CreateInvitationDTO,
  Invitation,
  InvitationPreview,
  LoginDTO,
  RefreshTokenRecord,
  RegisterWithInviteDTO,
  RegisterWorkspaceDTO,
  UpdateProfileDTO,
} from '../domain/types';
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError } from '../errors';
import { IActorRepo, IAuditLogRepo, IInvitationRepo, IRefreshTokenRepo, ITenantRepo } from '../repository/interfaces';

export interface JwtPayload {
  actorId: string;
  /** Lets every authenticated request open its tenant-scoped transaction without a pre-tenant lookup. */
  tenantId: string;
  role: ActorRole;
  email: string;
}

export interface AuthTokens {
  token: string;
  refreshToken: string;
  actor: Omit<Actor, 'passwordHash'>;
}

export interface AuthRepos {
  actorRepo: IActorRepo;
  refreshTokenRepo: IRefreshTokenRepo;
  auditLogRepo: IAuditLogRepo;
  tenantRepo: ITenantRepo;
  invitationRepo: IInvitationRepo;
}

export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface AuthOptions {
  /** Short-lived access token; the refresh token covers the session. Default 15 minutes. */
  accessTokenTtlSeconds?: number;
  /** bcrypt work factor. Default 12; only tests should lower it. */
  bcryptCost?: number;
}

/**
 * Refresh tokens are stored as a SHA-256 digest, not the raw value — unlike a
 * password (low-entropy, needs bcrypt's slow hash), this is already a random
 * 256-bit value, so a fast hash is enough to make a leaked DB/backup useless
 * to an attacker without also having intercepted the original token in transit.
 */
export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

/** Thrown internally when a brand-new tenant slug is claimed concurrently; provisionActor() retries once as a join. */
class TenantSlugRace extends Error {}

// No 0/O, 1/I/L: invite codes get read aloud and typed from paper.
const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const INVITE_CODE_LENGTH = 12; // 31^12 is about 2^59, unguessable at any request rate the API allows

function newInviteCode(): string {
  let raw = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) raw += INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)];
  return raw.match(/.{4}/g)!.join('-');
}

/** Case, spaces and dashes don't matter when a code is typed back in. */
export function hashInviteCode(code: string): string {
  return hashToken(code.toUpperCase().replace(/[^A-Z0-9]/g, ''));
}

type NewActorFields = Pick<Actor, 'name' | 'email' | 'passwordHash' | 'role' | 'organization' | 'tenantId'>;

export class AuthService {
  constructor(
    private readonly db: Database,
    private readonly repos: AuthRepos,
    private readonly jwtSecret: string,
    options: AuthOptions = {},
  ) {
    this.accessTokenTtlSeconds = options.accessTokenTtlSeconds ?? 15 * 60;
    this.bcryptCost = options.bcryptCost ?? 12;
  }

  private readonly accessTokenTtlSeconds: number;
  private readonly bcryptCost: number;

  /**
   * Trusted, server-side provisioning (demo seeding, tests) — NOT reachable
   * over HTTP, because it lets the caller pick both tenant and role. Public
   * sign-up goes through registerWorkspace / registerWithInvite instead.
   *
   * Joining an existing `tenantSlug` uses the given role; creating a
   * brand-new tenant makes this actor its ADMIN regardless, since every
   * tenant needs at least one admin.
   *
   * The tenant row and its first actor are created in ONE transaction: if the
   * actor insert fails (e.g. the email is taken), no orphan tenant is left.
   */
  async provisionActor(
    name: string,
    email: string,
    password: string,
    role: ActorRole,
    organization: string,
    tenantSlug: string,
    tenantName?: string,
  ): Promise<Actor> {
    if (await this.repos.actorRepo.lookupByEmail(email)) throw new ConflictError('Email already registered');
    const passwordHash = await bcrypt.hash(password, this.bcryptCost);

    for (let attempt = 0; ; attempt++) {
      try {
        return await this.provisionOnce(name, email, passwordHash, role, organization, tenantSlug, tenantName);
      } catch (err) {
        if (err instanceof TenantSlugRace && attempt === 0) continue;
        throw err;
      }
    }
  }

  private async provisionOnce(
    name: string,
    email: string,
    passwordHash: string,
    role: ActorRole,
    organization: string,
    tenantSlug: string,
    tenantName: string | undefined,
  ): Promise<Actor> {
    const existingTenant = await this.repos.tenantRepo.findBySlug(tenantSlug);
    const tenantId = existingTenant?.id ?? uuidv4();

    return this.db.withTenant(tenantId, async () => {
      let isNewTenant = false;
      if (!existingTenant) {
        const created = await this.repos.tenantRepo.insertIfAbsent({
          id: tenantId,
          slug: tenantSlug,
          name: tenantName?.trim() || tenantSlug,
          createdAt: new Date(),
        });
        if (!created) throw new TenantSlugRace();
        isNewTenant = true;
      }

      const actor = await this.insertActor({
        name,
        email,
        passwordHash,
        role: isNewTenant ? 'ADMIN' : role,
        organization,
        tenantId,
      });
      await this.logAuditEvent(actor.id, tenantId, 'ACTOR_REGISTERED', { email, role: actor.role });
      return actor;
    });
  }

  /** Must run inside the actor's tenant transaction. */
  private async insertActor(fields: NewActorFields): Promise<Actor> {
    const actor: Actor = { ...fields, id: uuidv4(), createdAt: new Date(), isActive: true };
    try {
      await this.repos.actorRepo.create(actor);
    } catch (err) {
      // Each register path pre-checks the email, but that can lose a race; the unique index can't.
      if (isUniqueViolation(err, 'idx_actors_email_lower')) throw new ConflictError('Email already registered');
      throw err;
    }
    return actor;
  }

  private async assertEmailAvailable(email: string): Promise<void> {
    if (await this.repos.actorRepo.lookupByEmail(email)) throw new ConflictError('Email already registered');
  }

  /**
   * Public sign-up, path 1: found a new workspace. The registrant becomes its
   * ADMIN — there is no role to choose, because nobody exists yet who could
   * have granted one. An existing slug is a conflict, never a join.
   */
  async registerWorkspace(dto: RegisterWorkspaceDTO): Promise<Actor> {
    await this.assertEmailAvailable(dto.email);
    if (await this.repos.tenantRepo.findBySlug(dto.tenantSlug)) throw new ConflictError('Workspace slug already taken');
    const passwordHash = await bcrypt.hash(dto.password, this.bcryptCost);

    const tenantId = uuidv4();
    return this.db.withTenant(tenantId, async () => {
      const created = await this.repos.tenantRepo.insertIfAbsent({
        id: tenantId,
        slug: dto.tenantSlug,
        name: dto.tenantName,
        createdAt: new Date(),
      });
      if (!created) throw new ConflictError('Workspace slug already taken');

      const actor = await this.insertActor({
        name: dto.name,
        email: dto.email,
        passwordHash,
        role: 'ADMIN',
        organization: dto.organization,
        tenantId,
      });
      await this.logAuditEvent(actor.id, tenantId, 'ACTOR_REGISTERED', {
        email: dto.email,
        role: 'ADMIN',
        via: 'new_workspace',
      });
      return actor;
    });
  }

  /** What the sign-up form shows for a code: the workspace name and the role it grants. */
  async previewInvitation(code: string): Promise<InvitationPreview> {
    const preview = await this.repos.invitationRepo.resolve(hashInviteCode(code));
    if (!preview) throw new NotFoundError('Invitation is invalid or has expired');
    return preview;
  }

  /**
   * Public sign-up, path 2: redeem an invitation. The role is the
   * invitation's, and the invitation row is locked and consumed in the same
   * transaction that creates the actor — one code, exactly one account.
   */
  async registerWithInvite(dto: RegisterWithInviteDTO): Promise<Actor> {
    await this.assertEmailAvailable(dto.email);
    const preview = await this.previewInvitation(dto.inviteCode);
    if (preview.email && preview.email.toLowerCase() !== dto.email.toLowerCase()) {
      throw new ForbiddenError('This invitation was issued for a different email address');
    }
    const passwordHash = await bcrypt.hash(dto.password, this.bcryptCost);

    return this.db.withTenant(preview.tenantId, async () => {
      const invitation = await this.repos.invitationRepo.findRedeemableForUpdate(preview.invitationId);
      if (!invitation) throw new ConflictError('Invitation is invalid or has expired');

      const actor = await this.insertActor({
        name: dto.name,
        email: dto.email,
        passwordHash,
        role: invitation.role,
        organization: dto.organization,
        tenantId: preview.tenantId,
      });
      await this.repos.invitationRepo.markUsed(invitation.id, actor.id);
      await this.logAuditEvent(actor.id, preview.tenantId, 'ACTOR_REGISTERED', {
        email: dto.email,
        role: actor.role,
        via: 'invitation',
        invitationId: invitation.id,
      });
      return actor;
    });
  }

  /** ADMIN only (route-gated). The raw code is returned exactly once — only its digest is stored. */
  async createInvitation(admin: Actor, dto: CreateInvitationDTO): Promise<{ invitation: Invitation; code: string }> {
    const code = newInviteCode();
    const now = new Date();
    const invitation = await this.db.withTenant(admin.tenantId, async () => {
      const created = await this.repos.invitationRepo.create(
        {
          id: uuidv4(),
          tenantId: admin.tenantId,
          role: dto.role,
          email: dto.email,
          note: dto.note,
          createdBy: admin.id,
          createdAt: now,
          expiresAt: new Date(now.getTime() + dto.expiresInDays * 24 * 60 * 60 * 1000),
        },
        hashInviteCode(code),
      );
      await this.logAuditEvent(admin.id, admin.tenantId, 'INVITATION_CREATED', {
        invitationId: created.id,
        role: created.role,
      });
      return created;
    });
    return { invitation, code };
  }

  async listInvitations(admin: Actor): Promise<Invitation[]> {
    return this.db.withTenant(admin.tenantId, () => this.repos.invitationRepo.findRecentByTenant(admin.tenantId, 100));
  }

  async revokeInvitation(admin: Actor, id: string): Promise<Invitation> {
    return this.db.withTenant(admin.tenantId, async () => {
      const revoked = await this.repos.invitationRepo.revoke(id);
      if (!revoked) throw new ConflictError('Invitation not found, already used or already revoked');
      await this.logAuditEvent(admin.id, admin.tenantId, 'INVITATION_REVOKED', { invitationId: id });
      return revoked;
    });
  }

  async login(dto: LoginDTO): Promise<AuthTokens> {
    const identity = await this.repos.actorRepo.lookupByEmail(dto.email);
    // No resolvable tenant for an unknown account — nothing to attribute an
    // audit entry to, unlike a wrong password on a real account below.
    if (!identity) throw new UnauthorizedError('Invalid credentials');

    const actor = await this.db.withTenant(identity.tenantId, () => this.repos.actorRepo.findById(identity.actorId));
    if (!actor || !actor.isActive) throw new UnauthorizedError('Invalid credentials');

    // bcrypt deliberately runs outside any transaction: ~250ms of CPU must not pin a pooled connection.
    const valid = await bcrypt.compare(dto.password, actor.passwordHash);

    const tokens = await this.db.withTenant(actor.tenantId, async () => {
      if (!valid) {
        await this.logAuditEvent(actor.id, actor.tenantId, 'LOGIN_FAILED', { email: dto.email });
        return null;
      }
      await this.logAuditEvent(actor.id, actor.tenantId, 'LOGIN_SUCCESS', { email: dto.email });
      return this.issueTokens(actor);
    });
    // Thrown only after COMMIT — throwing inside the transaction would roll back the LOGIN_FAILED entry.
    if (!tokens) throw new UnauthorizedError('Invalid credentials');
    return tokens;
  }

  /**
   * Rotation is a single atomic consume: two concurrent requests presenting
   * the same refresh token cannot both succeed — exactly one gets a new pair.
   */
  async refresh(refreshToken: string): Promise<AuthTokens> {
    const identity = await this.repos.refreshTokenRepo.consume(hashToken(refreshToken));
    if (!identity) throw new UnauthorizedError('Invalid or expired refresh token');

    return this.db.withTenant(identity.tenantId, async () => {
      const actor = await this.repos.actorRepo.findById(identity.actorId);
      if (!actor || !actor.isActive) throw new UnauthorizedError('Invalid or expired refresh token');
      return this.issueTokens(actor);
    });
  }

  async logout(refreshToken: string): Promise<void> {
    await this.repos.refreshTokenRepo.revoke(hashToken(refreshToken));
  }

  /** Must be called inside the actor's tenant transaction. */
  private async issueTokens(actor: Actor): Promise<AuthTokens> {
    const payload: JwtPayload = { actorId: actor.id, tenantId: actor.tenantId, role: actor.role, email: actor.email };
    const token = jwt.sign(payload, this.jwtSecret, { expiresIn: this.accessTokenTtlSeconds });

    const refreshToken = randomBytes(32).toString('hex');
    await this.repos.refreshTokenRepo.create({
      token: hashToken(refreshToken),
      actorId: actor.id,
      tenantId: actor.tenantId,
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

  /**
   * Access token → current, active actor (or null). The actor is re-read on
   * every request so deactivation / role changes take effect immediately,
   * not when the token expires.
   */
  async authenticate(token: string): Promise<Actor | null> {
    let payload: JwtPayload;
    try {
      payload = this.verifyToken(token);
    } catch {
      return null;
    }
    // Tokens minted before tenantId was added to the payload are simply
    // rejected; the client's silent refresh obtains a new one.
    if (typeof payload.tenantId !== 'string' || !isUuid(payload.tenantId)) return null;

    const actor = await this.db.withTenant(payload.tenantId, () => this.repos.actorRepo.findById(payload.actorId));
    return actor && actor.isActive ? actor : null;
  }

  async updateProfile(actor: Actor, dto: UpdateProfileDTO): Promise<Actor> {
    return this.db.withTenant(actor.tenantId, async () => {
      const updated = await this.repos.actorRepo.updateProfile(actor.id, {
        name: dto.name?.trim() || actor.name,
        organization: dto.organization?.trim() || actor.organization,
      });
      if (!updated) throw new NotFoundError('Actor not found');
      await this.logAuditEvent(actor.id, actor.tenantId, 'PROFILE_UPDATED', {});
      return updated;
    });
  }

  async changePassword(actor: Actor, dto: ChangePasswordDTO): Promise<void> {
    const valid = await bcrypt.compare(dto.currentPassword, actor.passwordHash);
    if (!valid) throw new UnauthorizedError('Current password is incorrect');

    const passwordHash = await bcrypt.hash(dto.newPassword, this.bcryptCost);
    await this.db.withTenant(actor.tenantId, async () => {
      await this.repos.actorRepo.setPasswordHash(actor.id, passwordHash);
      await this.logAuditEvent(actor.id, actor.tenantId, 'PASSWORD_CHANGED', {});
    });
  }

  async listSessions(actor: Actor): Promise<RefreshTokenRecord[]> {
    return this.db.withTenant(actor.tenantId, () => this.repos.refreshTokenRepo.findActiveByActorId(actor.id));
  }

  /** `tokenPrefix` is the short session id shown by listSessions (a prefix of the stored token hash). */
  async revokeSession(actor: Actor, tokenPrefix: string): Promise<void> {
    await this.db.withTenant(actor.tenantId, async () => {
      const sessions = await this.repos.refreshTokenRepo.findActiveByActorId(actor.id);
      const match = sessions.filter((s) => s.token.startsWith(tokenPrefix));
      // An ambiguous prefix must not revoke an arbitrary one of several sessions.
      if (match.length !== 1) throw new NotFoundError('Session not found');
      await this.repos.refreshTokenRepo.revokeForActor(actor.id, match[0].token);
    });
  }

  /** Housekeeping: drops long-expired / revoked refresh tokens across all tenants. */
  async purgeStaleSessions(): Promise<number> {
    return this.repos.refreshTokenRepo.purgeStale();
  }

  private async logAuditEvent(
    actorId: string | null,
    tenantId: string,
    action: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.repos.auditLogRepo.create({
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
}
