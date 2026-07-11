import { v4 as uuidv4 } from 'uuid';
import { STAGE_ORDER } from './domain/types';
import { InMemoryActorRepo } from './repository/memory/actorRepo';
import { InMemoryAnomalyRepo } from './repository/memory/anomalyRepo';
import { InMemoryAuditLogRepo } from './repository/memory/auditLogRepo';
import { InMemoryBatchRepo } from './repository/memory/batchRepo';
import { InMemoryEventRepo } from './repository/memory/eventRepo';
import { InMemoryRefreshTokenRepo } from './repository/memory/refreshTokenRepo';
import { InMemoryTenantRepo } from './repository/memory/tenantRepo';
import { AuthService } from './services/authService';
import { SupplyChainService } from './services/supplyChainService';
import { TraceService } from './services/traceService';
import { verifyChain } from './ledger/hashChain';

async function main() {
  const actorRepo = new InMemoryActorRepo();
  const batchRepo = new InMemoryBatchRepo();
  const eventRepo = new InMemoryEventRepo();
  const anomalyRepo = new InMemoryAnomalyRepo();
  const auditLogRepo = new InMemoryAuditLogRepo();
  const refreshTokenRepo = new InMemoryRefreshTokenRepo();
  const tenantRepo = new InMemoryTenantRepo();

  const signingKey = 'demo-signing-key';
  const authService = new AuthService(actorRepo, refreshTokenRepo, auditLogRepo, tenantRepo, 'demo-secret');
  const supplyChain = new SupplyChainService(batchRepo, eventRepo, anomalyRepo, auditLogRepo, actorRepo, signingKey);
  const traceService = new TraceService(batchRepo, eventRepo, anomalyRepo, signingKey);

  console.log('=== TraceChain demo: end-to-end supply chain flow ===\n');

  // Pre-create the tenant so the first registrant below keeps their real
  // FARMER role — AuthService.register would otherwise make the first
  // registrant of a brand-new tenant its ADMIN.
  await tenantRepo.create({ id: uuidv4(), slug: 'cli-demo', name: 'CLI Demo', createdAt: new Date() });

  const farmer = await authService.register('Nông dân Demo', 'farmer@local', 'demo1234', 'FARMER', 'Nông trại A', 'cli-demo');
  const processor = await authService.register('Chế biến Demo', 'processor@local', 'demo1234', 'PROCESSOR', 'Xưởng B', 'cli-demo');
  const inspector = await authService.register('Kiểm định Demo', 'inspector@local', 'demo1234', 'INSPECTOR', 'Trung tâm C', 'cli-demo');
  const distributor = await authService.register('Phân phối Demo', 'distributor@local', 'demo1234', 'DISTRIBUTOR', 'Logistics D', 'cli-demo');
  const retailer = await authService.register('Bán lẻ Demo', 'retailer@local', 'demo1234', 'RETAILER', 'Siêu thị E', 'cli-demo');

  const batch = await supplyChain.createBatch(farmer, {
    productName: 'Cà phê Arabica',
    productType: 'Nông sản',
    origin: 'Đà Lạt, Lâm Đồng',
    quantity: 500,
    unit: 'kg',
  });
  console.log(`1. Tạo lô hàng "${batch.productName}" — id ${batch.id}\n`);

  // Each stage hands off custody to whoever records the next one — a batch can
  // only be acted on by its current assignee (or ADMIN), so every non-terminal
  // event names who's next.
  await supplyChain.recordEvent(farmer, { batchId: batch.id, stage: 'HARVEST', location: 'Đà Lạt', assignNextTo: processor.id });
  await supplyChain.recordEvent(processor, { batchId: batch.id, stage: 'PROCESSING', location: 'Xưởng B', assignNextTo: inspector.id });
  await supplyChain.recordEvent(inspector, { batchId: batch.id, stage: 'QUALITY_CHECK', location: 'Trung tâm C', assignNextTo: processor.id });
  await supplyChain.recordEvent(processor, { batchId: batch.id, stage: 'PACKAGING', location: 'Xưởng B', assignNextTo: distributor.id });
  await supplyChain.recordEvent(distributor, { batchId: batch.id, stage: 'DISTRIBUTION', location: 'Kho D', assignNextTo: retailer.id });
  await supplyChain.recordEvent(retailer, { batchId: batch.id, stage: 'RETAIL', location: 'Siêu thị E' }); // terminal — no hand-off needed
  console.log('2. Ghi 6 sự kiện qua toàn bộ chuỗi cung ứng (thu hoạch → bán lẻ)\n');

  const result = await traceService.trace(batch.id);
  console.log(`3. Truy xuất thuận chiều: ${result.events.length} sự kiện, chuỗi hợp lệ = ${result.isValid}`);
  for (const e of result.events) {
    console.log(`   seq ${e.sequenceNumber} [${e.stage}] hash=${e.hash.slice(0, 12)}… prevHash=${e.prevHash.slice(0, 12)}…`);
  }
  console.log();

  console.log('4. Giả lập can thiệp dữ liệu (sửa location của 1 sự kiện đã ghi)...');
  const tampered = [...result.events];
  tampered[2] = { ...tampered[2], location: 'ĐỊA ĐIỂM BỊ SỬA' };
  console.log(`   Chuỗi sau khi bị sửa vẫn hợp lệ? ${verifyChain(tampered, signingKey)} (kỳ vọng: false)\n`);

  console.log(`5. Thứ tự các khâu chuẩn: ${STAGE_ORDER.join(' → ')}`);
  console.log('\n=== Demo hoàn tất ===');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
