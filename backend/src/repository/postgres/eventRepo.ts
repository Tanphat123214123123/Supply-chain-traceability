import { Database, isUuid } from '../../db/database';
import { EventKind, EventLink, SupplyChainStage, TraceEvent } from '../../domain/types';
import { IEventRepo } from '../interfaces';

interface EventRow {
  id: string;
  batch_id: string;
  tenant_id: string;
  stage: SupplyChainStage;
  actor_id: string;
  timestamp: Date;
  location: string;
  notes: string | null;
  data: Record<string, unknown>;
  hash: string;
  prev_hash: string;
  sequence_number: number;
  hash_version: number;
  salt: string | null;
  kind: EventKind;
  links: EventLink[];
  claim_salts: Record<string, string> | null;
}

const COLUMNS =
  'id, batch_id, tenant_id, stage, actor_id, timestamp, location, notes, data, hash, prev_hash, sequence_number, hash_version, salt, kind, links, claim_salts';

export function toEvent(row: EventRow): TraceEvent {
  return {
    id: row.id,
    batchId: row.batch_id,
    tenantId: row.tenant_id,
    stage: row.stage,
    actorId: row.actor_id,
    timestamp: row.timestamp,
    location: row.location,
    notes: row.notes ?? undefined,
    data: row.data,
    hash: row.hash,
    prevHash: row.prev_hash,
    sequenceNumber: row.sequence_number,
    hashVersion: row.hash_version === 3 ? 3 : row.hash_version === 2 ? 2 : 1,
    salt: row.salt ?? undefined,
    kind: row.kind,
    links: row.links.map((l) => ({ ...l, quantity: Number(l.quantity) })),
    claimSalts: row.claim_salts ?? undefined,
  };
}

export class PostgresEventRepo implements IEventRepo {
  constructor(private readonly db: Database) {}

  /**
   * The BEFORE INSERT trigger (migration 007) re-checks sequence_number and
   * prev_hash against the batch's recorded head and advances that head — so
   * even a buggy caller cannot fork or rewind a chain.
   */
  async create(event: TraceEvent): Promise<TraceEvent> {
    await this.db.query(
      `INSERT INTO trace_events (id, batch_id, tenant_id, stage, actor_id, timestamp, location, notes, data,
                                 hash, prev_hash, sequence_number, hash_version, salt, kind, links, claim_salts)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
        event.id,
        event.batchId,
        event.tenantId,
        event.stage,
        event.actorId,
        event.timestamp,
        event.location,
        event.notes ?? null,
        JSON.stringify(event.data ?? {}),
        event.hash,
        event.prevHash,
        event.sequenceNumber,
        event.hashVersion,
        event.salt ?? null,
        event.kind,
        JSON.stringify(event.links),
        event.claimSalts ? JSON.stringify(event.claimSalts) : null,
      ],
    );
    return event;
  }

  async findByBatchId(batchId: string): Promise<TraceEvent[]> {
    if (!isUuid(batchId)) return [];
    const result = await this.db.query<EventRow>(
      `SELECT ${COLUMNS} FROM trace_events WHERE batch_id = $1 ORDER BY sequence_number ASC`,
      [batchId],
    );
    return result.rows.map(toEvent);
  }

  async findByBatchIds(batchIds: string[]): Promise<TraceEvent[]> {
    if (batchIds.length === 0) return [];
    const result = await this.db.query<EventRow>(
      `SELECT ${COLUMNS} FROM trace_events WHERE batch_id = ANY ($1::uuid[]) ORDER BY batch_id, sequence_number ASC`,
      [batchIds],
    );
    return result.rows.map(toEvent);
  }
}
