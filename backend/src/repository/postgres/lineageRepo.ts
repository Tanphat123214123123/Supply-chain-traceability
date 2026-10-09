import { Database, isUuid } from '../../db/database';
import { SupplyChainStage, TransformationKind } from '../../domain/types';

export interface TransformationRecord {
  id: string;
  tenantId: string;
  kind: TransformationKind;
  stage: SupplyChainStage;
  actorId: string;
  location: string;
  notes?: string;
  createdAt: Date;
}

/** One edge of the lineage graph: `fromLotId` (input) fed `toLotId` (output) through a transformation. */
export interface LineageEdge {
  transformationId: string;
  kind: TransformationKind;
  fromLotId: string;
  toLotId: string;
  quantity: number;
  unit: string;
  createdAt: Date;
}

export const MAX_LINEAGE_DEPTH = 32;

/**
 * Transformations (EPCIS transformation/aggregation events) and the lot
 * graph they form — docs/SPEC_PHASE1.md §3. Every method runs inside the
 * tenant's scope (RLS).
 */
export class PostgresLineageRepo {
  constructor(private readonly db: Database) {}

  async createTransformation(t: TransformationRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO transformations (id, tenant_id, kind, stage, actor_id, location, notes, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [t.id, t.tenantId, t.kind, t.stage, t.actorId, t.location, t.notes ?? null, t.createdAt],
    );
  }

  async addInput(input: {
    transformationId: string;
    tenantId: string;
    lotId: string;
    quantity: number;
    unit: string;
    headHash: string;
    eventCount: number;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO transformation_inputs (transformation_id, tenant_id, lot_id, quantity, unit, head_hash, event_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [input.transformationId, input.tenantId, input.lotId, input.quantity, input.unit, input.headHash, input.eventCount],
    );
    // The CHECK (consumed_quantity <= quantity) makes over-consumption impossible even under a race.
    await this.db.query('UPDATE batches SET consumed_quantity = consumed_quantity + $2 WHERE id = $1', [input.lotId, input.quantity]);
  }

  async addOutput(transformationId: string, tenantId: string, lotId: string): Promise<void> {
    await this.db.query('INSERT INTO transformation_outputs (transformation_id, tenant_id, lot_id) VALUES ($1, $2, $3)', [
      transformationId,
      tenantId,
      lotId,
    ]);
  }

  /** Every edge reachable upstream (towards the plots) or downstream (towards the shelf) from `lotId`. */
  async edges(lotId: string, direction: 'up' | 'down'): Promise<LineageEdge[]> {
    if (!isUuid(lotId)) return [];
    // up:   lot ← produced by T ← T consumed X   (follow outputs → inputs)
    // down: lot → consumed by T → T produced Y   (follow inputs → outputs)
    const [walkJoin, nextLot, edgeJoin] =
      direction === 'up'
        ? [
            `JOIN transformation_outputs o ON o.lot_id = w.lot
             JOIN transformation_inputs ti ON ti.transformation_id = o.transformation_id`,
            'ti.lot_id',
            `JOIN transformation_outputs o ON o.lot_id = w.lot
             JOIN transformation_inputs ti ON ti.transformation_id = o.transformation_id`,
          ]
        : [
            `JOIN transformation_inputs ti ON ti.lot_id = w.lot
             JOIN transformation_outputs o ON o.transformation_id = ti.transformation_id`,
            'o.lot_id',
            `JOIN transformation_inputs ti ON ti.lot_id = w.lot
             JOIN transformation_outputs o ON o.transformation_id = ti.transformation_id`,
          ];
    const result = await this.db.query<{
      transformation_id: string;
      kind: TransformationKind;
      from_lot: string;
      to_lot: string;
      quantity: string;
      unit: string;
      created_at: Date;
    }>(
      `WITH RECURSIVE walk(lot, depth) AS (
         SELECT $1::uuid, 0
         UNION
         SELECT ${nextLot}, w.depth + 1
           FROM walk w
           ${walkJoin}
          WHERE w.depth < ${MAX_LINEAGE_DEPTH}
       )
       SELECT DISTINCT ti.transformation_id, t.kind, ti.lot_id AS from_lot, o.lot_id AS to_lot, ti.quantity, ti.unit, t.created_at
         FROM (SELECT DISTINCT lot FROM walk) w
         ${edgeJoin}
         JOIN transformations t ON t.id = ti.transformation_id
        ORDER BY t.created_at, from_lot, to_lot`,
      [lotId],
    );
    return result.rows.map((r) => ({
      transformationId: r.transformation_id,
      kind: r.kind,
      fromLotId: r.from_lot,
      toLotId: r.to_lot,
      quantity: Number(r.quantity),
      unit: r.unit,
      createdAt: r.created_at,
    }));
  }

  /** (min, max) output/input ratio for a transform between two product types, if the platform knows one. */
  async conversionFactor(fromType: string, toType: string): Promise<{ min: number; max: number } | null> {
    const r = await this.db.query<{ min_ratio: string; max_ratio: string }>(
      'SELECT min_ratio, max_ratio FROM conversion_factors WHERE from_type = $1 AND to_type = $2',
      [fromType, toType],
    );
    return r.rows[0] ? { min: Number(r.rows[0].min_ratio), max: Number(r.rows[0].max_ratio) } : null;
  }

  async yieldCap(productType: string): Promise<number | null> {
    const r = await this.db.query<{ max_kg_per_ha: string }>('SELECT max_kg_per_ha FROM yield_caps WHERE product_type = $1', [
      productType,
    ]);
    return r.rows[0] ? Number(r.rows[0].max_kg_per_ha) : null;
  }

  /** Harvest lots from one plot within the 365 days before `asOf` (quantities as recorded, with units). */
  async plotHarvests(plotId: string, asOf: Date): Promise<Array<{ productType: string; quantity: number; unit: string }>> {
    const r = await this.db.query<{ product_type: string; quantity: string; unit: string }>(
      `SELECT product_type, quantity, unit FROM batches
        WHERE plot_id = $1 AND created_at > $2::timestamptz - interval '365 days' AND created_at <= $2`,
      [plotId, asOf],
    );
    return r.rows.map((x) => ({ productType: x.product_type, quantity: Number(x.quantity), unit: x.unit }));
  }
}

/** Mass in kg, or null for count units (bao, thùng…) that have no fixed weight. SPEC §5. */
export function toKg(quantity: number, unit: string): number | null {
  const u = unit.trim().toLowerCase();
  if (u === 'kg') return quantity;
  if (u === 'tấn' || u === 'tan' || u === 't') return quantity * 1000;
  if (u === 'g') return quantity / 1000;
  return null;
}
