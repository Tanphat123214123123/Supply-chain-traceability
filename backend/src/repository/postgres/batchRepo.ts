import { Database, isUuid } from '../../db/database';
import { Batch, BatchListQuery, PaginatedResult, SupplyChainStage, STAGE_ORDER } from '../../domain/types';
import { BatchExportFilters, IBatchRepo, NewBatch } from '../interfaces';
import { escapeLike, involvesActor, WithTotal } from './sql';

export interface BatchRow {
  id: string;
  product_name: string;
  product_type: string;
  origin: string;
  quantity: string;
  unit: string;
  created_at: Date;
  created_by: string;
  tenant_id: string;
  current_stage: SupplyChainStage | null;
  is_recalled: boolean;
  recall_reason: string | null;
  metadata: Record<string, unknown>;
  assigned_to_actor_id: string | null;
  head_hash: string;
  event_count: number;
  last_event_at: Date | null;
}

// last_event_at rides on the UNIQUE (batch_id, sequence_number) index: the
// newest event is the one with the highest sequence number.
export const BATCH_COLUMNS = `b.id, b.product_name, b.product_type, b.origin, b.quantity, b.unit, b.created_at, b.created_by,
  b.tenant_id, b.current_stage, b.is_recalled, b.recall_reason, b.metadata, b.assigned_to_actor_id,
  b.head_hash, b.event_count,
  (SELECT le.timestamp FROM trace_events le WHERE le.batch_id = b.id
    ORDER BY le.sequence_number DESC LIMIT 1) AS last_event_at`;

export function toBatch(row: BatchRow): Batch {
  return {
    id: row.id,
    productName: row.product_name,
    productType: row.product_type,
    origin: row.origin,
    quantity: Number(row.quantity),
    unit: row.unit,
    createdAt: row.created_at,
    createdBy: row.created_by,
    tenantId: row.tenant_id,
    currentStage: row.current_stage,
    isRecalled: row.is_recalled,
    recallReason: row.recall_reason ?? undefined,
    metadata: row.metadata,
    assignedToActorId: row.assigned_to_actor_id ?? undefined,
    headHash: row.head_hash,
    eventCount: row.event_count,
    lastEventAt: row.last_event_at ?? undefined,
  };
}

export class PostgresBatchRepo implements IBatchRepo {
  constructor(private readonly db: Database) {}

  async create(batch: NewBatch): Promise<Batch> {
    // head_hash / event_count are deliberately omitted: they start at their
    // defaults (genesis, 0) and only the ledger trigger may advance them.
    const result = await this.db.query<BatchRow>(
      `INSERT INTO batches AS b (id, product_name, product_type, origin, quantity, unit, created_at, created_by,
                                 tenant_id, current_stage, is_recalled, recall_reason, metadata, assigned_to_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING ${BATCH_COLUMNS}`,
      [
        batch.id,
        batch.productName,
        batch.productType,
        batch.origin,
        batch.quantity,
        batch.unit,
        batch.createdAt,
        batch.createdBy,
        batch.tenantId,
        batch.currentStage,
        batch.isRecalled,
        batch.recallReason ?? null,
        JSON.stringify(batch.metadata ?? {}),
        batch.assignedToActorId ?? null,
      ],
    );
    return toBatch(result.rows[0]);
  }

  async findById(id: string): Promise<Batch | null> {
    if (!isUuid(id)) return null;
    const result = await this.db.query<BatchRow>(`SELECT ${BATCH_COLUMNS} FROM batches b WHERE b.id = $1`, [id]);
    return result.rows[0] ? toBatch(result.rows[0]) : null;
  }

  async findByIdForUpdate(id: string): Promise<Batch | null> {
    if (!isUuid(id)) return null;
    const result = await this.db.query<BatchRow>(`SELECT ${BATCH_COLUMNS} FROM batches b WHERE b.id = $1 FOR UPDATE`, [id]);
    return result.rows[0] ? toBatch(result.rows[0]) : null;
  }

  async resolveTenantId(batchId: string): Promise<string | null> {
    if (!isUuid(batchId)) return null;
    const result = await this.db.query<{ tenant_id: string | null }>('SELECT resolve_batch_tenant($1) AS tenant_id', [
      batchId,
    ]);
    return result.rows[0]?.tenant_id ?? null;
  }

  async hasAnyInTenant(tenantId: string): Promise<boolean> {
    const result = await this.db.query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM batches WHERE tenant_id = $1) AS exists',
      [tenantId],
    );
    return result.rows[0].exists;
  }

  async findPageByTenant(
    tenantId: string,
    { page, pageSize, search, stage }: BatchListQuery,
  ): Promise<PaginatedResult<Batch>> {
    const offset = (page - 1) * pageSize;
    const term = search?.trim() ? search.trim() : null;
    // $4: NULL = any stage, 'NONE' = no event recorded yet, otherwise that exact current stage.
    const where = `b.tenant_id = $1
      AND ($2::text IS NULL
           OR b.product_name ILIKE '%' || $2 || '%'
           OR b.origin ILIKE '%' || $2 || '%'
           OR b.id::text LIKE $3 || '%')
      AND ($4::text IS NULL
           OR ($4 = 'NONE' AND b.current_stage IS NULL)
           OR b.current_stage = $4)`;
    const params = [
      tenantId,
      term ? escapeLike(term) : null,
      term ? escapeLike(term.toLowerCase()) : null,
      stage ?? null,
    ];

    // One statement → items and total come from the same snapshot.
    const result = await this.db.query<BatchRow & WithTotal>(
      `SELECT ${BATCH_COLUMNS}, count(*) OVER () AS total_count
         FROM batches b
        WHERE ${where}
        ORDER BY b.created_at DESC, b.id DESC
        LIMIT $5 OFFSET $6`,
      [...params, pageSize, offset],
    );

    let total = result.rows[0] ? Number(result.rows[0].total_count) : 0;
    if (result.rows.length === 0 && offset > 0) {
      // Past the last page: the window count had no row to ride on.
      const count = await this.db.query<{ count: string }>(`SELECT count(*) AS count FROM batches b WHERE ${where}`, params);
      total = Number(count.rows[0].count);
    }
    return { items: result.rows.map(toBatch), total, page, pageSize };
  }

  async findForExport(tenantId: string, { from, to, origin }: BatchExportFilters): Promise<Batch[]> {
    const result = await this.db.query<BatchRow>(
      `SELECT ${BATCH_COLUMNS}
         FROM batches b
        WHERE b.tenant_id = $1
          AND ($2::timestamptz IS NULL OR b.created_at >= $2)
          AND ($3::timestamptz IS NULL OR b.created_at <= $3)
          AND ($4::text IS NULL OR b.origin ILIKE '%' || $4 || '%')
        ORDER BY b.created_at DESC, b.id DESC`,
      [tenantId, from ?? null, to ?? null, origin ? escapeLike(origin) : null],
    );
    return result.rows.map(toBatch);
  }

  async findPendingFor(
    tenantId: string,
    actorId: string,
    allowedStages: SupplyChainStage[],
    isAdmin: boolean,
  ): Promise<Batch[]> {
    // The next stage is STAGE_ORDER[index(current_stage) + 1] (first stage when
    // nothing is recorded yet); past the terminal stage the subscript is NULL,
    // which matches nothing.
    const result = await this.db.query<BatchRow>(
      `SELECT ${BATCH_COLUMNS}
         FROM batches b
        WHERE b.tenant_id = $1
          AND NOT b.is_recalled
          AND ($2::text[])[COALESCE(array_position($2::text[], b.current_stage), 0) + 1] = ANY ($3::text[])
          AND ($5 OR b.assigned_to_actor_id IS NULL OR b.assigned_to_actor_id = $4)
        ORDER BY b.created_at DESC, b.id DESC`,
      [tenantId, STAGE_ORDER, allowedStages, actorId, isAdmin],
    );
    return result.rows.map(toBatch);
  }

  async findInvolving(tenantId: string, actorId: string): Promise<Batch[]> {
    const result = await this.db.query<BatchRow>(
      `SELECT ${BATCH_COLUMNS}
         FROM batches b
        WHERE b.tenant_id = $1 AND ${involvesActor('$2')}
        ORDER BY b.created_at DESC, b.id DESC`,
      [tenantId, actorId],
    );
    return result.rows.map(toBatch);
  }

  async findPageAfter(tenantId: string, afterId: string | null, limit: number): Promise<Batch[]> {
    const result = await this.db.query<BatchRow>(
      `SELECT ${BATCH_COLUMNS}
         FROM batches b
        WHERE b.tenant_id = $1 AND ($2::uuid IS NULL OR b.id > $2)
        ORDER BY b.id
        LIMIT $3`,
      [tenantId, afterId, limit],
    );
    return result.rows.map(toBatch);
  }

  async advanceStage(id: string, stage: SupplyChainStage, assignedToActorId: string | null): Promise<void> {
    await this.db.query('UPDATE batches SET current_stage = $2, assigned_to_actor_id = $3 WHERE id = $1', [
      id,
      stage,
      assignedToActorId,
    ]);
  }

  async markRecalled(id: string, reason: string): Promise<Batch | null> {
    if (!isUuid(id)) return null;
    // Touches only the recall columns, in one statement: a concurrent
    // recordEvent advancing current_stage can't be overwritten by a stale copy.
    const result = await this.db.query<BatchRow>(
      `UPDATE batches AS b SET is_recalled = true, recall_reason = $2
        WHERE b.id = $1 AND NOT b.is_recalled
        RETURNING ${BATCH_COLUMNS}`,
      [id, reason],
    );
    return result.rows[0] ? toBatch(result.rows[0]) : null;
  }
}
