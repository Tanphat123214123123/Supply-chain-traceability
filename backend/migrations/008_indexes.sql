-- 008: Indexes shaped after the queries the API actually runs.
--
-- Every list endpoint filters by tenant first, then sorts by time — so the
-- single-column indexes from 001/002/005 are replaced by composites that
-- serve filter + order in one index scan.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── Superseded / redundant ──────────────────────────────────────────────────
DROP INDEX IF EXISTS idx_batches_created_at;      -- → idx_batches_tenant_created
DROP INDEX IF EXISTS idx_batches_tenant;          -- → idx_batches_tenant_created
DROP INDEX IF EXISTS idx_anomalies_tenant;        -- → idx_anomalies_tenant_detected
DROP INDEX IF EXISTS idx_anomalies_resolved;      -- → idx_anomalies_tenant_resolved
DROP INDEX IF EXISTS idx_anomalies_batch_id;      -- → idx_anomalies_batch
DROP INDEX IF EXISTS idx_audit_logs_tenant;       -- → idx_audit_logs_tenant_created
DROP INDEX IF EXISTS idx_audit_logs_created_at;   -- → idx_audit_logs_tenant_created
DROP INDEX IF EXISTS idx_trace_events_batch_id;   -- duplicate of the UNIQUE (batch_id, sequence_number) index

-- ── batches ─────────────────────────────────────────────────────────────────
CREATE INDEX idx_batches_tenant_created ON batches (tenant_id, created_at DESC);
CREATE INDEX idx_batches_created_by     ON batches (created_by);
-- Substring search (ILIKE '%term%') on the batch list.
CREATE INDEX idx_batches_product_name_trgm ON batches USING gin (product_name gin_trgm_ops);
CREATE INDEX idx_batches_origin_trgm       ON batches USING gin (origin gin_trgm_ops);

-- ── trace_events ────────────────────────────────────────────────────────────
CREATE INDEX idx_trace_events_actor        ON trace_events (actor_id, timestamp DESC);
CREATE INDEX idx_trace_events_tenant_stage ON trace_events (tenant_id, stage);

-- ── anomalies ───────────────────────────────────────────────────────────────
CREATE INDEX idx_anomalies_batch           ON anomalies (batch_id, detected_at);
CREATE INDEX idx_anomalies_tenant_detected ON anomalies (tenant_id, detected_at DESC);
CREATE INDEX idx_anomalies_tenant_resolved ON anomalies (tenant_id, resolved, detected_at DESC);
CREATE INDEX idx_anomalies_event           ON anomalies (event_id) WHERE event_id IS NOT NULL;
CREATE INDEX idx_anomalies_resolved_by     ON anomalies (resolved_by) WHERE resolved_by IS NOT NULL;

-- At most one OPEN tamper alert per batch, so concurrent integrity scans
-- (two replicas booting at once) can't double-report the same incident.
-- Pre-existing duplicates — possible before this constraint — are collapsed
-- to the earliest one first.
DELETE FROM anomalies a
USING anomalies b
WHERE a.type = 'CHAIN_TAMPERED' AND b.type = 'CHAIN_TAMPERED'
  AND NOT a.resolved AND NOT b.resolved
  AND a.batch_id = b.batch_id
  AND (a.detected_at, a.id) > (b.detected_at, b.id);
CREATE UNIQUE INDEX uq_anomalies_open_chain_tampered
  ON anomalies (batch_id) WHERE type = 'CHAIN_TAMPERED' AND NOT resolved;

-- ── audit_logs ──────────────────────────────────────────────────────────────
CREATE INDEX idx_audit_logs_tenant_created ON audit_logs (tenant_id, created_at DESC);
CREATE INDEX idx_audit_logs_tenant_action  ON audit_logs (tenant_id, action, created_at DESC);
CREATE INDEX idx_audit_logs_actor          ON audit_logs (actor_id) WHERE actor_id IS NOT NULL;

-- ── refresh_tokens ──────────────────────────────────────────────────────────
-- For the periodic purge of expired/revoked sessions.
CREATE INDEX idx_refresh_tokens_expires ON refresh_tokens (expires_at);
