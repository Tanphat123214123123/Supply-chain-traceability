import { createActor, createTenant, useTestDatabase } from './helpers/testDb';

const getDb = useTestDatabase();

describe('StatsService.report — Reports dashboard aggregates', () => {
  it('computes KPIs, funnel, durations and breakdowns for the filtered window only', async () => {
    const t = getDb();
    const tenant = await createTenant(t);
    const farmer = await createActor(t, tenant, 'FARMER', { organization: 'HTX A' });
    const processor = await createActor(t, tenant, 'PROCESSOR', { organization: 'Nhà máy B' });
    const admin = await createActor(t, tenant, 'ADMIN');
    const svc = t.ctx.supplyChainService;

    const coffee = await svc.createBatch(farmer, { productName: 'C1', productType: 'Cà phê nhân xanh', origin: 'Cầu Đất', quantity: 2, unit: 'tấn' });
    const coffee2 = await svc.createBatch(farmer, { productName: 'C2', productType: 'Cà phê nhân xanh', origin: 'Bảo Lộc', quantity: 500, unit: 'kg' });
    const rice = await svc.createBatch(admin, { productName: 'R', productType: 'Lúa gạo', origin: 'Sóc Trăng', quantity: 10, unit: 'bao' });
    await svc.recordEvent(farmer, { batchId: coffee.id, stage: 'HARVEST', location: 'x', assignNextTo: processor.id });
    await svc.recordEvent(processor, { batchId: coffee.id, stage: 'PROCESSING', location: 'y', assignNextTo: admin.id });
    await svc.recordEvent(admin, { batchId: rice.id, stage: 'HARVEST', location: 'x' });
    await svc.recordEvent(admin, { batchId: rice.id, stage: 'PACKAGING', location: 'x' }); // STAGE_SKIPPED
    await svc.recallBatch(admin, coffee2.id, 'test');

    // Noise in another tenant must not leak.
    const outsider = await createActor(t, await createTenant(t), 'ADMIN');
    await svc.createBatch(outsider, { productName: 'X', productType: 'Cà phê nhân xanh', origin: 'x', quantity: 1, unit: 'kg' });

    const r = await t.ctx.statsService.report(tenant.id, {});
    expect(r.kpis.batches.value).toBe(3);
    expect(r.kpis.volumeKg.value).toBe(2500); // 2 t + 500 kg; "bao" can't be weighed
    expect(r.kpis.events.value).toBe(4);
    expect(r.kpis.recallRate.value).toBeCloseTo(100 / 3);
    expect(r.kpis.openAnomalies.value).toBe(1);
    expect(r.kpis.batches.previous).toBe(0);
    expect(r.kpis.batches.trend).toHaveLength(12);
    expect(r.kpis.batches.trend.reduce((a, b) => a + b, 0)).toBe(3);

    expect(r.funnel.map((f) => f.batches)).toEqual([2, 2, 1, 1, 0, 0]); // coffee reached PROCESSING, rice PACKAGING
    expect(r.stageDurations).toEqual([expect.objectContaining({ from: 'HARVEST', to: 'PROCESSING', samples: 1 })]);
    expect(r.byProductType).toEqual([
      { productType: 'Cà phê nhân xanh', batches: 2, volumeKg: 2500 },
      { productType: 'Lúa gạo', batches: 1, volumeKg: 0 },
    ]);
    expect(r.anomaliesByType).toEqual([{ type: 'STAGE_SKIPPED', open: 1, resolved: 0 }]);
    expect(r.organizations.map((o) => o.organization)).toEqual(expect.arrayContaining(['HTX A', 'Nhà máy B']));
    expect(r.monthly.reduce((a, m) => a + m.batches, 0)).toBe(3);
    expect(r.options.productTypes).toEqual(['Cà phê nhân xanh', 'Lúa gạo']);

    const onlyCoffee = await t.ctx.statsService.report(tenant.id, { productType: 'Cà phê nhân xanh', origin: 'cầu' });
    expect(onlyCoffee.kpis.batches.value).toBe(1);
    const past = await t.ctx.statsService.report(tenant.id, { from: new Date('2020-01-01'), to: new Date('2020-06-01') });
    expect(past.kpis.batches.value).toBe(0);
    expect(past.monthly).toHaveLength(5);
  });
});
