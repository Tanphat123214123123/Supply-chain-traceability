import { Pool } from 'pg';
import { Batch, SupplyChainStage } from '../../domain/types';
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
  current_stage: SupplyChainStage | null;
  is_recalled: boolean;
  recall_reason: string | null;
  metadata: Record<string, unknown>;
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
    currentStage: row.current_stage,
    isRecalled: row.is_recalled,
    recallReason: row.recall_reason ?? undefined,
    metadata: row.metadata,
  };
}

export class PostgresBatchRepo implements IBatchRepo {
  constructor(private readonly pool: Pool) {}

  async create(batch: Batch): Promise<Batch> {
    await this.pool.query(
      `INSERT INTO batches (id, product_name, product_type, origin, quantity, unit, created_at, created_by, current_stage, is_recalled, recall_reason, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        batch.id,
        batch.productName,
        batch.productType,
        batch.origin,
        batch.quantity,
        batch.unit,
        batch.createdAt,
        batch.createdBy,
        batch.currentStage,
        batch.isRecalled,
        batch.recallReason ?? null,
        JSON.stringify(batch.metadata ?? {}),
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

  async update(batch: Batch): Promise<Batch> {
    await this.pool.query(
      `UPDATE batches SET current_stage = $2, is_recalled = $3, recall_reason = $4 WHERE id = $1`,
      [batch.id, batch.currentStage, batch.isRecalled, batch.recallReason ?? null],
    );
    return batch;
  }
}
