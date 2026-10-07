import { v4 as uuidv4 } from 'uuid';
import { Database } from '../db/database';
import {
  Actor,
  Anomaly,
  AnomalyListQuery,
  AuditLogEntry,
  Batch,
  NotificationItem,
  PaginatedResult,
  PartnerSummary,
  TraceEvent,
} from '../domain/types';
import { ConflictError, ForbiddenError, NotFoundError } from '../errors';
import { verifyChain } from '../ledger/hashChain';
import {
  IActorRepo,
  IAnomalyRepo,
  IAuditLogRepo,
  IBatchRepo,
  IEventRepo,
  ITenantRepo,
} from '../repository/interfaces';

/** Actor directory entry with email redacted unless the viewer is ADMIN or the actor themself. */
export type ActorDirectoryEntry = Omit<Actor, 'passwordHash' | 'email'> & { email?: string };

// Roles with system-wide oversight responsibility (see full anomaly/recall feed).
// Everyone else only sees notifications for batches they're involved in.
// Exported so the Socket.IO connection handler (index.ts) can put these roles
// in the realtime "oversight" room using the same definition, not a copy.
export const OVERSIGHT_ROLES: Actor['role'][] = ['ADMIN', 'INSPECTOR'];

/** Batches verified per round-trip during an integrity scan — bounds memory regardless of tenant size. */
const SCAN_PAGE_SIZE = 200;

export interface AdminRepos {
  tenantRepo: ITenantRepo;
  actorRepo: IActorRepo;
  eventRepo: IEventRepo;
  batchRepo: IBatchRepo;
  anomalyRepo: IAnomalyRepo;
  auditLogRepo: IAuditLogRepo;
}

export class AdminService {
  constructor(
    private readonly db: Database,
    private readonly repos: AdminRepos,
    /** Only needed to re-verify legacy v1 (HMAC) events. */
    private readonly legacyLedgerKey?: string,
  ) {}

  private redact(actor: Omit<Actor, 'passwordHash'>, requester: Actor): ActorDirectoryEntry {
    if (requester.role === 'ADMIN' || actor.id === requester.id) return actor;
    return { ...actor, email: undefined };
  }

  async listActors(requester: Actor): Promise<ActorDirectoryEntry[]> {
    return this.db.withTenant(requester.tenantId, async () => {
      const actors = await this.repos.actorRepo.findAllByTenant(requester.tenantId);
      return actors.map(({ passwordHash: _omit, ...rest }) => this.redact(rest, requester));
    });
  }

  async getActorDetail(id: string, requester: Actor): Promise<{ actor: ActorDirectoryEntry; batches: Batch[] }> {
    return this.db.withTenant(requester.tenantId, async () => {
      const actor = await this.repos.actorRepo.findById(id);
      // Same NotFoundError for "doesn't exist" and "exists in another tenant" —
      // a 403 would confirm the actor exists to someone with no business knowing.
      if (!actor || actor.tenantId !== requester.tenantId) throw new NotFoundError('Actor not found');

      const batches = await this.repos.batchRepo.findInvolving(requester.tenantId, id);
      const { passwordHash: _omit, ...actorPublic } = actor;
      return { actor: this.redact(actorPublic, requester), batches };
    });
  }

  async setActorStatus(admin: Actor, targetId: string, isActive: boolean): Promise<Actor> {
    if (targetId === admin.id && !isActive) {
      throw new ForbiddenError('Cannot deactivate your own account');
    }
    return this.db.withTenant(admin.tenantId, async () => {
      const updated = await this.repos.actorRepo.setActive(targetId, isActive);
      if (!updated || updated.tenantId !== admin.tenantId) throw new NotFoundError('Actor not found');
      await this.audit(admin, isActive ? 'ACTOR_ACTIVATED' : 'ACTOR_DEACTIVATED', 'actor', targetId, {});
      return updated;
    });
  }

  async setActorRole(admin: Actor, targetId: string, role: Actor['role']): Promise<Actor> {
    if (targetId === admin.id) {
      throw new ForbiddenError('Cannot change your own role — have another admin do it');
    }
    return this.db.withTenant(admin.tenantId, async () => {
      const updated = await this.repos.actorRepo.setRole(targetId, role);
      if (!updated || updated.tenantId !== admin.tenantId) throw new NotFoundError('Actor not found');
      await this.audit(admin, 'ACTOR_ROLE_CHANGED', 'actor', targetId, { newRole: role });
      return updated;
    });
  }

  async listAuditLogs(admin: Actor, page: number, pageSize: number): Promise<PaginatedResult<AuditLogEntry>> {
    return this.db.withTenant(admin.tenantId, () => this.repos.auditLogRepo.findPageByTenant(admin.tenantId, page, pageSize));
  }

  async listAnomalies(admin: Actor, query: AnomalyListQuery): Promise<PaginatedResult<Anomaly>> {
    return this.db.withTenant(admin.tenantId, () => this.repos.anomalyRepo.findPageByTenant(admin.tenantId, query));
  }

  async resolveAnomaly(admin: Actor, anomalyId: string): Promise<Anomaly> {
    return this.db.withTenant(admin.tenantId, async () => {
      const resolved = await this.repos.anomalyRepo.resolve(anomalyId, admin.id);
      if (!resolved) {
        const existing = await this.repos.anomalyRepo.findById(anomalyId);
        if (!existing || existing.tenantId !== admin.tenantId) throw new NotFoundError('Anomaly not found');
        throw new ConflictError('Anomaly has already been resolved');
      }
      await this.audit(admin, 'ANOMALY_RESOLVED', 'anomaly', anomalyId, { batchId: resolved.batchId });
      return resolved;
    });
  }

  async listPartners(requester: Actor): Promise<PartnerSummary[]> {
    const actors = await this.db.withTenant(requester.tenantId, () =>
      this.repos.actorRepo.findAllByTenant(requester.tenantId),
    );
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

  /**
   * Anomalies + recalls, newest first. Oversight roles see the whole tenant;
   * everyone else only batches they created, hold, or recorded an event on —
   * filtered in SQL, so the LIMIT applies to what the requester may see.
   */
  async listNotifications(limit: number, requester: Actor): Promise<NotificationItem[]> {
    const involving = OVERSIGHT_ROLES.includes(requester.role) ? undefined : requester.id;

    const [anomalies, recallLogs] = await this.db.withTenant(requester.tenantId, () =>
      Promise.all([
        this.repos.anomalyRepo.findRecent(requester.tenantId, limit, involving),
        this.repos.auditLogRepo.findRecentBatchAction(requester.tenantId, 'BATCH_RECALLED', limit, involving),
      ]),
    );

    const anomalyItems: NotificationItem[] = anomalies.map((a) => ({
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

    return [...anomalyItems, ...recallItems]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  /**
   * Re-verifies every batch's hash chain — including that it still ends at
   * the head the database recorded, which is what exposes a deleted tail —
   * and raises a CHAIN_TAMPERED anomaly for each one that fails. Tampering
   * can only be discovered at read time, so this runs in the background at
   * startup and on demand via POST /api/admin/scan-integrity.
   *
   * Pass `onlyTenantId` to scan one tenant (the admin endpoint); omit it for
   * the system-wide startup sweep. Each tenant is walked in keyset-paginated
   * pages, one transaction per page, so memory stays bounded and no lock or
   * connection is held for the length of a whole tenant.
   */
  async scanForTamperedChains(onlyTenantId?: string): Promise<Anomaly[]> {
    const tenantIds = onlyTenantId ? [onlyTenantId] : await this.repos.tenantRepo.listIds();
    const created: Anomaly[] = [];

    for (const tenantId of tenantIds) {
      let afterId: string | null = null;
      for (;;) {
        const cursor: string | null = afterId;
        const page = await this.db.withTenant(tenantId, async () => {
          const batches = await this.repos.batchRepo.findPageAfter(tenantId, cursor, SCAN_PAGE_SIZE);
          const events = await this.repos.eventRepo.findByBatchIds(batches.map((b) => b.id));
          const eventsByBatch = groupByBatch(events);

          for (const batch of batches) {
            const chain = eventsByBatch.get(batch.id) ?? [];
            const head = { hash: batch.headHash, eventCount: batch.eventCount };
            if (verifyChain(chain, { legacyKey: this.legacyLedgerKey, head })) continue;

            const anomaly = await this.repos.anomalyRepo.createTamperAlertIfAbsent({
              id: uuidv4(),
              type: 'CHAIN_TAMPERED',
              severity: 'CRITICAL',
              message: `Phát hiện dữ liệu bị can thiệp trong chuỗi hash của lô hàng "${batch.productName}"`,
              batchId: batch.id,
              tenantId,
              detectedAt: new Date(),
              resolved: false,
            });
            if (!anomaly) continue; // already flagged and still open

            created.push(anomaly);
            await this.repos.auditLogRepo.create({
              id: uuidv4(),
              actorId: null,
              tenantId,
              action: 'CHAIN_INTEGRITY_SCAN_FLAGGED',
              entityType: 'batch',
              entityId: batch.id,
              metadata: {},
              createdAt: new Date(),
            });
          }
          return batches;
        });

        if (page.length < SCAN_PAGE_SIZE) break;
        afterId = page[page.length - 1].id;
      }
    }

    return created;
  }

  private async audit(
    admin: Actor,
    action: string,
    entityType: string,
    entityId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.repos.auditLogRepo.create({
      id: uuidv4(),
      actorId: admin.id,
      tenantId: admin.tenantId,
      action,
      entityType,
      entityId,
      metadata,
      createdAt: new Date(),
    });
  }
}

function groupByBatch(events: TraceEvent[]): Map<string, TraceEvent[]> {
  const map = new Map<string, TraceEvent[]>();
  for (const event of events) {
    const list = map.get(event.batchId);
    if (list) list.push(event);
    else map.set(event.batchId, [event]);
  }
  return map;
}
