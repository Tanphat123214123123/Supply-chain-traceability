import { Pool } from 'pg';
import { Batch, BatchListQuery, PaginatedResult, SupplyChainStage } from '../../domain/types';
import { IBatchRepo } from '../interfaces';

interface BatchRow {
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
}

function toBatch(row: BatchRow): Batch {
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
  };
}

export class PostgresBatchRepo implements IBatchRepo {
  constructor(private readonly pool: Pool) {}

  async create(batch: Batch): Promise<Batch> {
    await this.pool.query(
      `INSERT INTO batches (id, product_name, product_type, origin, quantity, unit, created_at, created_by, tenant_id, current_stage, is_recalled, recall_reason, metadata, assigned_to_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
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
    return batch;
  }

  async findById(id: string): Promise<Batch | null> {
    const result = await this.pool.query<BatchRow>('SELECT * FROM batches WHERE id = $1', [id]);
    return result.rows[0] ? toBatch(result.rows[0]) : null;
  }

  async findAll(): Promise<Batch[]> {
    const result = await this.pool.query<BatchRow>('SELECT * FROM batches ORDER BY created_at DESC');
    return result.rows.map(toBatch);
  }

  async findAllByTenant(tenantId: string): Promise<Batch[]> {
    const result = await this.pool.query<BatchRow>(
      'SELECT * FROM batches WHERE tenant_id = $1 ORDER BY created_at DESC',
      [tenantId],
    );
    return result.rows.map(toBatch);
  }

  async findPageByTenant(tenantId: string, { page, pageSize, search }: BatchListQuery): Promise<PaginatedResult<Batch>> {
    const offset = (page - 1) * pageSize;
    const searchPattern = search ? `%${search}%` : null;

    const [rows, count] = await Promise.all([
      this.pool.query<BatchRow>(
        `SELECT * FROM batches
         WHERE tenant_id = $1
           AND ($4::text IS NULL
                OR product_name ILIKE $4 OR origin ILIKE $4 OR id::text LIKE $5)
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [tenantId, pageSize, offset, searchPattern, search ? `${search}%` : null],
      ),
      this.pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM batches
         WHERE tenant_id = $1
           AND ($2::text IS NULL
                OR product_name ILIKE $2 OR origin ILIKE $2 OR id::text LIKE $3)`,
        [tenantId, searchPattern, search ? `${search}%` : null],
      ),
    ]);

    return { items: rows.rows.map(toBatch), total: Number(count.rows[0]?.count ?? 0), page, pageSize };
  }

  async update(batch: Batch): Promise<Batch> {
    await this.pool.query(
      `UPDATE batches
       SET product_name = $2, product_type = $3, origin = $4, quantity = $5, unit = $6,
           current_stage = $7, is_recalled = $8, recall_reason = $9, metadata = $10, assigned_to_actor_id = $11
       WHERE id = $1`,
      [
        batch.id,
        batch.productName,
        batch.productType,
        batch.origin,
        batch.quantity,
        batch.unit,
        batch.currentStage,
        batch.isRecalled,
        batch.recallReason ?? null,
        JSON.stringify(batch.metadata ?? {}),
        batch.assignedToActorId ?? null,
      ],
    );
    return batch;
  }
}
