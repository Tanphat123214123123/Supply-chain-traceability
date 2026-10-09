import jwt from 'jsonwebtoken';
import { AnchorStore, EventAnchorProof } from '../anchor/anchorStore';
import { Database } from '../db/database';
import {
  Actor,
  Batch,
  EventKind,
  EventLink,
  PUBLIC_EVENT_FIELDS,
  PublicJourneyStep,
  PublicOrigins,
  PublicTrace,
  SupplyChainStage,
  TraceEvent,
  TraceResult,
} from '../domain/types';
import { ForbiddenError } from '../errors';
import {
  ChainProblem,
  DisclosureV3,
  discloseV3,
  GENESIS_HASH,
  hashOfDisclosure,
  publicClaimNames,
  verifyChainDetailed,
  VerifyOptions,
} from '../ledger/hashChain';
import { IActorRepo, IAnomalyRepo, IBatchRepo, IEventRepo } from '../repository/interfaces';
import { LineageService } from './lineageService';
import { NotFoundError } from './supplyChainService';

export type TraceDirection = 'forward' | 'backward';

export interface TraceRepos {
  batchRepo: IBatchRepo;
  eventRepo: IEventRepo;
  anomalyRepo: IAnomalyRepo;
  actorRepo: IActorRepo;
}

/** Only the whitelisted, scalar facts of an event may leave the tenant. */
function publicDetails(event: TraceEvent): PublicJourneyStep['details'] {
  const details: PublicJourneyStep['details'] = {};
  for (const key of PUBLIC_EVENT_FIELDS[event.stage]) {
    const value = event.data[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') details[key] = value;
  }
  return details;
}

export type VerificationAccess = 'public' | 'full';

/**
 * One event as handed to an independent verifier (docs/SPEC_PHASE1.md §6).
 * Public access never carries actorId, notes, tenantId or non-public data.
 */
export interface VerificationEvent {
  id: string;
  sequenceNumber: number;
  stage: SupplyChainStage;
  kind: EventKind;
  timestamp: Date;
  hash: string;
  prevHash: string;
  hashVersion: 1 | 2 | 3;
  links: EventLink[];
  /** v3: envelope + opened claims + hidden commitments. In full access every claim is opened. */
  disclosure?: DisclosureV3;
  /** v2 in full access only: the whole event and its salt. */
  contentV2?: { actorId: string; location: string; notes: string | null; data: Record<string, unknown>; salt: string };
  anchor?: Omit<EventAnchorProof, 'eventId'>;
}

/** What the server itself concluded — the browser recomputes everything regardless. */
export interface ServerCheck {
  valid: boolean;
  problem?: ChainProblem | 'DISCLOSURE_MISMATCH';
  brokenAtIndex?: number;
  headMatches: boolean;
}

export interface VerificationPayload {
  access: VerificationAccess;
  /** Set for full access: when the link stops working. */
  expiresAt?: Date;
  batch: Pick<Batch, 'id' | 'productName' | 'headHash' | 'eventCount'>;
  events: VerificationEvent[];
  serverCheck: ServerCheck;
}

const VERIFY_TOKEN_TYPE = 'verify-link';

export class TraceService {
  constructor(
    private readonly db: Database,
    private readonly repos: TraceRepos,
    /** Only needed to re-verify legacy v1 (HMAC) events; v2/v3 events need no secret at all. */
    private readonly legacyLedgerKey: string | undefined,
    private readonly anchorStore: AnchorStore,
    /** Signs and checks verification-link tokens. */
    private readonly tokenSecret: string,
    private readonly lineage?: LineageService,
  ) {}

  /** Consumer-safe summary of what fed a lot: counts, regions, producer organizations — no lot ids, no people. */
  private async publicOrigins(batch: Batch): Promise<PublicOrigins | undefined> {
    if (!this.lineage) return undefined;
    const graph = await this.lineage.lineageInScope(batch.id, batch.tenantId);
    if (graph.upstream.length === 0) return undefined;
    const roots = graph.rootLotIds.map((id) => graph.lots[id]).filter(Boolean);
    const regionCount = new Map<string, number>();
    for (const r of roots) regionCount.set(r.origin, (regionCount.get(r.origin) ?? 0) + 1);
    const producers = new Set<string>();
    const rootLots = await this.repos.batchRepo.findByIds(graph.rootLotIds);
    for (const creatorId of new Set(rootLots.map((l) => l.createdBy))) {
      const creator = await this.repos.actorRepo.findById(creatorId);
      if (creator) producers.add(creator.organization);
    }
    const steps = new Map<string, { kind: PublicOrigins['steps'][number]['kind']; at: Date; inputCount: number }>();
    for (const e of graph.upstream) {
      const s = steps.get(e.transformationId) ?? { kind: e.kind, at: e.createdAt, inputCount: 0 };
      s.inputCount += 1;
      steps.set(e.transformationId, s);
    }
    return {
      harvestLotCount: roots.length,
      regions: [...regionCount.entries()].sort((a, b) => b[1] - a[1]).map(([r]) => r).slice(0, 10),
      producers: [...producers].sort().slice(0, 20),
      plotCount: new Set(roots.map((r) => r.plotId).filter(Boolean)).size,
      steps: [...steps.values()].sort((a, b) => a.at.getTime() - b.at.getTime()),
    };
  }

  private verifyOptions(batch: Batch): VerifyOptions {
    return { legacyKey: this.legacyLedgerKey, head: { hash: batch.headHash, eventCount: batch.eventCount } };
  }

  async trace(batchId: string, direction: TraceDirection, requester: Actor): Promise<TraceResult> {
    return this.db.withTenant(requester.tenantId, async () => {
      const batch = await this.repos.batchRepo.findById(batchId);
      if (!batch || batch.tenantId !== requester.tenantId) throw new NotFoundError('Batch not found');

      const [ascending, anomalies] = await Promise.all([
        this.repos.eventRepo.findByBatchId(batchId),
        this.repos.anomalyRepo.findByBatchId(batchId),
      ]);
      const { valid } = verifyChainDetailed(ascending, this.verifyOptions(batch));
      const events = direction === 'backward' ? [...ascending].reverse() : ascending;
      return { batch, events, anomalies, isValid: valid };
    });
  }

  /**
   * Public lookups arrive with only a batch id (from a QR code), so the
   * owning tenant is resolved first through a SECURITY DEFINER function that
   * reveals nothing but that id — everything after runs in a normal
   * tenant-scoped transaction under row-level security.
   */
  private async inPublicScope<T>(batchId: string, fn: (batch: Batch) => Promise<T>): Promise<T> {
    const tenantId = await this.repos.batchRepo.resolveTenantId(batchId);
    if (!tenantId) throw new NotFoundError('Batch not found');
    return this.db.withTenant(tenantId, async () => {
      const batch = await this.repos.batchRepo.findById(batchId);
      if (!batch) throw new NotFoundError('Batch not found');
      return fn(batch);
    });
  }

  async publicTrace(batchId: string): Promise<PublicTrace> {
    return this.inPublicScope(batchId, async (batch) => {
      const [events, anomalies] = await Promise.all([
        this.repos.eventRepo.findByBatchId(batchId),
        this.repos.anomalyRepo.findByBatchId(batchId),
      ]);
      const { valid } = verifyChainDetailed(events, this.verifyOptions(batch));

      // Organizations, never people: a consumer sees "Xưởng chế biến An Giang",
      // not the name or email of the employee who scanned the batch in.
      const organizations = new Map<string, string>();
      for (const actorId of new Set(events.map((e) => e.actorId))) {
        const actor = await this.repos.actorRepo.findById(actorId);
        organizations.set(actorId, actor?.organization ?? '');
      }
      const journey: PublicJourneyStep[] = events.map((e) => ({
        stage: e.stage,
        timestamp: e.timestamp,
        location: e.location,
        organization: organizations.get(e.actorId) ?? '',
        details: publicDetails(e),
      }));

      return {
        batch: {
          id: batch.id,
          productName: batch.productName,
          productType: batch.productType,
          origin: batch.origin,
          currentStage: batch.currentStage,
          isRecalled: batch.isRecalled,
          recallReason: batch.recallReason,
        },
        stageCount: new Set(events.map((e) => e.stage)).size,
        isValid: valid,
        hasAnomalies: anomalies.some((a) => !a.resolved),
        journey,
        origins: await this.publicOrigins(batch),
      };
    });
  }

  // ── Verification links ──────────────────────────────────────────────────

  /** A signed, expiring link that opens every field of the batch's events to its holder (auditor, buyer). */
  async createVerificationLink(actor: Actor, batchId: string, days: number): Promise<{ token: string; expiresAt: Date }> {
    return this.db.withTenant(actor.tenantId, async () => {
      const batch = await this.repos.batchRepo.findById(batchId);
      if (!batch || batch.tenantId !== actor.tenantId) throw new NotFoundError('Batch not found');
      const expiresInSeconds = Math.round(days * 24 * 60 * 60);
      const token = jwt.sign({ typ: VERIFY_TOKEN_TYPE, bid: batch.id, tid: batch.tenantId }, this.tokenSecret, {
        expiresIn: expiresInSeconds,
      });
      return { token, expiresAt: new Date(Date.now() + expiresInSeconds * 1000) };
    });
  }

  /** Full access when `token` is a valid, unexpired link for exactly this batch; throws on a bad token. */
  private accessFor(batch: Batch, token: string | undefined): { access: VerificationAccess; expiresAt?: Date } {
    if (!token) return { access: 'public' };
    try {
      const claims = jwt.verify(token, this.tokenSecret) as { typ?: string; bid?: string; tid?: string; exp?: number };
      if (claims.typ === VERIFY_TOKEN_TYPE && claims.bid === batch.id && claims.tid === batch.tenantId) {
        return { access: 'full', expiresAt: claims.exp ? new Date(claims.exp * 1000) : undefined };
      }
    } catch {
      // fall through
    }
    throw new ForbiddenError('Verification link is invalid or has expired');
  }

  /**
   * Material for the independent verifier (frontend /verify). Public access
   * follows the SPEC §1.1 disclosure table; full access (a verification link)
   * opens every field. Either way, every event comes with its Merkle proof
   * once anchored, so the browser can check it against the contract itself.
   */
  async verifyPublic(batchId: string, token?: string): Promise<VerificationPayload> {
    return this.inPublicScope(batchId, async (batch) => {
      const { access, expiresAt } = this.accessFor(batch, token);
      const events = await this.repos.eventRepo.findByBatchId(batchId);
      const proofs = await this.anchorStore.proofsForEvents(events.map((e) => e.id));

      const out: VerificationEvent[] = events.map((e) => {
        const base: VerificationEvent = {
          id: e.id,
          sequenceNumber: e.sequenceNumber,
          stage: e.stage,
          kind: e.kind,
          timestamp: e.timestamp,
          hash: e.hash,
          prevHash: e.prevHash,
          hashVersion: e.hashVersion,
          links: e.links,
        };
        if (e.hashVersion === 3 && e.claimSalts) {
          const visible = publicClaimNames(e.stage);
          base.disclosure = discloseV3(e, e.claimSalts, (name) => access === 'full' || visible.has(name));
        } else if (e.hashVersion === 2 && access === 'full' && e.salt) {
          base.contentV2 = { actorId: e.actorId, location: e.location, notes: e.notes ?? null, data: e.data, salt: e.salt };
        }
        const proof = proofs.get(e.id);
        if (proof) base.anchor = { leafIndex: proof.leafIndex, proof: proof.proof, anchor: proof.anchor };
        return base;
      });

      return {
        access,
        expiresAt,
        batch: { id: batch.id, productName: batch.productName, headHash: batch.headHash, eventCount: batch.eventCount },
        events: out,
        serverCheck: this.serverCheck(batch, events, out, access),
      };
    });
  }

  private serverCheck(batch: Batch, events: TraceEvent[], out: VerificationEvent[], access: VerificationAccess): ServerCheck {
    if (access === 'full') {
      const v = verifyChainDetailed(events, this.verifyOptions(batch));
      return { valid: v.valid, problem: v.problem, brokenAtIndex: v.brokenAtIndex, headMatches: v.headMatches ?? false };
    }
    // Public: linkage + head, and every v3 disclosure must reproduce its stored hash.
    let expected = GENESIS_HASH;
    let problem: ServerCheck['problem'];
    let brokenAtIndex: number | undefined;
    out.forEach((e, i) => {
      if (problem) return;
      if (e.prevHash !== expected || e.sequenceNumber !== i) {
        problem = 'BROKEN_LINK';
        brokenAtIndex = i;
      } else if (e.disclosure && hashOfDisclosure(e.disclosure) !== e.hash) {
        problem = 'DISCLOSURE_MISMATCH';
        brokenAtIndex = i;
      }
      expected = e.hash;
    });
    const headMatches = batch.eventCount === out.length && batch.headHash === expected;
    if (!problem && !headMatches) problem = 'HEAD_MISMATCH';
    return { valid: !problem, problem, brokenAtIndex, headMatches };
  }
}
