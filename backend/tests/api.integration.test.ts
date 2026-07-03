import request from 'supertest';
import { createApp } from '../src/app';
import { InMemoryActorRepo } from '../src/repository/memory/actorRepo';
import { InMemoryBatchRepo } from '../src/repository/memory/batchRepo';
import { InMemoryEventRepo } from '../src/repository/memory/eventRepo';
import { AuthService } from '../src/services/authService';
import { StatsService } from '../src/services/statsService';
import { SupplyChainService } from '../src/services/supplyChainService';
import { TraceService } from '../src/services/traceService';
import { AppContext } from '../src/bootstrap';

async function makeApp() {
  const actorRepo = new InMemoryActorRepo();
  const batchRepo = new InMemoryBatchRepo();
  const eventRepo = new InMemoryEventRepo();
  const authService = new AuthService(actorRepo, 'test-secret');
  const ctx: AppContext = {
    actorRepo,
    batchRepo,
    eventRepo,
    authService,
    supplyChainService: new SupplyChainService(batchRepo, eventRepo),
    traceService: new TraceService(batchRepo, eventRepo),
    statsService: new StatsService(batchRepo, eventRepo),
    usingPostgres: false,
  };
  const app = createApp(ctx, 'http://localhost:5173');

  await authService.register('Farmer', 'farmer@test.com', 'password1', 'FARMER', 'Farm');
  await authService.register('Admin', 'admin@test.com', 'password1', 'ADMIN', 'HQ');

  const farmerToken = (await authService.login({ email: 'farmer@test.com', password: 'password1' })).token;
  const adminToken = (await authService.login({ email: 'admin@test.com', password: 'password1' })).token;

  return { app, farmerToken, adminToken };
}

describe('API route wiring', () => {
  it('rejects unauthenticated requests to a protected route', async () => {
    const { app } = await makeApp();
    const res = await request(app).get('/api/batches');
    expect(res.status).toBe(401);
  });

  it('reaches the public trace route without auth', async () => {
    const { app, farmerToken } = await makeApp();
    const create = await request(app)
      .post('/api/batches')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ productName: 'X', productType: 'x', origin: 'x', quantity: 1, unit: 'kg' });
    const res = await request(app).get(`/api/trace/public/${create.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.stageCount).toBe(0);
  });

  it('rejects a non-ADMIN role from recalling a batch', async () => {
    const { app, farmerToken } = await makeApp();
    const create = await request(app)
      .post('/api/batches')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ productName: 'X', productType: 'x', origin: 'x', quantity: 1, unit: 'kg' });

    const recall = await request(app)
      .post(`/api/batches/${create.body.id}/recall`)
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ reason: 'test' });

    expect(recall.status).toBe(403);
  });

  it('allows an ADMIN to recall a batch', async () => {
    const { app, farmerToken, adminToken } = await makeApp();
    const create = await request(app)
      .post('/api/batches')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ productName: 'X', productType: 'x', origin: 'x', quantity: 1, unit: 'kg' });

    const recall = await request(app)
      .post(`/api/batches/${create.body.id}/recall`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'contaminated' });

    expect(recall.status).toBe(200);
    expect(recall.body.isRecalled).toBe(true);
  });

  it('returns 401 (not a generic 400) for invalid login credentials', async () => {
    const { app } = await makeApp();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'farmer@test.com', password: 'wrong-password' });
    expect(res.status).toBe(401);
  });

  it('returns 409 (not a generic 400) for a duplicate email on register', async () => {
    const { app } = await makeApp();
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Dup', email: 'farmer@test.com', password: 'password1', role: 'FARMER', organization: 'x' });
    expect(res.status).toBe(409);
  });
});
