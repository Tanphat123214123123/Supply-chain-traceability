import { v4 as uuidv4 } from 'uuid';
import {
  Actor,
  Anomaly,
  AnomalyListQuery,
  Batch,
  NotificationItem,
  PartnerSummary,
} from '../domain/types';
import { ForbiddenError, NotFoundError } from '../errors';
import { verifyChain } from '../ledger/hashChain';
import {
  IActorRepo,
  IAnomalyRepo,
  IAuditLogRepo,
  IBatchRepo,
  IEventRepo,
} from '../repository/interfaces';

/** Actor directory entry with email redacted unless the viewer is ADMIN or the actor themself. */
export type ActorDirectoryEntry = Omit<Actor, 'passwordHash' | 'email'> & { email?: string };

// Roles with system-wide oversight responsibility (see full anomaly/recall feed).
// Everyone else only sees notifications for batches they created or recorded events on.
// Exported so the Socket.IO connection handler (index.ts) can put these roles
// in the realtime "oversight" room using the same definition, not a copy.
export const OVERSIGHT_ROLES: Actor['role'][] = ['ADMIN', 'INSPECTOR'];

export class AdminService {
  constructor(
    private readonly actorRepo: IActorRepo,
    private readonly eventRepo: IEventRepo,
    private readonly batchRepo: IBatchRepo,
    private readonly anomalyRepo: IAnomalyRepo,
    private readonly auditLogRepo: IAuditLogRepo,
    private readonly signingKey: string,
  ) {}

  private redact(actor: Omit<Actor, 'passwordHash'>, requester: Actor): ActorDirectoryEntry {
    if (requester.role === 'ADMIN' || actor.id === requester.id) return actor;
    return { ...actor, email: undefined };
  }

  async listActors(requester: Actor): Promise<ActorDirectoryEntry[]> {
    const actors = await this.actorRepo.findAllByTenant(requester.tenantId);
    return actors.map(({ passwordHash: _omit, ...rest }) => this.redact(rest, requester));
  }

  async getActorDetail(id: string, requester: Actor): Promise<{ actor: ActorDirectoryEntry; batches: Batch[] }> {
    const actor = await this.actorRepo.findById(id);
    // Same NotFoundError for "doesn't exist" and "exists in another tenant" —
    // a 403 would confirm the actor exists to someone with no business knowing.
    if (!actor || actor.tenantId !== requester.tenantId) throw new NotFoundError('Actor not found');

    const events = await this.eventRepo.findByActorId(id);
    const batchIds = new Set(events.map((e) => e.batchId));
    const tenantBatches = await this.batchRepo.findAllByTenant(requester.tenantId);
    const batches = tenantBatches.filter((b) => batchIds.has(b.id) || b.createdBy === id);

    const { passwordHash: _omit, ...actorPublic } = actor;
    return { actor: this.redact(actorPublic, requester), batches };
  }

  async setActorStatus(admin: Actor, targetId: string, isActive: boolean): Promise<Actor> {
    if (targetId === admin.id && !isActive) {
      throw new ForbiddenError('Cannot deactivate your own account');
    }
    const target = await this.actorRepo.findById(targetId);
    if (!target || target.tenantId !== admin.tenantId) throw new NotFoundError('Actor not found');

    const updated = { ...target, isActive };
    await this.actorRepo.update(updated);
    await this.auditLogRepo.create({
      id: uuidv4(),
      actorId: admin.id,
      tenantId: admin.tenantId,
      action: isActive ? 'ACTOR_ACTIVATED' : 'ACTOR_DEACTIVATED',
      entityType: 'actor',
      entityId: targetId,
      metadata: {},
      createdAt: new Date(),
    });
    return updated;
  }

  async setActorRole(admin: Actor, targetId: string, role: Actor['role']): Promise<Actor> {
    if (targetId === admin.id) {
      throw new ForbiddenError('Cannot change your own role — have another admin do it');
    }
    const target = await this.actorRepo.findById(targetId);
    if (!target || target.tenantId !== admin.tenantId) throw new NotFoundError('Actor not found');

    const updated = { ...target, role };
    await this.actorRepo.update(updated);
    await this.auditLogRepo.create({
      id: uuidv4(),
      actorId: admin.id,
      tenantId: admin.tenantId,
      action: 'ACTOR_ROLE_CHANGED',
      entityType: 'actor',
      entityId: targetId,
      metadata: { newRole: role },
      createdAt: new Date(),
    });
    return updated;
  }

  async listAnomalies(tenantId: string, query: AnomalyListQuery) {
    return this.anomalyRepo.findPageByTenant(tenantId, query);
  }

  async resolveAnomaly(admin: Actor, anomalyId: string) {
    const existing = await this.anomalyRepo.findById(anomalyId);
    if (!existing || existing.tenantId !== admin.tenantId) throw new NotFoundError('Anomaly not found');

    const resolved = await this.anomalyRepo.resolve(anomalyId, admin.id);
    if (!resolved) throw new NotFoundError('Anomaly not found');
    await this.auditLogRepo.create({
      id: uuidv4(),
      actorId: admin.id,
      tenantId: admin.tenantId,
      action: 'ANOMALY_RESOLVED',
      entityType: 'anomaly',
      entityId: anomalyId,
      metadata: { batchId: resolved.batchId },
      createdAt: new Date(),
    });
    return resolved;
  }

  async listPartners(tenantId: string): Promise<PartnerSummary[]> {
    const actors = await this.actorRepo.findAllByTenant(tenantId);
    const byOrg = new Map<string, PartnerSummary>();
    for (const actor of actors) {
      const existing = byOrg.get(actor.organization);
      if (existing) {
        existing.actorCount += 1;
        if (!existing.roles.includes(actor.role)) existing.roles.push(actor.role);
      } else {
        byOrg.set(actor.organization, { organization: actor.organization, actorCount: 1, roles: [actor.role] });
      }
    }
    return [...byOrg.values()].sort((a, b) => a.organization.localeCompare(b.organization));
  }

  async listNotifications(limit: number, requester: Actor): Promise<NotificationItem[]> {
    const [anomalyPage, recallLogs] = await Promise.all([
      this.anomalyRepo.findPageByTenant(requester.tenantId, { page: 1, pageSize: limit }),
      this.auditLogRepo.findByActionAndTenant('BATCH_RECALLED', requester.tenantId, limit),
    ]);

    const anomalyItems: NotificationItem[] = anomalyPage.items.map((a) => ({
      id: a.id,
      kind: 'ANOMALY',
      message: a.message,
      severity: a.severity,
      batchId: a.batchId,
      createdAt: a.detectedAt,
    }));

    const recallItems: NotificationItem[] = recallLogs.map((log) => ({
      id: log.id,
      kind: 'RECALL',
      message: typeof log.metadata.reason === 'string' ? log.metadata.reason : 'Lô hàng đã bị thu hồi',
      batchId: log.entityId ?? '',
      createdAt: log.createdAt,
    }));

    const combined = [...anomalyItems, ...recallItems].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    if (OVERSIGHT_ROLES.includes(requester.role)) {
      return combined.slice(0, limit);
    }

    // Non-oversight roles only see notifications for batches they're actually
    // involved in — otherwise any FARMER account could see every other
    // organization's anomalies/recalls system-wide.
    const [ownEvents, tenantBatches] = await Promise.all([
      this.eventRepo.findByActorId(requester.id),
      this.batchRepo.findAllByTenant(requester.tenantId),
    ]);
    const allowedBatchIds = new Set<string>(ownEvents.map((e) => e.batchId));
    for (const batch of tenantBatches) {
      if (batch.createdBy === requester.id) allowedBatchIds.add(batch.id);
    }

    return combined.filter((item) => allowedBatchIds.has(item.batchId)).slice(0, limit);
  }

  /**
   * Re-verifies every batch's hash chain and persists a CHAIN_TAMPERED anomaly
   * for any that fail — tampering can only be discovered at read time (it's
   * evidence someone edited a row directly, not something that happens "at"
   * write time), so this needs to be run explicitly rather than detected inline
   * like the rule-based anomalies in anomalyDetector.ts. Run once at server
   * startup and available on-demand via POST /api/admin/scan-integrity.
   */
  async scanForTamperedChains(): Promise<Anomaly[]> {
    const batches = await this.batchRepo.findAll();
    const created: Anomaly[] = [];

    for (const batch of batches) {
      const events = await this.eventRepo.findByBatchId(batch.id);
      if (events.length === 0 || verifyChain(events, this.signingKey)) continue;

      const existing = await this.anomalyRepo.findByBatchId(batch.id);
      const alreadyFlagged = existing.some((a) => a.type === 'CHAIN_TAMPERED' && !a.resolved);
      if (alreadyFlagged) continue;

      const anomaly = await this.anomalyRepo.create({
        id: uuidv4(),
        type: 'CHAIN_TAMPERED',
        severity: 'CRITICAL',
        message: `Phát hiện dữ liệu bị can thiệp trong chuỗi hash của lô hàng "${batch.productName}"`,
        batchId: batch.id,
        tenantId: batch.tenantId,
        detectedAt: new Date(),
        resolved: false,
      });
      created.push(anomaly);

      await this.auditLogRepo.create({
        id: uuidv4(),
        actorId: null,
        tenantId: batch.tenantId,
        action: 'CHAIN_INTEGRITY_SCAN_FLAGGED',
        entityType: 'batch',
        entityId: batch.id,
        metadata: {},
        createdAt: new Date(),
      });
    }

    return created;
  }
}
