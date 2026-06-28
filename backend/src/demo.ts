import { bootstrap } from './bootstrap';
import { SupplyChainStage } from './domain/types';

async function main(): Promise<void> {
  console.log('=== TraceChain End-to-End Demo ===\n');

  const { authService, supplyChainService } = await bootstrap('demo-secret');

  const [farmer, processor, inspector, distributor, retailer] = await Promise.all([
    authService.login({ email: 'farmer@demo.com',      password: 'demo1234' }),
    authService.login({ email: 'processor@demo.com',   password: 'demo1234' }),
    authService.login({ email: 'inspector@demo.com',   password: 'demo1234' }),
    authService.login({ email: 'distributor@demo.com', password: 'demo1234' }),
    authService.login({ email: 'retailer@demo.com',    password: 'demo1234' }),
  ]);
  console.log('All actors authenticated\n');

  const batch = await supplyChainService.createBatch(
    {
      productName: 'Organic Tomatoes',
      productType: 'Vegetable',
      origin: 'Da Lat, Vietnam',
      quantity: 500,
      unit: 'kg',
      metadata: { variety: 'Cherry', season: '2025-Q1' },
    },
    farmer.actor.id,
  );
  console.log(`Batch created: ${batch.id}`);
  console.log(`  ${batch.productName}  ${batch.quantity} ${batch.unit}  from ${batch.origin}\n`);

  const stages: Array<{ actorId: string; stage: SupplyChainStage; location: string }> = [
    { actorId: farmer.actor.id,      stage: SupplyChainStage.HARVEST,        location: 'Da Lat Farm' },
    { actorId: processor.actor.id,   stage: SupplyChainStage.PROCESSING,     location: 'Bien Hoa Factory' },
    { actorId: inspector.actor.id,   stage: SupplyChainStage.QUALITY_CHECK,  location: 'QC Lab, HCMC' },
    { actorId: processor.actor.id,   stage: SupplyChainStage.PACKAGING,      location: 'Packaging Center' },
    { actorId: distributor.actor.id, stage: SupplyChainStage.DISTRIBUTION,   location: 'Distribution Hub, HCMC' },
    { actorId: retailer.actor.id,    stage: SupplyChainStage.RETAIL,         location: 'FreshMart, District 1' },
  ];

  for (const s of stages) {
    const ev = await supplyChainService.recordEvent(
      { batchId: batch.id, stage: s.stage, location: s.location },
      s.actorId,
    );
    console.log(`  [seq ${ev.sequenceNumber}] ${s.stage.padEnd(15)} hash: ${ev.hash.slice(0, 20)}...`);
  }

  console.log('\n--- Forward trace ---');
  const trace = await supplyChainService.traceForward(batch.id);
  console.log(`Chain valid : ${trace.isValid}`);
  console.log(`Events      : ${trace.events.length}`);
  console.log(`Anomalies   : ${trace.anomalies.length}`);

  console.log('\n--- Hash chain ---');
  for (const ev of trace.events) {
    console.log(`  seq ${ev.sequenceNumber}  ${ev.stage.padEnd(15)} ← ${ev.prevHash.slice(0, 12)}...  →  ${ev.hash.slice(0, 12)}...`);
  }

  console.log('\n=== Demo complete ===');
}

main().catch(console.error);
