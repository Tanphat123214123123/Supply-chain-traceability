import { v4 as uuidv4 } from 'uuid';
import { Actor, Batch } from '../src/domain/types';
import { hashOfDisclosure } from '../src/ledger/hashChain';
import { createActor, createTenant, TestDb, useTestDatabase } from './helpers/testDb';

const getDb = useTestDatabase();

/** A ~1 ha square (100 m × 100 m) near Bảo Lộc, offset per index so plots never overlap. */
function square(i: number) {
  const lon = 107.8 + (i % 20) * 0.002;
  const lat = 11.5 + Math.floor(i / 20) * 0.002;
  const d = 0.0009; // ≈ 100 m
  return {
    type: 'Polygon' as const,
    coordinates: [[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]],
  };
}

async function world(t: TestDb) {
  const tenant = await createTenant(t);
  const farmer = await createActor(t, tenant, 'FARMER', { organization: 'HTX Lộc Thành' });
  const processor = await createActor(t, tenant, 'PROCESSOR', { organization: 'Nhà máy Bảo Lộc' });
  const inspector = await createActor(t, tenant, 'INSPECTOR');
  const distributor = await createActor(t, tenant, 'DISTRIBUTOR');
  const admin = await createActor(t, tenant, 'ADMIN');
  return { tenant, farmer, processor, inspector, distributor, admin };
}

/** A harvested lot of fresh cherries from its own plot, handed to the processor. */
async function harvestLot(t: TestDb, farmer: Actor, processor: Actor, i: number, kg = 1000): Promise<Batch> {
  const plot = await t.ctx.plotService.create(farmer, { code: `L-${i}`, name: `Lô ${i}`, geometry: square(i) });
  const lot = await t.ctx.supplyChainService.createBatch(farmer, {
    productName: `Cà phê quả tươi hộ ${i}`,
    productType: 'Cà phê quả tươi',
    origin: `Lộc Thành, lô ${i}`,
    quantity: kg,
    unit: 'kg',
    plotId: plot.id,
  });
  await t.ctx.supplyChainService.recordEvent(farmer, { batchId: lot.id, stage: 'HARVEST', location: 'Lộc Thành', assignNextTo: processor.id });
  return (await t.ctx.supplyChainService.getBatch(farmer, lot.id));
}

describe('LineageService — end-to-end lineage (SPEC §3, WP4 acceptance)', () => {
  it('200 farms → collector lot → green beans → QC → packaging → 3 containers; each traces back to all 200 plots in < 500 ms', async () => {
    const t = getDb();
    const { tenant, farmer, processor, inspector, distributor } = await world(t);
    const retailer = await createActor(t, tenant, 'RETAILER');
    const farms: Batch[] = [];
    for (let i = 0; i < 200; i++) farms.push(await harvestLot(t, farmer, processor, i));

    // Collector/mill pools the cherries — and keeps custody (no hand-off given).
    const merge = await t.ctx.lineageService.createTransformation(processor, {
      kind: 'MERGE',
      stage: 'PROCESSING',
      location: 'Đại lý Lộc Thành',
      inputs: farms.map((f) => ({ lotId: f.id, quantity: 1000 })),
      outputs: [{ productName: 'Cà phê quả tươi gom', productType: 'Cà phê quả tươi', quantity: 200_000, unit: 'kg' }],
    });
    expect(merge.anomalies).toHaveLength(0);
    expect(merge.outputs[0].assignedToActorId).toBe(processor.id);

    // 200 t cherries → 40 t green beans (0.20 ≤ 0.22), handed to QC.
    const transform = await t.ctx.lineageService.createTransformation(processor, {
      kind: 'TRANSFORM',
      stage: 'PROCESSING',
      location: 'Nhà máy Bảo Lộc',
      data: { method: 'WET' },
      inputs: [{ lotId: merge.outputs[0].id, quantity: 200_000 }],
      outputs: [{ productName: 'Cà phê nhân xanh S18', productType: 'Cà phê nhân xanh', quantity: 40_000, unit: 'kg' }],
      assignNextTo: inspector.id,
    });
    expect(transform.anomalies).toHaveLength(0);
    const green = transform.outputs[0];
    await t.ctx.supplyChainService.recordEvent(inspector, {
      batchId: green.id,
      stage: 'QUALITY_CHECK',
      location: 'Trung tâm kiểm định',
      data: { result: 'PASS' },
      assignNextTo: processor.id,
    });
    await t.ctx.supplyChainService.recordEvent(processor, {
      batchId: green.id,
      stage: 'PACKAGING',
      location: 'Nhà máy Bảo Lộc',
      data: { packageType: 'BAG_60KG', packageCount: 666 },
      assignNextTo: distributor.id,
    });

    // The exporter splits into three containers.
    const split = await t.ctx.lineageService.createTransformation(distributor, {
      kind: 'SPLIT',
      stage: 'DISTRIBUTION',
      location: 'Cảng Cát Lái',
      inputs: [{ lotId: green.id, quantity: 40_000 }],
      outputs: [1, 2, 3].map((n) => ({
        productName: `Container ${n}`,
        productType: 'Cà phê nhân xanh',
        quantity: n === 3 ? 13_000 : 13_500,
        unit: 'kg',
      })),
      assignNextTo: retailer.id,
    });
    expect(split.outputs).toHaveLength(3);
    expect(split.anomalies).toHaveLength(0);

    for (const container of split.outputs) {
      const started = Date.now();
      const graph = await t.ctx.lineageService.lineage(distributor, container.id);
      const fc = await t.ctx.plotService.originFeatures(distributor, container.id);
      const elapsed = Date.now() - started;
      expect(new Set(graph.rootLotIds)).toEqual(new Set(farms.map((f) => f.id)));
      expect(fc.features).toHaveLength(200);
      expect(fc.features[0].properties).toMatchObject({ producer: 'HTX Lộc Thành', shape: 'polygon' });
      expect(elapsed).toBeLessThan(500);
    }

    // Downstream from one farm reaches all three containers.
    const fromFarm = await t.ctx.lineageService.lineage(farmer, farms[17].id);
    const reached = new Set(fromFarm.downstream.map((e) => e.toLotId));
    for (const c of split.outputs) expect(reached.has(c.id)).toBe(true);

    // Inputs are consumed; a fully consumed lot takes no further events.
    expect((await t.ctx.supplyChainService.getBatch(processor, farms[0].id)).consumedQuantity).toBe(1000);
    await expect(
      t.ctx.supplyChainService.recordEvent(processor, { batchId: farms[0].id, stage: 'PROCESSING', location: 'x' }),
    ).rejects.toThrow(/fully consumed/);

    // A container's first event commits to its input's chain head at split time (SPEC §1.2).
    const greenAtSplit = (await t.ctx.traceService.verifyPublic(green.id)).events;
    const [genesis] = (await t.ctx.traceService.verifyPublic(split.outputs[0].id)).events;
    expect(genesis.kind).toBe('SPLIT');
    expect(genesis.links).toEqual([
      expect.objectContaining({ lotId: green.id, quantity: 40_000, eventCount: 3, headHash: greenAtSplit[2].hash }),
    ]);
    expect(hashOfDisclosure(genesis.disclosure!)).toBe(genesis.hash);
  }, 180_000);
});

describe('LineageService — rules', () => {
  async function twoFarmLots(t: TestDb) {
    const w = await world(t);
    const a = await harvestLot(t, w.farmer, w.processor, 0);
    const b = await harvestLot(t, w.farmer, w.processor, 1);
    return { ...w, a, b };
  }

  it('flags a transform that yields more than the conversion factor allows', async () => {
    const t = getDb();
    const { processor, inspector, a } = await twoFarmLots(t);
    const r = await t.ctx.lineageService.createTransformation(processor, {
      kind: 'TRANSFORM',
      stage: 'PROCESSING',
      location: 'x',
      inputs: [{ lotId: a.id, quantity: 1000 }],
      outputs: [{ productName: 'Nhân xanh', productType: 'Cà phê nhân xanh', quantity: 400, unit: 'kg' }], // 0.4 > 0.22
      assignNextTo: inspector.id,
    });
    expect(r.anomalies).toHaveLength(1);
    expect(r.anomalies[0]).toMatchObject({ type: 'MASS_BALANCE_VIOLATION', severity: 'HIGH', batchId: r.outputs[0].id });
  });

  it('flags a merge whose output outweighs its inputs (units normalised)', async () => {
    const t = getDb();
    const { processor, inspector, a, b } = await twoFarmLots(t);
    const r = await t.ctx.lineageService.createTransformation(processor, {
      kind: 'MERGE',
      stage: 'PROCESSING',
      location: 'x',
      inputs: [
        { lotId: a.id, quantity: 1000 },
        { lotId: b.id, quantity: 1000 },
      ],
      outputs: [{ productName: 'Gom', productType: 'Cà phê quả tươi', quantity: 2.5, unit: 'tấn' }],
      assignNextTo: inspector.id,
    });
    expect(r.anomalies.map((x) => x.type)).toEqual(['MASS_BALANCE_VIOLATION']);
  });

  it('rejects taking more than remains, and a partial split leaves the rest usable', async () => {
    const t = getDb();
    const { processor, inspector, a } = await twoFarmLots(t);
    await expect(
      t.ctx.lineageService.createTransformation(processor, {
        kind: 'SPLIT',
        stage: 'PROCESSING',
        location: 'x',
        inputs: [{ lotId: a.id, quantity: 1001 }],
        outputs: [
          { productName: 'A', productType: 'Cà phê quả tươi', quantity: 500, unit: 'kg' },
          { productName: 'B', productType: 'Cà phê quả tươi', quantity: 500, unit: 'kg' },
        ],
        assignNextTo: inspector.id,
      }),
    ).rejects.toThrow(/Only 1000 kg/);

    await t.ctx.lineageService.createTransformation(processor, {
      kind: 'SPLIT',
      stage: 'PROCESSING',
      location: 'x',
      inputs: [{ lotId: a.id, quantity: 600 }],
      outputs: [
        { productName: 'A', productType: 'Cà phê quả tươi', quantity: 300, unit: 'kg' },
        { productName: 'B', productType: 'Cà phê quả tươi', quantity: 300, unit: 'kg' },
      ],
      assignNextTo: inspector.id,
    });
    const after = await t.ctx.supplyChainService.getBatch(processor, a.id);
    expect(after.consumedQuantity).toBe(600);
    expect((await t.ctx.supplyChainService.listPendingForActor(processor)).map((x) => x.id)).toContain(a.id);
  });

  it('enforces shape rules: merge ≥ 2 → 1, split 1 → ≥ 2, type kept unless transforming, no duplicates', async () => {
    const t = getDb();
    const { processor, inspector, a, b } = await twoFarmLots(t);
    const base = { stage: 'PROCESSING' as const, location: 'x', assignNextTo: inspector.id };
    const out = (type = 'Cà phê quả tươi', q = 100) => ({ productName: 'o', productType: type, quantity: q, unit: 'kg' });
    await expect(
      t.ctx.lineageService.createTransformation(processor, { ...base, kind: 'MERGE', inputs: [{ lotId: a.id, quantity: 1 }], outputs: [out()] }),
    ).rejects.toThrow(/at least two/);
    await expect(
      t.ctx.lineageService.createTransformation(processor, { ...base, kind: 'SPLIT', inputs: [{ lotId: a.id, quantity: 1 }], outputs: [out()] }),
    ).rejects.toThrow(/at least two/);
    await expect(
      t.ctx.lineageService.createTransformation(processor, {
        ...base,
        kind: 'MERGE',
        inputs: [
          { lotId: a.id, quantity: 1 },
          { lotId: b.id, quantity: 1 },
        ],
        outputs: [out('Cà phê nhân xanh')],
      }),
    ).rejects.toThrow(/keep the product type/);
    await expect(
      t.ctx.lineageService.createTransformation(processor, {
        ...base,
        kind: 'MERGE',
        inputs: [
          { lotId: a.id, quantity: 1 },
          { lotId: a.id, quantity: 1 },
        ],
        outputs: [out()],
      }),
    ).rejects.toThrow(/listed twice/);
  });

  it('respects roles, tenants and custody', async () => {
    const t = getDb();
    const { farmer, processor, inspector, a, b } = await twoFarmLots(t);
    const dto = {
      kind: 'MERGE' as const,
      stage: 'PROCESSING' as const,
      location: 'x',
      inputs: [
        { lotId: a.id, quantity: 1 },
        { lotId: b.id, quantity: 1 },
      ],
      outputs: [{ productName: 'o', productType: 'Cà phê quả tươi', quantity: 2, unit: 'kg' }],
      assignNextTo: inspector.id,
    };
    await expect(t.ctx.lineageService.createTransformation(farmer, dto)).rejects.toThrow(/cannot perform MERGE/);
    const otherProcessor = await createActor(t, { id: processor.tenantId } as never, 'PROCESSOR');
    await expect(t.ctx.lineageService.createTransformation(otherProcessor, dto)).rejects.toThrow(/not been handed off/);
    const outsider = await createActor(t, await createTenant(t), 'ADMIN');
    await expect(t.ctx.lineageService.createTransformation(outsider, dto)).rejects.toThrow(/Batch not found/);
  });

  it('a downstream link stops matching if an upstream chain is truncated', async () => {
    const t = getDb();
    const { processor, inspector, a, b } = await twoFarmLots(t);
    const r = await t.ctx.lineageService.createTransformation(processor, {
      kind: 'MERGE',
      stage: 'PROCESSING',
      location: 'x',
      inputs: [
        { lotId: a.id, quantity: 1000 },
        { lotId: b.id, quantity: 1000 },
      ],
      outputs: [{ productName: 'o', productType: 'Cà phê quả tươi', quantity: 2000, unit: 'kg' }],
      assignNextTo: inspector.id,
    });
    const [genesis] = (await t.ctx.traceService.verifyPublic(r.outputs[0].id)).events;
    const linkToA = genesis.links.find((l) => l.lotId === a.id)!;
    const chainA = (await t.ctx.traceService.verifyPublic(a.id)).events;
    expect(chainA[linkToA.eventCount - 1].hash).toBe(linkToA.headHash);
  });
});

describe('Hand-off without recording a stage', () => {
  it('the mill keeps the transformed lot, then hands it to QC; it shows in both task queues accordingly', async () => {
    const t = getDb();
    const { farmer, processor, inspector } = await world(t);
    const lot = await harvestLot(t, farmer, processor, 0);
    const r = await t.ctx.lineageService.createTransformation(processor, {
      kind: 'TRANSFORM',
      stage: 'PROCESSING',
      location: 'x',
      inputs: [{ lotId: lot.id, quantity: 1000 }],
      outputs: [{ productName: 'Nhân xanh', productType: 'Cà phê nhân xanh', quantity: 200, unit: 'kg' }],
    });
    const green = r.outputs[0];
    // Kept by the processor, whose role can't do QC: it waits in their queue for a hand-off.
    expect((await t.ctx.supplyChainService.listPendingForActor(processor)).map((b) => b.id)).toContain(green.id);
    expect((await t.ctx.supplyChainService.listPendingForActor(inspector)).map((b) => b.id)).not.toContain(green.id);

    await expect(t.ctx.supplyChainService.handOff(inspector, green.id, inspector.id)).rejects.toThrow(/not been handed off/);
    await expect(t.ctx.supplyChainService.handOff(processor, green.id, farmer.id)).rejects.toThrow(/cannot handle stage/);
    const handed = await t.ctx.supplyChainService.handOff(processor, green.id, inspector.id);
    expect(handed.assignedToActorId).toBe(inspector.id);
    expect(handed.currentStage).toBe('PROCESSING');
    expect((await t.ctx.supplyChainService.listPendingForActor(inspector)).map((b) => b.id)).toContain(green.id);
    expect((await t.ctx.supplyChainService.listPendingForActor(processor)).map((b) => b.id)).not.toContain(green.id);
    await t.ctx.supplyChainService.recordEvent(inspector, { batchId: green.id, stage: 'QUALITY_CHECK', location: 'Lab', assignNextTo: processor.id });
  });
});

describe('PlotService — SPEC §4', () => {
  it('computes polygon area on the ellipsoid and stores 6-decimal GeoJSON', async () => {
    const t = getDb();
    const { farmer } = await world(t);
    const plot = await t.ctx.plotService.create(farmer, { code: 'A1', name: 'Vườn A1', geometry: square(0) });
    expect(plot.shape).toBe('polygon');
    expect(plot.areaHa).toBeGreaterThan(0.9);
    expect(plot.areaHa).toBeLessThan(1.1);
    expect(plot.geometry.type).toBe('MultiPolygon');
  });

  it('accepts a point only with a declared area under 4 ha', async () => {
    const t = getDb();
    const { farmer } = await world(t);
    const pt = { type: 'Point' as const, coordinates: [108.123456, 11.654321] };
    await expect(t.ctx.plotService.create(farmer, { code: 'P1', name: 'p', geometry: pt })).rejects.toThrow(/declared area/);
    await expect(t.ctx.plotService.create(farmer, { code: 'P1', name: 'p', geometry: pt, declaredAreaHa: 5 })).rejects.toThrow(/4 ha/);
    const ok = await t.ctx.plotService.create(farmer, { code: 'P1', name: 'p', geometry: pt, declaredAreaHa: 1.5 });
    expect(ok).toMatchObject({ shape: 'point', areaHa: 1.5, geometry: { type: 'Point', coordinates: [108.123456, 11.654321] } });
  });

  it('rejects self-intersecting boundaries, plots outside Vietnam and overlaps', async () => {
    const t = getDb();
    const { farmer } = await world(t);
    const bowtie = { type: 'Polygon' as const, coordinates: [[[108, 11], [108.01, 11.01], [108.01, 11], [108, 11.01], [108, 11]]] };
    await expect(t.ctx.plotService.create(farmer, { code: 'X', name: 'x', geometry: bowtie })).rejects.toThrow(/not a valid polygon/);
    const paris = { type: 'Point' as const, coordinates: [2.35, 48.85] };
    await expect(t.ctx.plotService.create(farmer, { code: 'X', name: 'x', geometry: paris, declaredAreaHa: 1 })).rejects.toThrow(/outside Vietnam/);
    await t.ctx.plotService.create(farmer, { code: 'A', name: 'a', geometry: square(5) });
    await expect(t.ctx.plotService.create(farmer, { code: 'B', name: 'b', geometry: square(5) })).rejects.toThrow(/overlaps/);
    await expect(t.ctx.plotService.create(farmer, { code: 'A', name: 'a', geometry: square(6) })).rejects.toThrow(/code already/);
  });

  it('flags a 2 ha plot "selling" 30 t (SPEC §5 level 2)', async () => {
    const t = getDb();
    const { farmer } = await world(t);
    const d = 0.0013; // ≈ 140 m × 140 m ≈ 2 ha
    const geometry = { type: 'Polygon' as const, coordinates: [[[108.2, 11.8], [108.2 + d, 11.8], [108.2 + d, 11.8 + d], [108.2, 11.8 + d], [108.2, 11.8]]] };
    const plot = await t.ctx.plotService.create(farmer, { code: 'V2', name: 'Vườn 2ha', geometry });
    expect(plot.areaHa).toBeGreaterThan(1.9);
    expect(plot.areaHa).toBeLessThan(2.2);

    const lot = (q: number) =>
      t.ctx.supplyChainService.createBatch(farmer, {
        productName: 'Nhân xanh',
        productType: 'Cà phê nhân xanh',
        origin: 'x',
        quantity: q,
        unit: 'tấn',
        plotId: plot.id,
      });
    const fine = await lot(10); // 10 t ≤ 2 ha × 6 t
    expect((await t.ctx.traceService.trace(fine.id, 'forward', farmer)).anomalies).toHaveLength(0);
    const fraud = await lot(20); // 30 t > 12 t
    const anomalies = (await t.ctx.traceService.trace(fraud.id, 'forward', farmer)).anomalies;
    expect(anomalies).toEqual([expect.objectContaining({ type: 'MASS_BALANCE_VIOLATION', severity: 'HIGH' })]);
  });

  it('farmers only use (and see) their own plots', async () => {
    const t = getDb();
    const { farmer, admin } = await world(t);
    const other = await createActor(t, { id: farmer.tenantId } as never, 'FARMER');
    const plot = await t.ctx.plotService.create(other, { code: 'O1', name: 'o', geometry: square(9) });
    await expect(
      t.ctx.supplyChainService.createBatch(farmer, { productName: 'x', productType: 'x', origin: 'x', quantity: 1, unit: 'kg', plotId: plot.id }),
    ).rejects.toThrow(/not yours/);
    expect(await t.ctx.plotService.list(farmer)).toHaveLength(0);
    expect(await t.ctx.plotService.list(admin)).toHaveLength(1);
    await expect(
      t.ctx.supplyChainService.createBatch(farmer, { productName: 'x', productType: 'x', origin: 'x', quantity: 1, unit: 'kg', plotId: uuidv4() }),
    ).rejects.toThrow(/Plot not found/);
  });
});
