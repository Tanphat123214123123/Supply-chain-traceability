import { InMemoryActorRepo } from '../src/repository/memory/actorRepo';
import { AuthService } from '../src/services/authService';

function makeService() {
  const actorRepo = new InMemoryActorRepo();
  const authService = new AuthService(actorRepo, 'test-secret', 3600);
  return { actorRepo, authService };
}

describe('AuthService', () => {
  it('registers a new actor with a hashed password', async () => {
    const { authService } = makeService();
    const actor = await authService.register('Alice', 'alice@test.com', 'password1', 'FARMER', 'Farm Co');
    expect(actor.email).toBe('alice@test.com');
    expect(actor.passwordHash).not.toBe('password1');
  });

  it('rejects registering a duplicate email', async () => {
    const { authService } = makeService();
    await authService.register('Alice', 'alice@test.com', 'password1', 'FARMER', 'Farm Co');
    await expect(
      authService.register('Alice 2', 'alice@test.com', 'password2', 'FARMER', 'Farm Co'),
    ).rejects.toThrow();
  });

  it('logs in with correct credentials and returns a token + actor without passwordHash', async () => {
    const { authService } = makeService();
    await authService.register('Alice', 'alice@test.com', 'password1', 'FARMER', 'Farm Co');
    const { token, actor } = await authService.login({ email: 'alice@test.com', password: 'password1' });
    expect(token).toBeTruthy();
    expect((actor as Record<string, unknown>).passwordHash).toBeUndefined();
  });

  it('rejects login with wrong password', async () => {
    const { authService } = makeService();
    await authService.register('Alice', 'alice@test.com', 'password1', 'FARMER', 'Farm Co');
    await expect(authService.login({ email: 'alice@test.com', password: 'wrong' })).rejects.toThrow();
  });

  it('rejects login for unknown email', async () => {
    const { authService } = makeService();
    await expect(authService.login({ email: 'nobody@test.com', password: 'x' })).rejects.toThrow();
  });

  it('verifies a token issued at login', async () => {
    const { authService } = makeService();
    const registered = await authService.register('Alice', 'alice@test.com', 'password1', 'FARMER', 'Farm Co');
    const { token } = await authService.login({ email: 'alice@test.com', password: 'password1' });
    const payload = authService.verifyToken(token);
    expect(payload.actorId).toBe(registered.id);
    expect(payload.role).toBe('FARMER');
  });

  it('rejects a malformed token', () => {
    const { authService } = makeService();
    expect(() => authService.verifyToken('not-a-real-token')).toThrow();
  });
});
