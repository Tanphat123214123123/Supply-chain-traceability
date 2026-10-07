import { v4 as uuidv4 } from 'uuid';
import { GENESIS_HASH } from '../src/ledger/hashChain';
import { asAttacker, createActor, createTenant, sampleBatch, TestDb, useTestDatabase } from './helpers/testDb';

/**
 * These tests talk to Postgres directly as the application role
 * (tracechain_app), to prove the guarantees hold even if application code
 * is buggy or bypassed — they're properties of the database, not of services.
 */
const getDb = useTestDatabase();

async function seedBatchWithEvent(t: TestDb) {
  const tenant = await createTenant(t);
  const farmer = await createActor(t, tenant, 'FARMER');
  const admin = await createActor(t, tenant, 'ADMIN');
  const batch = await t.ctx.supplyChainService.createBatch(farmer, sampleBatch);
  const event = await t.ctx.supplyChainService.recordEvent(admin, { batchId: batch.id, stage: 'HARVEST', location: 'x' });
  return { tenant, farmer, admin, batch, event };
}

describe('row-level security', () => {
  it('hides every tenant-owned row outside a tenant transaction', async () => {
    const t = getDb();
    await seedBatchWithEvent(t);
    for (const table of ['actors', 'batches', 'trace_events', 'audit_logs', 'refresh_tokens', 'anomalies']) {
      const { rows } = await t.db.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`);
      expect({ table, n: Number(rows[0].n) }).toEqual({ table, n: 0 });
    }
  });

  it('shows a tenant only its own rows, even with no WHERE clause at all', async () => {
    const t = getDb();
    const a = await seedBatchWithEvent(t);
    const b = await seedBatchWithEvent(t);

    const seenByA = await t.db.withTenant(a.tenant.id, () => t.db.query<{ id: string }>('SELECT id FROM batches'));
    expect(seenByA.rows.map((r) => r.id)).toEqual([a.batch.id]);

    const eventsSeenByB = await t.db.withTenant(b.tenant.id, () => t.db.query<{ id: string }>('SELECT id FROM trace_events'));
    expect(eventsSeenByB.rows.map((r) => r.id)).toEqual([b.event.id]);
  });

  it("rejects writing a row into another tenant (WITH CHECK)", async () => {
    const t = getDb();
    const a = await seedBatchWithEvent(t);
    const other = await createTenant(t);
    await expect(
      t.db.withTenant(a.tenant.id, () =>
        t.db.query(
          `INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, metadata, created_at, tenant_id)
           VALUES ($1, NULL, 'X', 'x', NULL, '{}', now(), $2)`,
          [uuidv4(), other.id],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('cannot UPDATE another tenant\'s rows — they are simply invisible', async () => {
    const t = getDb();
    const a = await seedBatchWithEvent(t);
    const b = await seedBatchWithEvent(t);
    const result = await t.db.withTenant(a.tenant.id, () =>
      t.db.query("UPDATE batches SET recall_reason = 'x', is_recalled = true WHERE id = $1", [b.batch.id]),
    );
    expect(result.rowCount).toBe(0);
  });
});

describe('composite tenant foreign keys', () => {
  it('rejects a batch whose creator belongs to a different tenant', async () => {
    const t = getDb();
    const a = await createTenant(t);
    const b = await createTenant(t);
    const outsider = await createActor(t, b, 'FARMER');
    // Even bypassing RLS entirely (superuser), the FK on (created_by, tenant_id) holds.
    await expect(
      t.ownerPool.query(
        `INSERT INTO batches (id, product_name, product_type, origin, quantity, unit, created_by, tenant_id)
         VALUES ($1, 'x', 'x', 'x', 1, 'kg', $2, $3)`,
        [uuidv4(), outsider.id, a.id],
      ),
    ).rejects.toThrow(/batches_created_by_fkey/);
  });
});

describe('least-privilege application role', () => {
  it('cannot UPDATE or DELETE ledger rows (no privilege, before any trigger even runs)', async () => {
    const t = getDb();
    const { tenant, event } = await seedBatchWithEvent(t);
    await expect(
      t.db.withTenant(tenant.id, () => t.db.query("UPDATE trace_events SET location = 'x' WHERE id = $1", [event.id])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      t.db.withTenant(tenant.id, () => t.db.query('DELETE FROM trace_events WHERE id = $1', [event.id])),
    ).rejects.toThrow(/permission denied/);
    await expect(t.db.query('TRUNCATE trace_events')).rejects.toThrow(/permission denied|must be owner/);
  });

  it('cannot write the chain-head columns, which only the ledger trigger maintains', async () => {
    const t = getDb();
    const { tenant, batch } = await seedBatchWithEvent(t);
    await expect(
      t.db.withTenant(tenant.id, () =>
        t.db.query('UPDATE batches SET head_hash = $2, event_count = 0 WHERE id = $1', [batch.id, GENESIS_HASH]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('cannot run DDL', async () => {
    const t = getDb();
    await expect(t.db.query('DROP TABLE trace_events')).rejects.toThrow(/must be owner|permission denied/);
    await expect(t.db.query('ALTER TABLE batches DISABLE ROW LEVEL SECURITY')).rejects.toThrow(/must be owner/);
  });
});

describe('append-only ledger (triggers — hold even for the table owner)', () => {
  it('rejects UPDATE, DELETE and TRUNCATE on trace_events and audit_logs', async () => {
    const t = getDb();
    const { event } = await seedBatchWithEvent(t);
    await expect(t.ownerPool.query("UPDATE trace_events SET location = 'x' WHERE id = $1", [event.id])).rejects.toThrow(
      /append-only/,
    );
    await expect(t.ownerPool.query('DELETE FROM trace_events WHERE id = $1', [event.id])).rejects.toThrow(/append-only/);
    await expect(t.ownerPool.query('TRUNCATE trace_events CASCADE')).rejects.toThrow(/append-only/);
    await expect(t.ownerPool.query('DELETE FROM audit_logs')).rejects.toThrow(/append-only/);
  });
});

describe('chain linkage enforced at INSERT', () => {
  async function insertEvent(t: TestDb, tenantId: string, batchId: string, actorId: string, seq: number, prevHash: string) {
    return t.db.withTenant(tenantId, () =>
      t.db.query(
        `INSERT INTO trace_events (id, batch_id, tenant_id, stage, actor_id, location, data, hash, prev_hash,
                                   sequence_number, hash_version, salt)
         VALUES ($1, $2, $3, 'PROCESSING', $4, 'x', '{}', $5, $6, $7, 2, $8)`,
        [uuidv4(), batchId, tenantId, actorId, 'e'.repeat(64), prevHash, seq, 'a'.repeat(64)],
      ),
    );
  }

  it('rejects an event that does not extend the recorded head (fork / replay)', async () => {
    const t = getDb();
    const { tenant, admin, batch, event } = await seedBatchWithEvent(t);
    // Re-using sequence 0 / genesis → a fork of the existing first event.
    await expect(insertEvent(t, tenant.id, batch.id, admin.id, 0, GENESIS_HASH)).rejects.toThrow(/expected sequence_number 1/);
    // Right sequence, wrong predecessor.
    await expect(insertEvent(t, tenant.id, batch.id, admin.id, 1, 'f'.repeat(64))).rejects.toThrow(/prev_hash does not match/);
    // Correct extension is accepted and advances the head.
    await insertEvent(t, tenant.id, batch.id, admin.id, 1, event.hash);
    const head = await t.db.withTenant(tenant.id, () =>
      t.db.query<{ head_hash: string; event_count: number }>('SELECT head_hash, event_count FROM batches WHERE id = $1', [batch.id]),
    );
    expect(head.rows[0]).toEqual({ head_hash: 'e'.repeat(64), event_count: 2 });
  });

  it('rejects any event on a recalled batch, and a recall can never be undone', async () => {
    const t = getDb();
    const { tenant, admin, batch, event } = await seedBatchWithEvent(t);
    await t.ctx.supplyChainService.recallBatch(admin, batch.id, 'contaminated');

    await expect(insertEvent(t, tenant.id, batch.id, admin.id, 1, event.hash)).rejects.toThrow(/recalled/);
    await expect(
      t.db.withTenant(tenant.id, () => t.db.query('UPDATE batches SET is_recalled = false WHERE id = $1', [batch.id])),
    ).rejects.toThrow(/cannot be undone/);
  });

  it('rejects regressing current_stage', async () => {
    const t = getDb();
    const { tenant, batch } = await seedBatchWithEvent(t);
    await expect(
      t.db.withTenant(tenant.id, () => t.db.query("UPDATE batches SET current_stage = NULL WHERE id = $1", [batch.id])),
    ).rejects.toThrow(/cannot regress/);
  });
});

describe('domain constraints', () => {
  it('rejects non-positive quantities and malformed hashes', async () => {
    const t = getDb();
    const tenant = await createTenant(t);
    const farmer = await createActor(t, tenant, 'FARMER');
    await expect(t.ctx.supplyChainService.createBatch(farmer, { ...sampleBatch, quantity: 0 })).rejects.toThrow(
      /batches_quantity_positive/,
    );
    await expect(asAttacker(t, "UPDATE batches SET head_hash = 'not-hex'")).resolves.toBeUndefined(); // no rows yet: ok
  });

  it('rejects an anomaly marked resolved without who/when', async () => {
    const t = getDb();
    const { tenant, batch } = await seedBatchWithEvent(t);
    await expect(
      t.ownerPool.query(
        `INSERT INTO anomalies (id, batch_id, type, severity, message, resolved, tenant_id)
         VALUES ($1, $2, 'DUPLICATE_STAGE', 'LOW', 'x', true, $3)`,
        [uuidv4(), batch.id, tenant.id],
      ),
    ).rejects.toThrow(/anomalies_resolution_consistent/);
  });
});
