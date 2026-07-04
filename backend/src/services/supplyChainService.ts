import { v4 as uuidv4 } from 'uuid';
import { Actor, Batch, CreateBatchDTO, RecordEventDTO, ROLE_STAGES, STAGE_ORDER, TraceEvent } from '../domain/types';
import { ConflictError, ForbiddenError, NotFoundError } from '../errors';
import { computeEventHash, GENESIS_HASH } from '../ledger/hashChain';
import { IBatchRepo, IEventRepo } from '../repository/interfaces';

export { ConflictError, ForbiddenError, NotFoundError };

export class SupplyChainService {
  // Serializes recordEvent calls per batchId so two concurrent requests for the
  // same batch can't both read the same sequenceNumber/prevHash and fork the chain.
  private readonly batchQueues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly batchRepo: IBatchRepo,
    private readonly eventRepo: IEventRepo,
  ) {}

  private runExclusive<T>(batchId: string, fn: () => Promise<T>): Promise<T> {
    const tail = this.batchQueues.get(batchId) ?? Promise.resolve();
    const result = tail.then(fn, fn);
    this.batchQueues.set(
      batchId,
      result.then(
        () => undefined,
        () => undefined,
      ),
    );
    return result;
  }

  async createBatch(actor: Actor, dto: CreateBatchDTO): Promise<Batch> {
    const batch: Batch = {
      id: uuidv4(),
      productName: dto.productName,
      productType: dto.productType,
      origin: dto.origin,
      quantity: dto.quantity,
      unit: dto.unit,
      createdAt: new Date(),
      createdBy: actor.id,
      currentStage: null,
      isRecalled: false,
      metadata: dto.metadata ?? {},
    };
    return this.batchRepo.create(batch);
  }

  async listBatches(): Promise<Batch[]> {
    return this.batchRepo.findAll();
  }

  async getBatch(id: string): Promise<Batch> {
    const batch = await this.batchRepo.findById(id);
    if (!batch) throw new NotFoundError('Batch not found');
    return batch;
  }

  async recordEvent(actor: Actor, dto: RecordEventDTO): Promise<TraceEvent> {
    return this.runExclusive(dto.batchId, async () => {
      const batch = await this.batchRepo.findById(dto.batchId);
      if (!batch) throw new NotFoundError('Batch not found');
      if (batch.isRecalled) throw new ConflictError('Batch has been recalled — no further events allowed');

      const allowedStages = ROLE_STAGES[actor.role];
      if (!allowedStages.includes(dto.stage)) {
        throw new ForbiddenError(`Role ${actor.role} is not permitted to record stage ${dto.stage}`);
      }

      const last = await this.eventRepo.lastEvent(dto.batchId);
      const sequenceNumber = last ? last.sequenceNumber + 1 : 0;
      const prevHash = last ? last.hash : GENESIS_HASH;

      const unhashed = {
        batchId: dto.batchId,
        stage: dto.stage,
        actorId: actor.id,
        timestamp: new Date(),
        location: dto.location,
        notes: dto.notes,
        data: dto.data ?? {},
        prevHash,
        sequenceNumber,
      };

      const event: TraceEvent = {
        ...unhashed,
        id: uuidv4(),
        hash: computeEventHash(unhashed),
      };

      await this.eventRepo.create(event);

      // currentStage tracks the furthest stage reached — a duplicate or
      // out-of-order event (flagged separately by the anomaly detector)
      // must not make the batch appear to regress.
      const newIndex = STAGE_ORDER.indexOf(dto.stage);
      const currentIndex = batch.currentStage ? STAGE_ORDER.indexOf(batch.currentStage) : -1;
      if (newIndex > currentIndex) {
        batch.currentStage = dto.stage;
        await this.batchRepo.update(batch);
      }

      return event;
    });
  }

  async recallBatch(id: string, reason: string): Promise<Batch> {
    const batch = await this.batchRepo.findById(id);
    if (!batch) throw new NotFoundError('Batch not found');
    batch.isRecalled = true;
    batch.recallReason = reason;
    return this.batchRepo.update(batch);
  }
}
