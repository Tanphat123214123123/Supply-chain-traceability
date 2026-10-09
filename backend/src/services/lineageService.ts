import { v4 as uuidv4 } from 'uuid';
import { Database } from '../db/database';
import {
  Actor,
  Anomaly,
  Batch,
  CreateTransformationDTO,
  EventLink,
  LineageGraph,
  ROLE_STAGES,
  STAGE_ORDER,
  TraceEvent,
  TransformationResult,
} from '../domain/types';
import { ConflictError, ForbiddenError, NotFoundError } from '../errors';
import { GENESIS_HASH, sealEventV3, sortLinks } from '../ledger/hashChain';
import { IActorRepo, IAnomalyRepo, IAuditLogRepo, IBatchRepo, IEventRepo } from '../repository/interfaces';
import { PostgresLineageRepo, toKg } from '../repository/postgres/lineageRepo';
import { resolveNextAssignee } from './custody';

export interface LineageRepos {
  batchRepo: IBatchRepo;
  eventRepo: IEventRepo;
  anomalyRepo: IAnomalyRepo;
  auditLogRepo: IAuditLogRepo;
  actorRepo: IActorRepo;
  lineageRepo: PostgresLineageRepo;
}

/** Roles that may perform each kind of transformation (ADMIN always may). */
const KIND_ROLES: Record<CreateTransformationDTO['kind'], Actor['role'][]> = {
  MERGE: ['PROCESSOR', 'DISTRIBUTOR', 'ADMIN'],
  SPLIT: ['PROCESSOR', 'DISTRIBUTOR', 'ADMIN'],
  TRANSFORM: ['PROCESSOR', 'ADMIN'],
};

/** "Gộp/tách cùng loại hàng" may lose mass (drying, sorting) but can never gain it. */
const SAME_TYPE_MAX_RATIO = 1;
/** Rounding slack so 100.0000001 kg out of 100 kg isn't an alarm. */
const EPSILON = 1e-6;

function originOf(inputs: Batch[]): string {
  const unique = [...new Set(inputs.map((b) => b.origin))];
  const text = unique.length <= 3 ? unique.join('; ') : `${unique.slice(0, 3).join('; ')}… (${unique.length} vùng)`;
  return text.slice(0, 200);
}

/**
 * Merging, splitting and transforming lots (docs/SPEC_PHASE1.md §3) and the
 * lineage graph they produce. Each output lot is born with a hash-chained
 * first event whose `links` commit to the inputs' chain heads, so integrity
 * propagates through the whole graph.
 */
export class LineageService {
  constructor(
    private readonly db: Database,
    private readonly repos: LineageRepos,
  ) {}

  async createTransformation(actor: Actor, dto: CreateTransformationDTO): Promise<TransformationResult> {
    if (!KIND_ROLES[dto.kind].includes(actor.role)) {
      throw new ForbiddenError(`Role ${actor.role} cannot perform ${dto.kind}`);
    }
    if (!ROLE_STAGES[actor.role].includes(dto.stage)) {
      throw new ForbiddenError(`Role ${actor.role} is not permitted to record stage ${dto.stage}`);
    }
    const inputIds = dto.inputs.map((i) => i.lotId);
    if (new Set(inputIds).size !== inputIds.length) throw new ConflictError('The same input lot is listed twice');
    if (dto.kind === 'MERGE' && (dto.inputs.length < 2 || dto.outputs.length !== 1)) {
      throw new ConflictError('A merge takes at least two input lots and produces exactly one');
    }
    if (dto.kind === 'SPLIT' && (dto.inputs.length !== 1 || dto.outputs.length < 2)) {
      throw new ConflictError('A split takes one input lot and produces at least two');
    }

    return this.db.withTenant(actor.tenantId, async () => {
      // Lock inputs in id order — two concurrent transformations over
      // overlapping lots can then never deadlock, and each sees the other's
      // consumption.
      const inputs: Batch[] = [];
      for (const id of [...inputIds].sort()) {
        const lot = await this.repos.batchRepo.findByIdForUpdate(id);
        if (!lot || lot.tenantId !== actor.tenantId) throw new NotFoundError('Batch not found');
        inputs.push(lot);
      }
      const byId = new Map(inputs.map((b) => [b.id, b]));
      const stageIndex = STAGE_ORDER.indexOf(dto.stage);

      for (const { lotId, quantity } of dto.inputs) {
        const lot = byId.get(lotId)!;
        if (lot.isRecalled) throw new ConflictError(`Lot ${lot.productName} has been recalled`);
        if (lot.eventCount === 0) throw new ConflictError(`Lot ${lot.productName} has no recorded event yet`);
        if (actor.role !== 'ADMIN' && lot.assignedToActorId && lot.assignedToActorId !== actor.id) {
          throw new ForbiddenError('This batch has not been handed off to you yet');
        }
        const lotStage = lot.currentStage ? STAGE_ORDER.indexOf(lot.currentStage) : -1;
        if (lotStage > stageIndex) {
          throw new ConflictError(`Lot ${lot.productName} is already past stage ${dto.stage}`);
        }
        // Physically impossible — reject outright (the DB CHECK is the backstop).
        const remaining = lot.quantity - lot.consumedQuantity;
        if (quantity > remaining + EPSILON) {
          throw new ConflictError(`Only ${remaining} ${lot.unit} of ${lot.productName} remain`);
        }
      }

      const inputTypes = new Set(inputs.map((b) => b.productType));
      const outputTypes = new Set(dto.outputs.map((o) => o.productType));
      if (dto.kind !== 'TRANSFORM') {
        const all = new Set([...inputTypes, ...outputTypes]);
        if (all.size !== 1) throw new ConflictError('Merge and split keep the product type — use a transformation to change it');
      } else if (inputTypes.size !== 1 || outputTypes.size !== 1) {
        throw new ConflictError('A transformation turns one product type into one other product type');
      }

      // Outputs stay with the actor unless handed on — to someone who works this
      // stage (e.g. merge at the collector, then transform at the mill) or the next.
      const nextAssignee = await resolveNextAssignee(this.repos.actorRepo, actor, stageIndex, dto.assignNextTo, {
        sameStageAllowed: true,
      });
      const now = new Date();
      const transformationId = uuidv4();
      await this.repos.lineageRepo.createTransformation({
        id: transformationId,
        tenantId: actor.tenantId,
        kind: dto.kind,
        stage: dto.stage,
        actorId: actor.id,
        location: dto.location,
        notes: dto.notes,
        createdAt: now,
      });

      const links: EventLink[] = sortLinks(
        dto.inputs.map(({ lotId, quantity }) => {
          const lot = byId.get(lotId)!;
          return { lotId, quantity, unit: lot.unit, headHash: lot.headHash, eventCount: lot.eventCount };
        }),
      );
      for (const link of links) {
        await this.repos.lineageRepo.addInput({ transformationId, tenantId: actor.tenantId, ...link });
      }

      const outputs: Batch[] = [];
      const genesisEvents: TraceEvent[] = [];
      for (const out of dto.outputs) {
        const lot = await this.repos.batchRepo.create({
          id: uuidv4(),
          productName: out.productName,
          productType: out.productType,
          origin: originOf(inputs),
          quantity: out.quantity,
          unit: out.unit,
          createdAt: now,
          createdBy: actor.id,
          tenantId: actor.tenantId,
          currentStage: null,
          isRecalled: false,
          metadata: { transformationId },
          assignedToActorId: actor.id,
        });
        await this.repos.lineageRepo.addOutput(transformationId, actor.tenantId, lot.id);

        const unhashed = {
          batchId: lot.id,
          stage: dto.stage,
          actorId: actor.id,
          timestamp: now,
          location: dto.location,
          notes: dto.notes,
          data: dto.data ?? {},
          prevHash: GENESIS_HASH,
          sequenceNumber: 0,
          kind: dto.kind,
          links,
        };
        const { hash, claimSalts } = sealEventV3(unhashed);
        const event: TraceEvent = { ...unhashed, id: uuidv4(), tenantId: actor.tenantId, hashVersion: 3, claimSalts, hash };
        await this.repos.eventRepo.create(event);
        await this.repos.batchRepo.advanceStage(lot.id, dto.stage, nextAssignee);
        genesisEvents.push(event);
        outputs.push((await this.repos.batchRepo.findById(lot.id))!);
      }

      const anomalies = await this.checkMassBalance(dto, inputs, outputs, genesisEvents);
      await this.audit(actor, 'TRANSFORMATION_RECORDED', transformationId, {
        kind: dto.kind,
        inputs: links.map((l) => l.lotId),
        outputs: outputs.map((o) => o.id),
      });
      return { transformationId, outputs, anomalies };
    });
  }

  /** SPEC §5 level 1: what comes out can't exceed what went in × the allowed ratio. */
  private async checkMassBalance(
    dto: CreateTransformationDTO,
    inputs: Batch[],
    outputs: Batch[],
    events: TraceEvent[],
  ): Promise<Anomaly[]> {
    const byId = new Map(inputs.map((b) => [b.id, b]));
    const inKgParts = dto.inputs.map((i) => toKg(i.quantity, byId.get(i.lotId)!.unit));
    const outKgParts = dto.outputs.map((o) => toKg(o.quantity, o.unit));
    if ([...inKgParts, ...outKgParts].some((x) => x === null)) return []; // count units: nothing to weigh
    const inKg = inKgParts.reduce((a, b) => a! + b!, 0)!;
    const outKg = outKgParts.reduce((a, b) => a! + b!, 0)!;

    let maxRatio = SAME_TYPE_MAX_RATIO;
    let label = 'cùng loại hàng';
    if (dto.kind === 'TRANSFORM') {
      const from = inputs[0].productType;
      const to = dto.outputs[0].productType;
      const factor = await this.repos.lineageRepo.conversionFactor(from, to);
      if (!factor) return []; // unknown conversion: no reference to judge against
      maxRatio = factor.max;
      label = `${from} → ${to} tối đa ${factor.max}`;
    }
    if (outKg <= inKg * maxRatio + EPSILON) return [];

    const message = `Cân bằng khối lượng: đầu ra ${outKg.toLocaleString('vi-VN')} kg vượt mức cho phép từ ${inKg.toLocaleString('vi-VN')} kg đầu vào (${label})`;
    const stored: Anomaly[] = [];
    for (const [i, lot] of outputs.entries()) {
      stored.push(
        await this.repos.anomalyRepo.create({
          id: uuidv4(),
          type: 'MASS_BALANCE_VIOLATION',
          severity: 'HIGH',
          message,
          batchId: lot.id,
          tenantId: lot.tenantId,
          eventId: events[i].id,
          detectedAt: new Date(),
          resolved: false,
        }),
      );
    }
    return stored;
  }

  /** Both directions of the lot graph around `lotId`. */
  async lineage(actor: Actor, lotId: string): Promise<LineageGraph> {
    return this.db.withTenant(actor.tenantId, () => this.lineageInScope(lotId, actor.tenantId));
  }

  /** Same, for callers already inside the lot's tenant scope (the public page). */
  async lineageInScope(lotId: string, tenantId: string): Promise<LineageGraph> {
    const self = await this.repos.batchRepo.findById(lotId);
    if (!self || self.tenantId !== tenantId) throw new NotFoundError('Batch not found');
    const [upstream, downstream] = await Promise.all([
      this.repos.lineageRepo.edges(lotId, 'up'),
      this.repos.lineageRepo.edges(lotId, 'down'),
    ]);
    const ids = new Set<string>([lotId]);
    for (const e of [...upstream, ...downstream]) {
      ids.add(e.fromLotId);
      ids.add(e.toLotId);
    }
    const lots: LineageGraph['lots'] = {};
    const fetched = await this.repos.batchRepo.findByIds([...ids].filter((id) => id !== lotId));
    for (const b of [self, ...fetched]) {
      lots[b.id] = {
        id: b.id,
        productName: b.productName,
        productType: b.productType,
        origin: b.origin,
        quantity: b.quantity,
        unit: b.unit,
        currentStage: b.currentStage,
        isRecalled: b.isRecalled,
        plotId: b.plotId,
        consumedQuantity: b.consumedQuantity,
      };
    }
    const produced = new Set(upstream.map((e) => e.toLotId));
    const upstreamLots = new Set([lotId, ...upstream.map((e) => e.fromLotId)]);
    const rootLotIds = [...upstreamLots].filter((id) => !produced.has(id));
    return { lotId, lots, upstream, downstream, rootLotIds };
  }

  private async audit(actor: Actor, action: string, entityId: string, metadata: Record<string, unknown>): Promise<void> {
    await this.repos.auditLogRepo.create({
      id: uuidv4(),
      actorId: actor.id,
      tenantId: actor.tenantId,
      action,
      entityType: 'transformation',
      entityId,
      metadata,
      createdAt: new Date(),
    });
  }
}
