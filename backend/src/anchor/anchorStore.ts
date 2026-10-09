import { v4 as uuidv4 } from 'uuid';
import { Database, isUuid } from '../db/database';
import { buildMerkleTree } from '../ledger/merkle';

export type AnchorStatus = 'built' | 'submitted' | 'confirmed';

export interface AnchorRecord {
  id: string;
  root: string;
  leafCount: number;
  status: AnchorStatus;
  chainId: number;
  contractAddress: string;
  txHash?: string;
  blockNumber?: number;
  anchoredAt?: Date;
  attempts: number;
  lastError?: string;
  createdAt: Date;
  submittedAt?: Date;
  confirmedAt?: Date;
}

/** Where an event sits in an anchored tree — everything a verifier needs besides the event hash itself. */
export interface EventAnchorProof {
  eventId: string;
  leafIndex: number;
  proof: string[];
  anchor: Pick<AnchorRecord, 'root' | 'leafCount' | 'status' | 'chainId' | 'contractAddress' | 'txHash' | 'blockNumber' | 'anchoredAt'>;
}

interface AnchorRow {
  id: string;
  root: string;
  leaf_count: number;
  status: AnchorStatus;
  chain_id: number;
  contract_address: string;
  tx_hash: string | null;
  block_number: string | null;
  anchored_at: Date | null;
  attempts: number;
  last_error: string | null;
  created_at: Date;
  submitted_at: Date | null;
  confirmed_at: Date | null;
}

const COLUMNS =
  'id, root, leaf_count, status, chain_id, contract_address, tx_hash, block_number, anchored_at, attempts, last_error, created_at, submitted_at, confirmed_at';

function toAnchor(row: AnchorRow): AnchorRecord {
  return {
    id: row.id,
    root: row.root,
    leafCount: row.leaf_count,
    status: row.status,
    chainId: row.chain_id,
    contractAddress: row.contract_address,
    txHash: row.tx_hash ?? undefined,
    blockNumber: row.block_number === null ? undefined : Number(row.block_number),
    anchoredAt: row.anchored_at ?? undefined,
    attempts: row.attempts,
    lastError: row.last_error ?? undefined,
    createdAt: row.created_at,
    submittedAt: row.submitted_at ?? undefined,
    confirmedAt: row.confirmed_at ?? undefined,
  };
}

// Arbitrary but fixed: serialises batch building across worker replicas.
const BUILD_LOCK_KEY = 72_410_002;

/**
 * Persistence for anchoring. `anchors` holds only public data and is not
 * tenant-scoped; `anchor_leaves` is, like the events it points at.
 */
export class AnchorStore {
  constructor(private readonly db: Database) {}

  /** The single anchor that is built or submitted but not yet confirmed, if any. */
  async findInFlight(): Promise<AnchorRecord | null> {
    const result = await this.db.query<AnchorRow>(`SELECT ${COLUMNS} FROM anchors WHERE status <> 'confirmed' LIMIT 1`);
    return result.rows[0] ? toAnchor(result.rows[0]) : null;
  }

  async findRecent(limit: number): Promise<AnchorRecord[]> {
    const result = await this.db.query<AnchorRow>(`SELECT ${COLUMNS} FROM anchors ORDER BY created_at DESC LIMIT $1`, [limit]);
    return result.rows.map(toAnchor);
  }

  /**
   * Builds the next batch atomically: ONE transaction collects every tenant's
   * not-yet-anchored events (switching the RLS tenant setting per tenant),
   * builds the Merkle tree, and records the anchor plus every leaf and proof.
   * An event that is in a batch is never picked again, so a crash at any
   * point can neither lose nor duplicate an event. Returns null when there is
   * nothing to anchor or a batch is already in flight.
   */
  async buildBatch(params: { maxLeaves: number; chainId: number; contractAddress: string }): Promise<AnchorRecord | null> {
    const client = await this.db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [BUILD_LOCK_KEY]);

      const inFlight = await client.query(`SELECT 1 FROM anchors WHERE status <> 'confirmed' LIMIT 1`);
      if (inFlight.rowCount) {
        await client.query('ROLLBACK');
        return null;
      }

      const tenants = await client.query<{ id: string }>('SELECT id FROM tenants ORDER BY id');
      const pending: Array<{ id: string; tenantId: string; hash: string; timestamp: Date }> = [];
      for (const { id: tenantId } of tenants.rows) {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
        const rows = await client.query<{ id: string; hash: string; timestamp: Date }>(
          `SELECT e.id, e.hash, e.timestamp
             FROM trace_events e
            WHERE NOT EXISTS (SELECT 1 FROM anchor_leaves l WHERE l.event_id = e.id)
            ORDER BY e.timestamp, e.id
            LIMIT $1`,
          [params.maxLeaves],
        );
        for (const r of rows.rows) pending.push({ ...r, tenantId });
      }

      // Oldest first across all tenants, then cap — SPEC §2.1 leaf order.
      pending.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const leaves = pending.slice(0, params.maxLeaves);
      if (leaves.length === 0) {
        await client.query('ROLLBACK');
        return null;
      }

      const tree = buildMerkleTree(leaves.map((l) => l.hash));
      const anchorId = uuidv4();
      const inserted = await client.query<AnchorRow>(
        `INSERT INTO anchors (id, root, leaf_count, status, chain_id, contract_address)
         VALUES ($1, $2, $3, 'built', $4, $5)
         RETURNING ${COLUMNS}`,
        [anchorId, tree.root, tree.size, params.chainId, params.contractAddress],
      );

      const byTenant = new Map<string, number[]>();
      leaves.forEach((l, i) => byTenant.set(l.tenantId, [...(byTenant.get(l.tenantId) ?? []), i]));
      for (const [tenantId, indexes] of byTenant) {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
        await client.query(
          `INSERT INTO anchor_leaves (event_id, tenant_id, anchor_id, leaf_index, proof)
           SELECT x.event_id, $1, $2, x.leaf_index, ARRAY(SELECT jsonb_array_elements_text(x.proof))
             FROM jsonb_to_recordset($3::jsonb) AS x(event_id uuid, leaf_index int, proof jsonb)`,
          [
            tenantId,
            anchorId,
            JSON.stringify(indexes.map((i) => ({ event_id: leaves[i].id, leaf_index: i, proof: tree.proofs[i] }))),
          ],
        );
      }

      await client.query('COMMIT');
      return toAnchor(inserted.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /** `at` comes from the worker's clock — the same clock it later measures the resubmit window with. */
  async markSubmitted(id: string, txHash: string, at: Date): Promise<void> {
    await this.db.query(
      `UPDATE anchors SET status = 'submitted', tx_hash = $2, submitted_at = $3, attempts = attempts + 1, last_error = NULL
        WHERE id = $1`,
      [id, txHash.toLowerCase(), at],
    );
  }

  /** Back to `built` so the next tick resends — the contract rejects a duplicate root, so this is safe. */
  async markForResubmit(id: string, error: string): Promise<void> {
    await this.db.query(`UPDATE anchors SET status = 'built', last_error = $2 WHERE id = $1`, [id, error.slice(0, 1000)]);
  }

  async recordError(id: string, error: string): Promise<void> {
    await this.db.query(`UPDATE anchors SET attempts = attempts + 1, last_error = $2 WHERE id = $1`, [id, error.slice(0, 1000)]);
  }

  async markConfirmed(id: string, blockNumber: number, anchoredAt: Date): Promise<void> {
    await this.db.query(
      `UPDATE anchors SET status = 'confirmed', block_number = $2, anchored_at = $3, confirmed_at = now(), last_error = NULL
        WHERE id = $1`,
      [id, blockNumber, anchoredAt],
    );
  }

  /** Proofs for some events — must run inside their tenant's scope (anchor_leaves is RLS-protected). */
  async proofsForEvents(eventIds: string[]): Promise<Map<string, EventAnchorProof>> {
    const ids = eventIds.filter(isUuid);
    if (ids.length === 0) return new Map();
    const result = await this.db.query<AnchorRow & { event_id: string; leaf_index: number; proof: string[] }>(
      `SELECT l.event_id, l.leaf_index, l.proof, a.id, a.root, a.leaf_count, a.status, a.chain_id, a.contract_address,
              a.tx_hash, a.block_number, a.anchored_at, a.attempts, a.last_error, a.created_at, a.submitted_at, a.confirmed_at
         FROM anchor_leaves l
         JOIN anchors a ON a.id = l.anchor_id
        WHERE l.event_id = ANY ($1::uuid[])`,
      [ids],
    );
    return new Map(
      result.rows.map((row) => {
        const a = toAnchor(row);
        return [
          row.event_id,
          {
            eventId: row.event_id,
            leafIndex: row.leaf_index,
            proof: row.proof.map((p) => p.trim()),
            anchor: {
              root: a.root,
              leafCount: a.leafCount,
              status: a.status,
              chainId: a.chainId,
              contractAddress: a.contractAddress,
              txHash: a.txHash,
              blockNumber: a.blockNumber,
              anchoredAt: a.anchoredAt,
            },
          },
        ];
      }),
    );
  }
}
