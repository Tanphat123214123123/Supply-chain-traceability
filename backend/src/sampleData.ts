import { Actor, SupplyChainStage } from './domain/types';
import { IActorRepo } from './repository/interfaces';
import { SupplyChainService } from './services/supplyChainService';

interface Step {
  /** Which demo account performs this event. */
  email: string;
  stage: SupplyChainStage;
  location: string;
  notes?: string;
  /** Who takes custody next — omit only on the batch's last recorded step if it's the terminal RETAIL stage. */
  handOffToEmail?: string;
}

interface SampleBatch {
  productName: string;
  productType: string;
  origin: string;
  quantity: number;
  unit: string;
  steps: Step[];
  recall?: { byEmail: string; reason: string };
}

// Realistic Vietnamese agricultural batches at every point in the chain: two
// fully completed (good for the Chain Verifier / full trace view), a few
// deliberately left mid-chain and handed off to whoever's next (good for
// exercising "việc cần làm" / custody hand-off), and one recalled after a
// failed quality check (good for the recall + notifications flow).
const SAMPLE_BATCHES: SampleBatch[] = [
  {
    productName: 'Cà phê Arabica',
    productType: 'Nông sản',
    origin: 'Đà Lạt, Lâm Đồng',
    quantity: 500,
    unit: 'kg',
    steps: [
      { email: 'farmer@demo.com', stage: 'HARVEST', location: 'Đà Lạt, Lâm Đồng', handOffToEmail: 'processor@demo.com' },
      { email: 'processor@demo.com', stage: 'PROCESSING', location: 'Xưởng chế biến An Giang', notes: 'Sơ chế theo phương pháp chế biến ướt', handOffToEmail: 'inspector@demo.com' },
      { email: 'inspector@demo.com', stage: 'QUALITY_CHECK', location: 'Trung tâm kiểm định VN', notes: 'Đạt chuẩn xuất khẩu, độ ẩm 11.5%', handOffToEmail: 'processor@demo.com' },
      { email: 'processor@demo.com', stage: 'PACKAGING', location: 'Xưởng chế biến An Giang', handOffToEmail: 'distributor@demo.com' },
      { email: 'distributor@demo.com', stage: 'DISTRIBUTION', location: 'Kho trung chuyển TP.HCM', handOffToEmail: 'retailer@demo.com' },
      { email: 'retailer@demo.com', stage: 'RETAIL', location: 'Siêu thị XYZ, Quận 1' },
    ],
  },
  {
    productName: 'Sầu riêng Ri6',
    productType: 'Trái cây',
    origin: 'Krông Pắc, Đắk Lắk',
    quantity: 600,
    unit: 'kg',
    steps: [
      { email: 'farmer@demo.com', stage: 'HARVEST', location: 'Krông Pắc, Đắk Lắk', handOffToEmail: 'processor@demo.com' },
      { email: 'processor@demo.com', stage: 'PROCESSING', location: 'Xưởng chế biến An Giang', handOffToEmail: 'inspector@demo.com' },
      { email: 'inspector@demo.com', stage: 'QUALITY_CHECK', location: 'Trung tâm kiểm định VN', notes: 'Đạt chuẩn xuất khẩu', handOffToEmail: 'processor@demo.com' },
      { email: 'processor@demo.com', stage: 'PACKAGING', location: 'Xưởng chế biến An Giang', handOffToEmail: 'distributor@demo.com' },
      { email: 'distributor@demo.com', stage: 'DISTRIBUTION', location: 'Kho trung chuyển TP.HCM', handOffToEmail: 'retailer@demo.com' },
      { email: 'retailer@demo.com', stage: 'RETAIL', location: 'Siêu thị XYZ, Quận 1' },
    ],
  },
  {
    productName: 'Xoài Cát Hòa Lộc',
    productType: 'Trái cây',
    origin: 'Cái Bè, Tiền Giang',
    quantity: 300,
    unit: 'kg',
    steps: [
      { email: 'farmer@demo.com', stage: 'HARVEST', location: 'Cái Bè, Tiền Giang', handOffToEmail: 'processor@demo.com' },
    ],
  },
  {
    productName: 'Gạo ST25',
    productType: 'Nông sản',
    origin: 'Sóc Trăng',
    quantity: 2000,
    unit: 'kg',
    steps: [
      { email: 'farmer@demo.com', stage: 'HARVEST', location: 'Sóc Trăng', handOffToEmail: 'processor@demo.com' },
      { email: 'processor@demo.com', stage: 'PROCESSING', location: 'Xưởng chế biến An Giang', handOffToEmail: 'inspector@demo.com' },
    ],
  },
  {
    productName: 'Thanh long ruột đỏ',
    productType: 'Trái cây',
    origin: 'Hàm Thuận Nam, Bình Thuận',
    quantity: 450,
    unit: 'kg',
    steps: [
      { email: 'farmer@demo.com', stage: 'HARVEST', location: 'Hàm Thuận Nam, Bình Thuận', handOffToEmail: 'processor@demo.com' },
      { email: 'processor@demo.com', stage: 'PROCESSING', location: 'Xưởng chế biến An Giang', handOffToEmail: 'inspector@demo.com' },
      { email: 'inspector@demo.com', stage: 'QUALITY_CHECK', location: 'Trung tâm kiểm định VN', handOffToEmail: 'processor@demo.com' },
      { email: 'processor@demo.com', stage: 'PACKAGING', location: 'Xưởng chế biến An Giang', handOffToEmail: 'distributor@demo.com' },
    ],
  },
  {
    productName: 'Chè Tân Cương',
    productType: 'Nông sản',
    origin: 'Tân Cương, Thái Nguyên',
    quantity: 150,
    unit: 'kg',
    steps: [
      { email: 'farmer@demo.com', stage: 'HARVEST', location: 'Tân Cương, Thái Nguyên', handOffToEmail: 'processor@demo.com' },
    ],
  },
  {
    productName: 'Hồ tiêu Phú Quốc',
    productType: 'Nông sản',
    origin: 'Phú Quốc, Kiên Giang',
    quantity: 100,
    unit: 'kg',
    steps: [
      { email: 'farmer@demo.com', stage: 'HARVEST', location: 'Phú Quốc, Kiên Giang', handOffToEmail: 'processor@demo.com' },
      { email: 'processor@demo.com', stage: 'PROCESSING', location: 'Xưởng chế biến An Giang', handOffToEmail: 'inspector@demo.com' },
      {
        email: 'inspector@demo.com',
        stage: 'QUALITY_CHECK',
        location: 'Trung tâm kiểm định VN',
        notes: 'Phát hiện dư lượng thuốc bảo vệ thực vật vượt ngưỡng cho phép',
        handOffToEmail: 'processor@demo.com',
      },
    ],
    // INSPECTOR triggers the recall themselves — matches the real workflow:
    // whoever finds the problem during QUALITY_CHECK shouldn't have to wait on ADMIN sign-off.
    recall: { byEmail: 'inspector@demo.com', reason: 'Dư lượng thuốc bảo vệ thực vật vượt ngưỡng an toàn thực phẩm' },
  },
];

// Deliberately messy — recorded via ADMIN (which bypasses the custody
// hand-off requirement) so the Anomaly Monitor page has real, naturally
// detected anomalies to show instead of an empty state.
const ANOMALY_BATCHES: Array<{
  productName: string; productType: string; origin: string; quantity: number; unit: string;
  steps: Array<{ stage: SupplyChainStage; location: string }>;
}> = [
  {
    productName: 'Cam sành',
    productType: 'Trái cây',
    origin: 'Bắc Quang, Hà Giang',
    quantity: 350,
    unit: 'kg',
    steps: [
      { stage: 'HARVEST', location: 'Bắc Quang, Hà Giang' },
      { stage: 'PACKAGING', location: 'Xưởng chế biến An Giang' }, // skips PROCESSING + QUALITY_CHECK -> STAGE_SKIPPED
    ],
  },
  {
    productName: 'Dừa xiêm',
    productType: 'Trái cây',
    origin: 'Bến Tre',
    quantity: 800,
    unit: 'kg',
    steps: [
      { stage: 'HARVEST', location: 'Bến Tre' },
      { stage: 'HARVEST', location: 'Bến Tre' }, // re-recorded by mistake -> DUPLICATE_STAGE
    ],
  },
];

/** Seeds realistic sample batches for the demo accounts — idempotent, and only ever fills an empty store. */
export async function seedSampleBatches(supplyChainService: SupplyChainService, actorRepo: IActorRepo): Promise<void> {
  if (await supplyChainService.hasAnyBatches()) return;

  const actorByEmail = new Map<string, Actor>();
  async function actorFor(email: string): Promise<Actor> {
    let found = actorByEmail.get(email);
    if (!found) {
      const fetched = await actorRepo.findByEmail(email);
      if (!fetched) throw new Error(`Sample data expects demo account ${email} to already be seeded`);
      found = fetched;
      actorByEmail.set(email, found);
    }
    return found;
  }

  for (const spec of SAMPLE_BATCHES) {
    const creator = await actorFor(spec.steps[0].email);
    const batch = await supplyChainService.createBatch(creator, {
      productName: spec.productName,
      productType: spec.productType,
      origin: spec.origin,
      quantity: spec.quantity,
      unit: spec.unit,
    });

    for (const step of spec.steps) {
      const stepActor = await actorFor(step.email);
      const assignNextTo = step.handOffToEmail ? (await actorFor(step.handOffToEmail)).id : undefined;
      await supplyChainService.recordEvent(stepActor, {
        batchId: batch.id,
        stage: step.stage,
        location: step.location,
        notes: step.notes,
        assignNextTo,
      });
    }

    if (spec.recall) {
      const recaller = await actorFor(spec.recall.byEmail);
      await supplyChainService.recallBatch(recaller, batch.id, spec.recall.reason);
    }
  }

  const admin = await actorFor('admin@demo.com');
  for (const spec of ANOMALY_BATCHES) {
    const batch = await supplyChainService.createBatch(admin, {
      productName: spec.productName,
      productType: spec.productType,
      origin: spec.origin,
      quantity: spec.quantity,
      unit: spec.unit,
    });
    for (const step of spec.steps) {
      await supplyChainService.recordEvent(admin, { batchId: batch.id, stage: step.stage, location: step.location });
    }
  }
}
