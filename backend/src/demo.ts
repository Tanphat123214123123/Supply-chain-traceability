import { STAGE_ORDER } from './domain/types';
import { InMemoryActorRepo } from './repository/memory/actorRepo';
import { InMemoryBatchRepo } from './repository/memory/batchRepo';
import { InMemoryEventRepo } from './repository/memory/eventRepo';
import { AuthService } from './services/authService';
import { SupplyChainService } from './services/supplyChainService';
import { TraceService } from './services/traceService';
import { verifyChain } from './ledger/hashChain';

async function main() {
  const actorRepo = new InMemoryActorRepo();
  const batchRepo = new InMemoryBatchRepo();
  const eventRepo = new InMemoryEventRepo();

  const authService = new AuthService(actorRepo, 'demo-secret');
  const supplyChain = new SupplyChainService(batchRepo, eventRepo);
  const traceService = new TraceService(batchRepo, eventRepo);

  console.log('=== TraceChain demo: end-to-end supply chain flow ===\n');

  const farmer = await authService.register('Nông dân Demo', 'farmer@local', 'demo1234', 'FARMER', 'Nông trại A');
  const processor = await authService.register('Chế biến Demo', 'processor@local', 'demo1234', 'PROCESSOR', 'Xưởng B');
  const inspector = await authService.register('Kiểm định Demo', 'inspector@local', 'demo1234', 'INSPECTOR', 'Trung tâm C');
  const distributor = await authService.register('Phân phối Demo', 'distributor@local', 'demo1234', 'DISTRIBUTOR', 'Logistics D');
  const retailer = await authService.register('Bán lẻ Demo', 'retailer@local', 'demo1234', 'RETAILER', 'Siêu thị E');

  const batch = await supplyChain.createBatch(farmer, {
    productName: 'Cà phê Arabica',
    productType: 'Nông sản',
    origin: 'Đà Lạt, Lâm Đồng',
    quantity: 500,
    unit: 'kg',
  });
  console.log(`1. Tạo lô hàng "${batch.productName}" — id ${batch.id}\n`);

  await supplyChain.recordEvent(farmer, { batchId: batch.id, stage: 'HARVEST', location: 'Đà Lạt' });
  await supplyChain.recordEvent(processor, { batchId: batch.id, stage: 'PROCESSING', location: 'Xưởng B' });
  await supplyChain.recordEvent(inspector, { batchId: batch.id, stage: 'QUALITY_CHECK', location: 'Trung tâm C' });
  await supplyChain.recordEvent(processor, { batchId: batch.id, stage: 'PACKAGING', location: 'Xưởng B' });
  await supplyChain.recordEvent(distributor, { batchId: batch.id, stage: 'DISTRIBUTION', location: 'Kho D' });
  await supplyChain.recordEvent(retailer, { batchId: batch.id, stage: 'RETAIL', location: 'Siêu thị E' });
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
  console.log(`   Chuỗi sau khi bị sửa vẫn hợp lệ? ${verifyChain(tampered)} (kỳ vọng: false)\n`);

  console.log(`5. Thứ tự các khâu chuẩn: ${STAGE_ORDER.join(' → ')}`);
  console.log('\n=== Demo hoàn tất ===');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
