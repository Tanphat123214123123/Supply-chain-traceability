import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createApp } from '../src/app';
import { createTenant, TEST_JWT_SECRET, useTestDatabase } from './helpers/testDb';

// Fixture actors are provisioned straight into this SAME pre-existing tenant —
// pre-existing matters: AuthService.provisionActor makes the first actor of a
// genuinely NEW tenant its ADMIN regardless of the role given. Actors that
// sign up over HTTP join it through an admin-issued invitation (joinViaInvite).
const TENANT_SLUG = 'test-tenant';

const getDb = useTestDatabase();

async function makeApp() {
  const t = getDb();
  await createTenant(t, TENANT_SLUG);
  const { authService } = t.ctx;
  const app = createApp(t.ctx, 'http://localhost:5173');

  const farmer = await authService.provisionActor('Farmer', 'farmer@test.com', 'password1', 'FARMER', 'Farm', TENANT_SLUG);
  const admin = await authService.provisionActor('Admin', 'admin@test.com', 'password1', 'ADMIN', 'HQ', TENANT_SLUG);

  const farmerLogin = await authService.login({ email: 'farmer@test.com', password: 'password1' });
  const adminLogin = await authService.login({ email: 'admin@test.com', password: 'password1' });

  return {
    app,
    farmer,
    admin,
    farmerToken: farmerLogin.token,
    adminToken: adminLogin.token,
  };
}

type App = Awaited<ReturnType<typeof makeApp>>['app'];

/** The real public sign-up path: an ADMIN issues an invitation, the newcomer redeems it. */
async function joinViaInvite(
  app: App,
  adminToken: string,
  person: { name: string; email: string; role: string; organization: string },
): Promise<string> {
  const invite = await request(app)
    .post('/api/admin/invitations')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ role: person.role });
  expect(invite.status).toBe(201);

  const register = await request(app).post('/api/auth/register').send({
    mode: 'invite',
    name: person.name,
    email: person.email,
    password: 'password1',
    organization: person.organization,
    inviteCode: invite.body.code,
  });
  expect(register.status).toBe(201);

  const login = await request(app).post('/api/auth/login').send({ email: person.email, password: 'password1' });
  return login.body.token as string;
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

  it('reaches the public full chain-verifier route without auth', async () => {
    const { app, farmerToken, admin } = await makeApp();
    const create = await request(app)
      .post('/api/batches')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ productName: 'X', productType: 'x', origin: 'x', quantity: 1, unit: 'kg' });
    await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ batchId: create.body.id, stage: 'HARVEST', location: 'x', assignNextTo: admin.id });

    const res = await request(app).get(`/api/trace/public/${create.body.id}/full`);
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.events).toHaveLength(1);
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

  it('allows an INSPECTOR (not just ADMIN) to recall a batch', async () => {
    const { app, farmerToken, adminToken } = await makeApp();
    const inspectorToken = await joinViaInvite(app, adminToken, {
      name: 'Inspector',
      email: 'inspector@test.com',
      role: 'INSPECTOR',
      organization: 'QA Lab',
    });

    const create = await request(app)
      .post('/api/batches')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ productName: 'X', productType: 'x', origin: 'x', quantity: 1, unit: 'kg' });

    const recall = await request(app)
      .post(`/api/batches/${create.body.id}/recall`)
      .set('Authorization', `Bearer ${inspectorToken}`)
      .send({ reason: 'failed quality check' });

    expect(recall.status).toBe(200);
    expect(recall.body.isRecalled).toBe(true);
  });

  it('rejects a non-FARMER, non-ADMIN role from creating a batch (a RETAILER cannot fabricate one out of thin air)', async () => {
    const { app, adminToken } = await makeApp();
    const retailerToken = await joinViaInvite(app, adminToken, {
      name: 'Retailer',
      email: 'retailer@test.com',
      role: 'RETAILER',
      organization: 'Shop',
    });

    const create = await request(app)
      .post('/api/batches')
      .set('Authorization', `Bearer ${retailerToken}`)
      .send({ productName: 'X', productType: 'x', origin: 'x', quantity: 1, unit: 'kg' });

    expect(create.status).toBe(403);
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
    const res = await request(app).post('/api/auth/register').send({
      mode: 'workspace',
      name: 'Dup',
      email: 'farmer@test.com',
      password: 'password1',
      organization: 'x',
      tenantSlug: 'dup-co',
      tenantName: 'Dup Co',
    });
    expect(res.status).toBe(409);
  });

  it('no longer lets anyone join an existing workspace by its slug with a self-chosen role', async () => {
    const { app } = await makeApp();
    // The old request shape: join by slug, pick INSPECTOR (which can recall batches).
    const legacy = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Intruder', email: 'intruder@test.com', password: 'password1', role: 'INSPECTOR', organization: 'x', tenantSlug: TENANT_SLUG });
    expect(legacy.status).toBe(400);

    // Founding a "new" workspace on a taken slug is a conflict, never a silent join.
    const takenSlug = await request(app).post('/api/auth/register').send({
      mode: 'workspace',
      name: 'Intruder',
      email: 'intruder@test.com',
      password: 'password1',
      organization: 'x',
      tenantSlug: TENANT_SLUG,
      tenantName: 'Mine now',
    });
    expect(takenSlug.status).toBe(409);

    const login = await request(app).post('/api/auth/login').send({ email: 'intruder@test.com', password: 'password1' });
    expect(login.status).toBe(401);
  });

  it('grants the invitation\'s role, and each invitation works exactly once', async () => {
    const { app, adminToken } = await makeApp();
    const invite = await request(app)
      .post('/api/admin/invitations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'DISTRIBUTOR', email: 'driver@test.com' });
    expect(invite.status).toBe(201);
    expect(invite.body.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    // Public preview — what the sign-up form shows. Lower-case, dash-less input still matches.
    const preview = await request(app).get(`/api/auth/invitations/${invite.body.code.replace(/-/g, '').toLowerCase()}`);
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ role: 'DISTRIBUTOR', tenantName: `Tenant ${TENANT_SLUG}` });

    const base = { mode: 'invite', password: 'password1', organization: 'Trucks', inviteCode: invite.body.code };

    // Email-bound invitation: someone else holding the code can't use it.
    const wrongEmail = await request(app).post('/api/auth/register').send({ ...base, name: 'X', email: 'other@test.com' });
    expect(wrongEmail.status).toBe(403);

    const ok = await request(app).post('/api/auth/register').send({ ...base, name: 'Driver', email: 'driver@test.com' });
    expect(ok.status).toBe(201);
    expect(ok.body.role).toBe('DISTRIBUTOR');

    const reuse = await request(app).post('/api/auth/register').send({ ...base, name: 'Again', email: 'DRIVER2@test.com' });
    expect(reuse.status).toBe(404);
    expect((await request(app).get(`/api/auth/invitations/${invite.body.code}`)).status).toBe(404);
  });

  it('lets an ADMIN revoke an unused invitation, and only ADMIN may issue them', async () => {
    const { app, adminToken, farmerToken } = await makeApp();
    const forbidden = await request(app)
      .post('/api/admin/invitations')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ role: 'ADMIN' });
    expect(forbidden.status).toBe(403);

    const invite = await request(app)
      .post('/api/admin/invitations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'PROCESSOR' });
    const revoke = await request(app)
      .delete(`/api/admin/invitations/${invite.body.invitation.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(revoke.status).toBe(200);
    expect(revoke.body.revokedAt).toBeTruthy();

    const list = await request(app).get('/api/admin/invitations').set('Authorization', `Bearer ${adminToken}`);
    expect(list.body).toHaveLength(1);
    expect((await request(app).get(`/api/auth/invitations/${invite.body.code}`)).status).toBe(404);
  });

  it('rejects a batch with a negative quantity (Zod validation)', async () => {
    const { app, farmerToken } = await makeApp();
    const res = await request(app)
      .post('/api/batches')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ productName: 'X', productType: 'x', origin: 'x', quantity: -5, unit: 'kg' });
    expect(res.status).toBe(400);
  });

  it('returns a paginated batch list', async () => {
    const { app, farmerToken } = await makeApp();
    await request(app)
      .post('/api/batches')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ productName: 'X', productType: 'x', origin: 'x', quantity: 1, unit: 'kg' });

    const res = await request(app).get('/api/batches?page=1&pageSize=10').set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.total).toBe(1);
  });

  it('returns batches pending for the caller role', async () => {
    const { app, farmerToken } = await makeApp();
    await request(app)
      .post('/api/batches')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ productName: 'X', productType: 'x', origin: 'x', quantity: 1, unit: 'kg' });

    const res = await request(app).get('/api/batches/pending').set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1); // fresh batch, HARVEST is next, FARMER can do it
  });

  it('rejects an unrelated actor of the right role from recording an event on someone else\'s batch', async () => {
    const { app, farmerToken, adminToken } = await makeApp();
    const create = await request(app)
      .post('/api/batches')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ productName: 'X', productType: 'x', origin: 'x', quantity: 1, unit: 'kg' });

    const randomProcessorToken = await joinViaInvite(app, adminToken, {
      name: 'Random Processor',
      email: 'randproc@test.com',
      role: 'PROCESSOR',
      organization: 'Unrelated Co',
    });

    // This processor has never been handed this batch — a bare role match
    // must not be enough to let them record an event on it.
    const res = await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${randomProcessorToken}`)
      .send({ batchId: create.body.id, stage: 'PROCESSING', location: 'Random warehouse' });
    expect(res.status).toBe(403);
  });

  it('hands custody off from one actor to the next, and requires assignNextTo to do so', async () => {
    const { app, farmerToken, admin, adminToken } = await makeApp();
    const processorToken = await joinViaInvite(app, adminToken, {
      name: 'Processor',
      email: 'processor-e2e@test.com',
      role: 'PROCESSOR',
      organization: 'Xưởng',
    });
    const processorId = (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${processorToken}`)).body.id;

    const create = await request(app)
      .post('/api/batches')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ productName: 'X', productType: 'x', origin: 'x', quantity: 1, unit: 'kg' });

    // The processor can't touch it yet — HARVEST hasn't been handed to them.
    const tooEarly = await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${processorToken}`)
      .send({ batchId: create.body.id, stage: 'PROCESSING', location: 'x' });
    expect(tooEarly.status).toBe(403);

    // Farmer must name who's next to complete HARVEST.
    const missingHandoff = await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ batchId: create.body.id, stage: 'HARVEST', location: 'x' });
    expect(missingHandoff.status).toBe(409);

    const harvest = await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ batchId: create.body.id, stage: 'HARVEST', location: 'x', assignNextTo: processorId });
    expect(harvest.status).toBe(201);

    // Now the processor (and only the processor) can record PROCESSING.
    const farmerLockedOut = await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ batchId: create.body.id, stage: 'HARVEST', location: 'x' });
    expect(farmerLockedOut.status).toBe(403);

    const processing = await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${processorToken}`)
      .send({ batchId: create.body.id, stage: 'PROCESSING', location: 'x', assignNextTo: admin.id });
    expect(processing.status).toBe(201);
  });

  it('exports batches as CSV', async () => {
    const { app, farmerToken } = await makeApp();
    await request(app)
      .post('/api/batches')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ productName: 'X', productType: 'x', origin: 'x', quantity: 1, unit: 'kg' });

    const res = await request(app).get('/api/batches/export?format=csv').set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv; charset=utf-8/);
    // RFC 4180: CRLF records, quoted fields; UTF-8 BOM so spreadsheet apps detect the encoding.
    expect(res.text.startsWith('﻿"id","productName"')).toBe(true);
    expect(res.text.split('\r\n')).toHaveLength(3); // header, one row, trailing CRLF
    expect(res.text).toContain('"X"');
  });

  it('exports a header-only CSV (not an empty body) when nothing matches', async () => {
    const { app, farmerToken } = await makeApp();
    const res = await request(app)
      .get('/api/batches/export?format=csv&origin=nowhere')
      .set('Authorization', `Bearer ${farmerToken}`);
    expect(res.text).toBe('﻿"id","productName","productType","origin","quantity","unit","currentStage","isRecalled","createdAt"\r\n');
  });

  it('exchanges the httpOnly refresh cookie for a new access token', async () => {
    const { app } = await makeApp();
    // Use a supertest agent so the Set-Cookie from login is carried into the
    // next request — the refresh token now travels only as an httpOnly
    // cookie, never in the JSON body.
    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login').send({ email: 'farmer@test.com', password: 'password1' });
    expect(login.body.refreshToken).toBeUndefined();
    expect(login.headers['set-cookie']?.[0]).toContain('refreshToken=');

    const res = await agent.post('/api/auth/refresh');
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  it('rejects a refresh attempt with no cookie', async () => {
    const { app } = await makeApp();
    const res = await request(app).post('/api/auth/refresh');
    expect(res.status).toBe(401);
  });

  it('returns my profile via /auth/me', async () => {
    const { app, farmerToken } = await makeApp();
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('farmer@test.com');
    expect(res.body.passwordHash).toBeUndefined();
  });

  it('updates my profile', async () => {
    const { app, farmerToken } = await makeApp();
    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ organization: 'New Farm Co' });
    expect(res.status).toBe(200);
    expect(res.body.organization).toBe('New Farm Co');
  });

  it('changes my password and rejects the wrong current password', async () => {
    const { app, farmerToken } = await makeApp();
    const bad = await request(app)
      .patch('/api/auth/me/password')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ currentPassword: 'wrong', newPassword: 'newpassword1' });
    expect(bad.status).toBe(401);

    const good = await request(app)
      .patch('/api/auth/me/password')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ currentPassword: 'password1', newPassword: 'newpassword1' });
    expect(good.status).toBe(204);
  });

  it('lists and revokes my sessions', async () => {
    const { app, farmerToken } = await makeApp();
    const list = await request(app).get('/api/auth/sessions').set('Authorization', `Bearer ${farmerToken}`);
    expect(list.status).toBe(200);
    expect(list.body.length).toBeGreaterThan(0);

    const revoke = await request(app)
      .delete(`/api/auth/sessions/${list.body[0].token}`)
      .set('Authorization', `Bearer ${farmerToken}`);
    expect(revoke.status).toBe(204);
  });

  it('rejects non-ADMIN roles from viewing the audit log', async () => {
    const { app, farmerToken } = await makeApp();
    const res = await request(app).get('/api/admin/audit-logs').set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(403);
  });

  it('allows ADMIN to view the audit log', async () => {
    const { app, adminToken } = await makeApp();
    const res = await request(app).get('/api/admin/audit-logs').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it('lists and resolves anomalies (ADMIN only)', async () => {
    const { app, farmerToken, adminToken } = await makeApp();
    const create = await request(app)
      .post('/api/batches')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ productName: 'X', productType: 'x', origin: 'x', quantity: 1, unit: 'kg' });
    // Recorded via ADMIN (exempt from the custody hand-off requirement) since
    // this test is about anomaly detection, not chain-of-custody enforcement —
    // after the first HARVEST hands off to a specific next actor, the
    // original farmer would no longer be its custodian for a second call.
    await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ batchId: create.body.id, stage: 'HARVEST', location: 'x' });
    await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ batchId: create.body.id, stage: 'HARVEST', location: 'x' }); // duplicate -> anomaly

    const forbidden = await request(app).get('/api/admin/anomalies').set('Authorization', `Bearer ${farmerToken}`);
    expect(forbidden.status).toBe(403);

    const list = await request(app).get('/api/admin/anomalies').set('Authorization', `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(list.body.items.length).toBeGreaterThan(0);

    const anomalyId = list.body.items[0].id;
    const resolve = await request(app)
      .patch(`/api/admin/anomalies/${anomalyId}/resolve`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(resolve.status).toBe(200);
    expect(resolve.body.resolved).toBe(true);
  });

  it('lists actors (any authenticated role) but only lets ADMIN change status', async () => {
    const { app, farmerToken, adminToken, farmer } = await makeApp();
    const list = await request(app).get('/api/actors').set('Authorization', `Bearer ${farmerToken}`);
    expect(list.status).toBe(200);
    expect(list.body.length).toBeGreaterThanOrEqual(2);

    const forbidden = await request(app)
      .patch(`/api/actors/${farmer.id}/status`)
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ isActive: false });
    expect(forbidden.status).toBe(403);

    const allowed = await request(app)
      .patch(`/api/actors/${farmer.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false });
    expect(allowed.status).toBe(200);
    expect(allowed.body.isActive).toBe(false);
  });

  it('lets an ADMIN change another actor\'s role, but not their own', async () => {
    const { app, farmerToken, adminToken, farmer, admin } = await makeApp();

    const promoteOther = await request(app)
      .patch(`/api/actors/${farmer.id}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'DISTRIBUTOR' });
    expect(promoteOther.status).toBe(200);
    expect(promoteOther.body.role).toBe('DISTRIBUTOR');

    const selfChange = await request(app)
      .patch(`/api/actors/${admin.id}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'FARMER' });
    expect(selfChange.status).toBe(403);

    const nonAdminAttempt = await request(app)
      .patch(`/api/actors/${admin.id}/role`)
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ role: 'ADMIN' });
    expect(nonAdminAttempt.status).toBe(403);
  });

  it('groups actors into partner organizations', async () => {
    const { app, farmerToken } = await makeApp();
    const res = await request(app).get('/api/actors/partners').set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.some((p: { organization: string }) => p.organization === 'Farm')).toBe(true);
  });

  it('returns an actor detail with the batches they have touched', async () => {
    const { app, farmerToken, farmer } = await makeApp();
    const create = await request(app)
      .post('/api/batches')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ productName: 'X', productType: 'x', origin: 'x', quantity: 1, unit: 'kg' });

    const res = await request(app).get(`/api/actors/${farmer.id}`).set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.batches.some((b: { id: string }) => b.id === create.body.id)).toBe(true);
  });

  it('lists recent notifications combining anomalies and recalls', async () => {
    const { app, farmerToken, adminToken } = await makeApp();
    const create = await request(app)
      .post('/api/batches')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ productName: 'X', productType: 'x', origin: 'x', quantity: 1, unit: 'kg' });
    await request(app)
      .post(`/api/batches/${create.body.id}/recall`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'contaminated' });

    const res = await request(app).get('/api/notifications').set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.some((n: { kind: string }) => n.kind === 'RECALL')).toBe(true);
  });

  it('serves the OpenAPI spec', async () => {
    const { app } = await makeApp();
    const res = await request(app).get('/api/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.info.title).toBe('TraceChain API');
  });

  it('reports database health', async () => {
    const { app } = await makeApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', database: 'ok' });
  });

  it('answers 404 (never 500) for malformed ids on public and authenticated routes', async () => {
    const { app, farmerToken } = await makeApp();
    for (const path of ['/api/trace/public/not-a-uuid', "/api/trace/public/'%20OR%201=1--/full"]) {
      expect((await request(app).get(path)).status).toBe(404);
    }
    const res = await request(app).get('/api/batches/xyz').set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(404);
  });

  it('rejects access tokens minted before tenantId was part of the payload', async () => {
    const { app, farmer } = await makeApp();
    const oldStyle = jwt.sign({ actorId: farmer.id, role: farmer.role, email: farmer.email }, TEST_JWT_SECRET);
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${oldStyle}`);
    expect(res.status).toBe(401);
  });

  it('returns 409 when recalling an already-recalled batch', async () => {
    const { app, farmerToken, adminToken } = await makeApp();
    const create = await request(app)
      .post('/api/batches')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ productName: 'X', productType: 'x', origin: 'x', quantity: 1, unit: 'kg' });
    const first = await request(app)
      .post(`/api/batches/${create.body.id}/recall`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'a' });
    expect(first.status).toBe(200);
    const second = await request(app)
      .post(`/api/batches/${create.body.id}/recall`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'b' });
    expect(second.status).toBe(409);
  });

  it('public chain verifier exposes salts and head status, and hides tenant ids', async () => {
    const { app, farmerToken, admin } = await makeApp();
    const create = await request(app)
      .post('/api/batches')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ productName: 'X', productType: 'x', origin: 'x', quantity: 1, unit: 'kg' });
    await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ batchId: create.body.id, stage: 'HARVEST', location: 'x', assignNextTo: admin.id });

    const res = await request(app).get(`/api/trace/public/${create.body.id}/full`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ valid: true, headMatches: true, legacyEventCount: 0 });
    expect(res.body.events[0]).toMatchObject({ hashVersion: 2 });
    expect(res.body.events[0].salt).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.events[0].tenantId).toBeUndefined();
  });

  describe('tenant isolation', () => {
    it('keeps a batch, its actors, and its stats invisible to a completely different tenant', async () => {
      const { app, farmerToken, farmer } = await makeApp();
      const create = await request(app)
        .post('/api/batches')
        .set('Authorization', `Bearer ${farmerToken}`)
        .send({ productName: 'Tenant A Batch', productType: 'x', origin: 'x', quantity: 1, unit: 'kg' });
      expect(create.status).toBe(201);

      // A second tenant that has never heard of the first one — founded
      // through the public "new workspace" sign-up.
      const outsiderRegister = await request(app)
        .post('/api/auth/register')
        .send({
          mode: 'workspace',
          name: 'Outsider Admin',
          email: 'outsider@other-tenant.test',
          password: 'password1',
          organization: 'Other Co',
          tenantSlug: 'other-tenant',
          tenantName: 'Other Tenant Inc',
        });
      expect(outsiderRegister.status).toBe(201);
      expect(outsiderRegister.body.role).toBe('ADMIN');
      const outsiderLogin = await request(app)
        .post('/api/auth/login')
        .send({ email: 'outsider@other-tenant.test', password: 'password1' });
      const outsiderToken = outsiderLogin.body.token as string;

      // Batch list: the outsider's tenant has zero batches, not tenant A's one.
      const outsiderBatches = await request(app).get('/api/batches').set('Authorization', `Bearer ${outsiderToken}`);
      expect(outsiderBatches.status).toBe(200);
      expect(outsiderBatches.body.total).toBe(0);

      // Direct batch lookup by ID: 404, not 403 — existence itself shouldn't leak.
      const outsiderBatchDetail = await request(app)
        .get(`/api/batches/${create.body.id}`)
        .set('Authorization', `Bearer ${outsiderToken}`);
      expect(outsiderBatchDetail.status).toBe(404);

      // Authenticated trace lookup: also 404 across tenants.
      const outsiderTrace = await request(app)
        .get(`/api/trace/${create.body.id}`)
        .set('Authorization', `Bearer ${outsiderToken}`);
      expect(outsiderTrace.status).toBe(404);

      // Actor directory: the outsider (an ADMIN) sees only their own tenant's actors.
      const outsiderActors = await request(app).get('/api/actors').set('Authorization', `Bearer ${outsiderToken}`);
      expect(outsiderActors.status).toBe(200);
      expect(outsiderActors.body.some((a: { id: string }) => a.id === farmer.id)).toBe(false);

      // Stats: the outsider's dashboard shows 0, unaffected by tenant A's batch.
      const outsiderStats = await request(app).get('/api/stats/overview').set('Authorization', `Bearer ${outsiderToken}`);
      expect(outsiderStats.status).toBe(200);
      expect(outsiderStats.body.totalBatches).toBe(0);

      // And the reverse still holds: tenant A's own view is unaffected.
      const farmerBatches = await request(app).get('/api/batches').set('Authorization', `Bearer ${farmerToken}`);
      expect(farmerBatches.body.total).toBe(1);
    });
  });
});
