import { v4 as uuidv4 } from 'uuid';
import {
  Batch,
  CreateBatchDTO,
  RecordEventDTO,
  ROLE_STAGE_PERMISSIONS,
  STAGE_ORDER,
  TraceEvent,
  TraceResult,
} from '../domain/types';
import { IActorRepo, IBatchRepo, IEventRepo } from '../repository/interfaces';
import { computeEventHash, GENESIS_HASH, verifyChain } from '../ledger/hashChain';
import { AnomalyDetector } from './anomalyDetector';

export class SupplyChainService {
  constructor(
    private readonly batchRepo: IBatchRepo,
    private readonly actorRepo: IActorRepo,
    private readonly eventRepo: IEventRepo,
    private readonly anomalyDetector: AnomalyDetector,
  ) {}

  async createBatch(dto: CreateBatchDTO, actorId: string): Promise<Batch> {
    const actor = await this.actorRepo.findById(actorId);
    if (!actor || !actor.isActive) throw new Error('Actor not found or inactive');

    const batch: Batch = {
      id: uuidv4(),
      productName: dto.productName,
      productType: dto.productType,
      origin: dto.origin,
      quantity: dto.quantity,
      unit: dto.unit,
      createdAt: new Date(),
      createdBy: actorId,
      currentStage: null,
      isRecalled: false,
      metadata: dto.metadata ?? {},
    };

    return this.batchRepo.create(batch);
  }

  async recordEvent(dto: RecordEventDTO, actorId: string): Promise<TraceEvent> {
    const [actor, batch] = await Promise.all([
      this.actorRepo.findById(actorId),
      this.batchRepo.findById(dto.batchId),
    ]);

    if (!actor || !actor.isActive) throw new Error('Actor not found or inactive');
    if (!batch) throw new Error(`Batch ${dto.batchId} not found`);
    if (batch.isRecalled) throw new Error('Cannot record events on a recalled batch');

    const allowedStages = ROLE_STAGE_PERMISSIONS[actor.role];
    if (!allowedStages.includes(dto.stage)) {
      throw new Error(`Actor role ${actor.role} is not authorized to record stage ${dto.stage}`);
    }

    const existingEvents = await this.eventRepo.findByBatchId(dto.batchId);

    const anomalies = this.anomalyDetector.checkBeforeRecord(batch, dto.stage, actor, existingEvents);
    const blocking = anomalies.filter((a) => a.severity === 'CRITICAL' || a.severity === 'HIGH');
    if (blocking.length > 0) {
      throw new Error(`Anomaly blocked: ${blocking[0].message}`);
    }

    const lastEvent = existingEvents.length > 0 ? existingEvents[existingEvents.length - 1] : null;
    const prevHash = lastEvent?.hash ?? GENESIS_HASH;
    const sequenceNumber = (lastEvent?.sequenceNumber ?? -1) + 1;

    const partial: Omit<TraceEvent, 'hash'> = {
      id: uuidv4(),
      batchId: dto.batchId,
      stage: dto.stage,
      actorId,
      timestamp: new Date(),
      location: dto.location,
      notes: dto.notes,
      data: dto.data ?? {},
      prevHash,
      sequenceNumber,
    };

    const event: TraceEvent = { ...partial, hash: computeEventHash(partial) };

    const stageIndex = STAGE_ORDER.indexOf(dto.stage);
    const currentIndex = batch.currentStage ? STAGE_ORDER.indexOf(batch.currentStage) : -1;

    await Promise.all([
      this.eventRepo.create(event),
      stageIndex > currentIndex
        ? this.batchRepo.update(dto.batchId, { currentStage: dto.stage })
        : Promise.resolve(null),
    ]);

    return event;
  }

  async traceForward(batchId: string): Promise<TraceResult> {
    const batch = await this.batchRepo.findById(batchId);
    if (!batch) throw new Error(`Batch ${batchId} not found`);

    const events = await this.eventRepo.findByBatchId(batchId);
    const { valid } = verifyChain(events);
    const anomalies = this.anomalyDetector.analyzeChain(batch, events);

    return { batch, events, anomalies, isValid: valid };
  }

  async traceBackward(batchId: string): Promise<TraceResult> {
    const result = await this.traceForward(batchId);
    return { ...result, events: [...result.events].reverse() };
  }

  async recallBatch(batchId: string, reason: string, actorId: string): Promise<Batch> {
    const [actor, batch] = await Promise.all([
      this.actorRepo.findById(actorId),
      this.batchRepo.findById(batchId),
    ]);

    if (!actor || !actor.isActive) throw new Error('Actor not found or inactive');
    if (!batch) throw new Error(`Batch ${batchId} not found`);

    return (await this.batchRepo.update(batchId, { isRecalled: true, recallReason: reason }))!;
  }

  async getBatch(batchId: string): Promise<Batch | null> {
    return this.batchRepo.findById(batchId);
  }

  async getAllBatches(): Promise<Batch[]> {
    return this.batchRepo.findAll();
  }
}
