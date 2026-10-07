import jwt from 'jsonwebtoken';
import { hashInviteCode, hashToken } from '../src/services/authService';
import { ConflictError, NotFoundError, UnauthorizedError } from '../src/errors';
import { createTenant, TEST_JWT_SECRET, useTestDatabase } from './helpers/testDb';

const getDb = useTestDatabase();
const SLUG = 'test-tenant';

async function setup() {
  const t = getDb();
  // Pre-created so registrants keep their chosen role — the first registrant
  // of a brand-new tenant always becomes its ADMIN.
  const tenant = await createTenant(t, SLUG);
  return { t, tenant, auth: t.ctx.authService };
}

describe('AuthService', () => {
  it('registers a new actor with a hashed password, joining an existing tenant with the chosen role', async () => {
    const { auth, tenant } = await setup();
    const actor = await auth.provisionActor('Alice', 'alice@test.com', 'password1', 'FARMER', 'Farm Co', SLUG);
    expect(actor).toMatchObject({ email: 'alice@test.com', role: 'FARMER', tenantId: tenant.id });
    expect(actor.passwordHash).not.toBe('password1');
  });

  it('makes the first registrant of a brand-new tenant its ADMIN', async () => {
    const { auth } = await setup();
    const actor = await auth.provisionActor('Founder', 'founder@new.com', 'password1', 'FARMER', 'New Co', 'brand-new', 'Brand New');
    expect(actor.role).toBe('ADMIN');
  });

  it('rejects a duplicate email — case-insensitively, and across tenants', async () => {
    const { auth } = await setup();
    await auth.provisionActor('Alice', 'alice@test.com', 'password1', 'FARMER', 'Farm Co', SLUG);
    await expect(auth.provisionActor('Alice 2', 'ALICE@test.com', 'password2', 'FARMER', 'x', SLUG)).rejects.toThrow(ConflictError);
    await expect(auth.provisionActor('Alice 3', 'alice@test.com', 'password2', 'FARMER', 'x', 'other-tenant')).rejects.toThrow(
      ConflictError,
    );
  });

  it('leaves no orphan tenant behind when registration fails', async () => {
    const { t, auth } = await setup();
    await auth.provisionActor('Alice', 'alice@test.com', 'password1', 'FARMER', 'Farm Co', SLUG);
    await expect(auth.provisionActor('Dup', 'alice@test.com', 'password1', 'FARMER', 'x', 'should-not-exist')).rejects.toThrow();
    const { rows } = await t.ownerPool.query("SELECT 1 FROM tenants WHERE slug = 'should-not-exist'");
    expect(rows).toHaveLength(0);
  });

  it('two people racing to create the same new tenant: exactly one becomes ADMIN', async () => {
    const { auth } = await setup();
    const [a, b] = await Promise.all([
      auth.provisionActor('A', 'a@race.com', 'password1', 'FARMER', 'x', 'race-tenant'),
      auth.provisionActor('B', 'b@race.com', 'password1', 'FARMER', 'x', 'race-tenant'),
    ]);
    expect(a.tenantId).toBe(b.tenantId);
    expect([a.role, b.role].sort()).toEqual(['ADMIN', 'FARMER']);
  });

  it('logs in and returns access + refresh tokens and an actor without passwordHash', async () => {
    const { auth, tenant } = await setup();
    await auth.provisionActor('Alice', 'alice@test.com', 'password1', 'FARMER', 'Farm Co', SLUG);
    const { token, refreshToken, actor } = await auth.login({ email: 'Alice@Test.com', password: 'password1' });
    expect(refreshToken).toMatch(/^[0-9a-f]{64}$/);
    expect((actor as Record<string, unknown>).passwordHash).toBeUndefined();
    expect(auth.verifyToken(token)).toMatchObject({ actorId: actor.id, tenantId: tenant.id, role: 'FARMER' });
  });

  it('rejects a wrong password or unknown email, and audits the failed attempt', async () => {
    const { auth, t } = await setup();
    const actor = await auth.provisionActor('Alice', 'alice@test.com', 'password1', 'ADMIN', 'Farm Co', SLUG);
    await expect(auth.login({ email: 'alice@test.com', password: 'wrong' })).rejects.toThrow(UnauthorizedError);
    await expect(auth.login({ email: 'nobody@test.com', password: 'x' })).rejects.toThrow(UnauthorizedError);

    const { items } = await t.ctx.adminService.listAuditLogs(actor, 1, 20);
    expect(items.some((e) => e.action === 'LOGIN_FAILED')).toBe(true);
  });

  it('rejects login for a deactivated account', async () => {
    const { t, auth } = await setup();
    const admin = await auth.provisionActor('Admin', 'admin@test.com', 'password1', 'ADMIN', 'x', SLUG);
    const alice = await auth.provisionActor('Alice', 'alice@test.com', 'password1', 'FARMER', 'x', SLUG);
    await t.ctx.adminService.setActorStatus(admin, alice.id, false);
    await expect(auth.login({ email: 'alice@test.com', password: 'password1' })).rejects.toThrow(UnauthorizedError);
  });

  it('authenticates a valid access token and rejects garbage, foreign-secret and pre-tenantId tokens', async () => {
    const { auth } = await setup();
    const registered = await auth.provisionActor('Alice', 'alice@test.com', 'password1', 'FARMER', 'Farm Co', SLUG);
    const { token } = await auth.login({ email: 'alice@test.com', password: 'password1' });
    expect((await auth.authenticate(token))?.id).toBe(registered.id);

    expect(await auth.authenticate('not-a-real-token')).toBeNull();
    expect(await auth.authenticate(jwt.sign({ actorId: registered.id, tenantId: registered.tenantId }, 'other-secret'))).toBeNull();
    // Tokens issued before tenantId existed in the payload are refused (client silently refreshes).
    expect(await auth.authenticate(jwt.sign({ actorId: registered.id, role: 'FARMER' }, TEST_JWT_SECRET))).toBeNull();
  });

  it('a token claiming a different tenant than the actor\'s cannot resolve the actor (RLS)', async () => {
    const { t, auth } = await setup();
    const alice = await auth.provisionActor('Alice', 'alice@test.com', 'password1', 'FARMER', 'x', SLUG);
    const other = await createTenant(t);
    const forged = jwt.sign({ actorId: alice.id, tenantId: other.id, role: 'ADMIN', email: alice.email }, TEST_JWT_SECRET);
    expect(await auth.authenticate(forged)).toBeNull();
  });

  it('rotates the refresh token: new pair issued, old one single-use', async () => {
    const { auth } = await setup();
    await auth.provisionActor('Alice', 'alice@test.com', 'password1', 'FARMER', 'Farm Co', SLUG);
    const { refreshToken } = await auth.login({ email: 'alice@test.com', password: 'password1' });
    const refreshed = await auth.refresh(refreshToken);
    expect(refreshed.refreshToken).not.toBe(refreshToken);
    await expect(auth.refresh(refreshToken)).rejects.toThrow(UnauthorizedError);
    await expect(auth.refresh(refreshed.refreshToken)).resolves.toBeDefined();
  });

  it('lets exactly ONE of many concurrent refreshes with the same token succeed', async () => {
    const { auth } = await setup();
    await auth.provisionActor('Alice', 'alice@test.com', 'password1', 'FARMER', 'Farm Co', SLUG);
    const { refreshToken } = await auth.login({ email: 'alice@test.com', password: 'password1' });

    const results = await Promise.allSettled(Array.from({ length: 8 }, () => auth.refresh(refreshToken)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('rejects a refresh token after logout', async () => {
    const { auth } = await setup();
    await auth.provisionActor('Alice', 'alice@test.com', 'password1', 'FARMER', 'Farm Co', SLUG);
    const { refreshToken } = await auth.login({ email: 'alice@test.com', password: 'password1' });
    await auth.logout(refreshToken);
    await expect(auth.refresh(refreshToken)).rejects.toThrow(UnauthorizedError);
  });

  it('never stores the raw refresh token', async () => {
    const { t, auth } = await setup();
    await auth.provisionActor('Alice', 'alice@test.com', 'password1', 'FARMER', 'Farm Co', SLUG);
    const { refreshToken } = await auth.login({ email: 'alice@test.com', password: 'password1' });
    const { rows } = await t.ownerPool.query<{ token: string }>('SELECT token FROM refresh_tokens');
    expect(rows.map((r) => r.token)).toEqual([hashToken(refreshToken)]);
  });

  it('lists and revokes my sessions by their short id', async () => {
    const { auth } = await setup();
    await auth.provisionActor('Alice', 'alice@test.com', 'password1', 'FARMER', 'Farm Co', SLUG);
    const first = await auth.login({ email: 'alice@test.com', password: 'password1' });
    await auth.login({ email: 'alice@test.com', password: 'password1' });
    const alice = await auth.authenticate(first.token);

    const sessions = await auth.listSessions(alice!);
    expect(sessions).toHaveLength(2);
    await auth.revokeSession(alice!, sessions[0].token.slice(0, 8));
    expect(await auth.listSessions(alice!)).toHaveLength(1);
  });

  it('purges long-expired sessions', async () => {
    const { t, auth } = await setup();
    await auth.provisionActor('Alice', 'alice@test.com', 'password1', 'FARMER', 'Farm Co', SLUG);
    await auth.login({ email: 'alice@test.com', password: 'password1' });
    await t.ownerPool.query("UPDATE refresh_tokens SET expires_at = now() - interval '30 days'");
    expect(await auth.purgeStaleSessions()).toBe(1);
  });

  it('updates profile and password, auditing both', async () => {
    const { t, auth } = await setup();
    await auth.provisionActor('Alice', 'alice@test.com', 'password1', 'ADMIN', 'Farm Co', SLUG);
    const { token } = await auth.login({ email: 'alice@test.com', password: 'password1' });
    const alice = (await auth.authenticate(token))!;

    const updated = await auth.updateProfile(alice, { organization: 'New Farm Co' });
    expect(updated).toMatchObject({ name: 'Alice', organization: 'New Farm Co' });

    await expect(auth.changePassword(alice, { currentPassword: 'wrong', newPassword: 'newpassword1' })).rejects.toThrow(
      UnauthorizedError,
    );
    await auth.changePassword(alice, { currentPassword: 'password1', newPassword: 'newpassword1' });
    await expect(auth.login({ email: 'alice@test.com', password: 'newpassword1' })).resolves.toBeDefined();

    const { items } = await t.ctx.adminService.listAuditLogs(alice, 1, 50);
    expect(items.map((e) => e.action)).toEqual(expect.arrayContaining(['PROFILE_UPDATED', 'PASSWORD_CHANGED']));
  });

  describe('sign-up', () => {
    const person = (email: string) => ({ name: 'P', email, password: 'password1', organization: 'Org' });

    it('founding a workspace makes the registrant its ADMIN; a taken slug is a conflict, not a join', async () => {
      const { auth } = await setup();
      const founder = await auth.registerWorkspace({ ...person('f@new.com'), tenantSlug: 'new-co', tenantName: 'New Co' });
      expect(founder.role).toBe('ADMIN');
      await expect(
        auth.registerWorkspace({ ...person('g@new.com'), tenantSlug: SLUG, tenantName: 'Hijack' }),
      ).rejects.toThrow(ConflictError);
    });

    it('stores only the digest of an invite code', async () => {
      const { t, auth } = await setup();
      const admin = await auth.provisionActor('Admin', 'admin@test.com', 'password1', 'ADMIN', 'x', SLUG);
      const { code } = await auth.createInvitation(admin, { role: 'FARMER', expiresInDays: 7 });
      const { rows } = await t.ownerPool.query<{ code_hash: string }>('SELECT code_hash FROM invitations');
      expect(rows.map((r) => r.code_hash)).toEqual([hashInviteCode(code)]);
      expect(JSON.stringify(rows)).not.toContain(code);
    });

    it('lets exactly ONE of many concurrent redemptions of the same invitation succeed', async () => {
      const { t, auth } = await setup();
      const admin = await auth.provisionActor('Admin', 'admin@test.com', 'password1', 'ADMIN', 'x', SLUG);
      const { code } = await auth.createInvitation(admin, { role: 'INSPECTOR', expiresInDays: 7 });

      const results = await Promise.allSettled(
        Array.from({ length: 5 }, (_, i) => auth.registerWithInvite({ ...person(`p${i}@race.com`), inviteCode: code })),
      );
      const created = results.filter((r) => r.status === 'fulfilled');
      expect(created).toHaveLength(1);
      const { rows } = await t.ownerPool.query("SELECT 1 FROM actors WHERE role = 'INSPECTOR'");
      expect(rows).toHaveLength(1);
    });

    it('refuses an expired invitation', async () => {
      const { t, auth } = await setup();
      const admin = await auth.provisionActor('Admin', 'admin@test.com', 'password1', 'ADMIN', 'x', SLUG);
      const { code } = await auth.createInvitation(admin, { role: 'FARMER', expiresInDays: 1 });
      await t.ownerPool.query("UPDATE invitations SET expires_at = now() - interval '1 minute'");
      await expect(auth.registerWithInvite({ ...person('late@test.com'), inviteCode: code })).rejects.toThrow(NotFoundError);
    });
  });
});
