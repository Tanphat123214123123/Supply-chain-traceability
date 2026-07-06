import { v4 as uuidv4 } from 'uuid';
import { InMemoryActorRepo } from '../src/repository/memory/actorRepo';
import { InMemoryAuditLogRepo } from '../src/repository/memory/auditLogRepo';
import { InMemoryRefreshTokenRepo } from '../src/repository/memory/refreshTokenRepo';
import { InMemoryTenantRepo } from '../src/repository/memory/tenantRepo';
import { AuthService } from '../src/services/authService';

const TENANT_SLUG = 'test-tenant';

async function makeService() {
  const actorRepo = new InMemoryActorRepo();
  const refreshTokenRepo = new InMemoryRefreshTokenRepo();
  const auditLogRepo = new InMemoryAuditLogRepo();
  const tenantRepo = new InMemoryTenantRepo();
  // Pre-created so registrants below keep their chosen role — AuthService.register
  // would otherwise make the first registrant of a brand-new tenant its ADMIN.
  await tenantRepo.create({ id: uuidv4(), slug: TENANT_SLUG, name: 'Test Tenant', createdAt: new Date() });
  const authService = new AuthService(actorRepo, refreshTokenRepo, auditLogRepo, tenantRepo, 'test-secret', 3600);
  return { actorRepo, refreshTokenRepo, auditLogRepo, tenantRepo, authService };
}

describe('AuthService', () => {
  it('registers a new actor with a hashed password', async () => {
    const { authService } = await makeService();
    const actor = await authService.register('Alice', 'alice@test.com', 'password1', 'FARMER', 'Farm Co', TENANT_SLUG);
    expect(actor.email).toBe('alice@test.com');
    expect(actor.passwordHash).not.toBe('password1');
  });

  it('rejects registering a duplicate email', async () => {
    const { authService } = await makeService();
    await authService.register('Alice', 'alice@test.com', 'password1', 'FARMER', 'Farm Co', TENANT_SLUG);
    await expect(
      authService.register('Alice 2', 'alice@test.com', 'password2', 'FARMER', 'Farm Co', TENANT_SLUG),
    ).rejects.toThrow();
  });

  it('logs in with correct credentials and returns access + refresh tokens and an actor without passwordHash', async () => {
    const { authService } = await makeService();
    await authService.register('Alice', 'alice@test.com', 'password1', 'FARMER', 'Farm Co', TENANT_SLUG);
    const { token, refreshToken, actor } = await authService.login({ email: 'alice@test.com', password: 'password1' });
    expect(token).toBeTruthy();
    expect(refreshToken).toBeTruthy();
    expect((actor as Record<string, unknown>).passwordHash).toBeUndefined();
  });

  it('rejects login with wrong password', async () => {
    const { authService } = await makeService();
    await authService.register('Alice', 'alice@test.com', 'password1', 'FARMER', 'Farm Co', TENANT_SLUG);
    await expect(authService.login({ email: 'alice@test.com', password: 'wrong' })).rejects.toThrow();
  });

  it('rejects login for unknown email', async () => {
    const { authService } = await makeService();
    await expect(authService.login({ email: 'nobody@test.com', password: 'x' })).rejects.toThrow();
  });

  it('verifies a token issued at login', async () => {
    const { authService } = await makeService();
    const registered = await authService.register('Alice', 'alice@test.com', 'password1', 'FARMER', 'Farm Co', TENANT_SLUG);
    const { token } = await authService.login({ email: 'alice@test.com', password: 'password1' });
    const payload = authService.verifyToken(token);
    expect(payload.actorId).toBe(registered.id);
    expect(payload.role).toBe('FARMER');
  });

  it('rejects a malformed token', async () => {
    const { authService } = await makeService();
    expect(() => authService.verifyToken('not-a-real-token')).toThrow();
  });

  it('exchanges a valid refresh token for a new access token', async () => {
    const { authService } = await makeService();
    await authService.register('Alice', 'alice@test.com', 'password1', 'FARMER', 'Farm Co', TENANT_SLUG);
    const { refreshToken } = await authService.login({ email: 'alice@test.com', password: 'password1' });
    const refreshed = await authService.refresh(refreshToken);
    expect(refreshed.token).toBeTruthy();
    expect(refreshed.refreshToken).not.toBe(refreshToken);
  });

  it('rejects reusing a refresh token after it has been rotated', async () => {
    const { authService } = await makeService();
    await authService.register('Alice', 'alice@test.com', 'password1', 'FARMER', 'Farm Co', TENANT_SLUG);
    const { refreshToken } = await authService.login({ email: 'alice@test.com', password: 'password1' });
    await authService.refresh(refreshToken);
    await expect(authService.refresh(refreshToken)).rejects.toThrow();
  });

  it('rejects a refresh token after logout revokes it', async () => {
    const { authService } = await makeService();
    await authService.register('Alice', 'alice@test.com', 'password1', 'FARMER', 'Farm Co', TENANT_SLUG);
    const { refreshToken } = await authService.login({ email: 'alice@test.com', password: 'password1' });
    await authService.logout(refreshToken);
    await expect(authService.refresh(refreshToken)).rejects.toThrow();
  });

  it('records login attempts in the audit log', async () => {
    const { authService, auditLogRepo, tenantRepo } = await makeService();
    const actor = await authService.register('Alice', 'alice@test.com', 'password1', 'FARMER', 'Farm Co', TENANT_SLUG);
    await authService.login({ email: 'alice@test.com', password: 'password1' });
    await authService.login({ email: 'alice@test.com', password: 'wrong' }).catch(() => {});

    const tenant = await tenantRepo.findBySlug(TENANT_SLUG);
    const { items } = await auditLogRepo.findPageByTenant(tenant!.id, 1, 20);
    expect(items.some((e) => e.action === 'LOGIN_SUCCESS')).toBe(true);
    expect(items.some((e) => e.action === 'LOGIN_FAILED')).toBe(true);
    expect(actor.tenantId).toBe(tenant!.id);
  });
});
