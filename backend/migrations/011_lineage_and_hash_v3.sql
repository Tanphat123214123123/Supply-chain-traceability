-- 011: Lot lineage (merge / split / transform) and hash v3 (selective disclosure).
-- Specification: docs/SPEC_PHASE1.md §1 and §3.

-- ── Events: kind, links, per-claim salts ────────────────────────────────────
ALTER TABLE trace_events ADD COLUMN kind TEXT NOT NULL DEFAULT 'OBSERVE';
ALTER TABLE trace_events ADD COLUMN links JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE trace_events ADD COLUMN claim_salts JSONB;

ALTER TABLE trace_events
  ADD CONSTRAINT trace_events_kind_check CHECK (kind IN ('OBSERVE', 'MERGE', 'SPLIT', 'TRANSFORM')),
  ADD CONSTRAINT trace_events_links_is_array CHECK (jsonb_typeof(links) = 'array'),
  -- Only the first event of a lot born from a transformation carries links.
  ADD CONSTRAINT trace_events_links_consistent CHECK (
    (kind = 'OBSERVE' AND links = '[]'::jsonb)
    OR (kind <> 'OBSERVE' AND sequence_number = 0 AND jsonb_array_length(links) > 0)
  );

ALTER TABLE trace_events DROP CONSTRAINT trace_events_hash_version_salt;
ALTER TABLE trace_events ADD CONSTRAINT trace_events_hash_version_salt CHECK (
  (hash_version = 1 AND salt IS NULL AND claim_salts IS NULL)
  OR (hash_version = 2 AND salt ~ '^[0-9a-f]{64}$' AND claim_salts IS NULL)
  OR (hash_version = 3 AND salt IS NULL AND jsonb_typeof(claim_salts) = 'object')
);
-- v2 never had kind/links; they would change its preimage.
ALTER TABLE trace_events ADD CONSTRAINT trace_events_lineage_needs_v3 CHECK (hash_version = 3 OR kind = 'OBSERVE');

-- ── Lots: consumption ───────────────────────────────────────────────────────
ALTER TABLE batches ADD COLUMN consumed_quantity NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE batches ADD CONSTRAINT batches_consumed_within_quantity
  CHECK (consumed_quantity >= 0 AND consumed_quantity <= quantity);

-- ── Transformations (EPCIS transformation / aggregation events) ─────────────
CREATE TABLE transformations (
  id          UUID PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  kind        TEXT NOT NULL CHECK (kind IN ('MERGE', 'SPLIT', 'TRANSFORM')),
  stage       TEXT NOT NULL CHECK (stage IN ('HARVEST', 'PROCESSING', 'QUALITY_CHECK', 'PACKAGING', 'DISTRIBUTION', 'RETAIL')),
  actor_id    UUID NOT NULL,
  location    TEXT NOT NULL,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id),
  FOREIGN KEY (actor_id, tenant_id) REFERENCES actors (id, tenant_id)
);

CREATE TABLE transformation_inputs (
  transformation_id  UUID NOT NULL,
  tenant_id          UUID NOT NULL,
  lot_id             UUID NOT NULL,
  quantity           NUMERIC NOT NULL CHECK (quantity > 0),
  unit               TEXT NOT NULL,
  head_hash          CHAR(64) NOT NULL CHECK (head_hash ~ '^[0-9a-f]{64}$'),
  event_count        INTEGER NOT NULL CHECK (event_count >= 0),
  PRIMARY KEY (transformation_id, lot_id),
  FOREIGN KEY (transformation_id, tenant_id) REFERENCES transformations (id, tenant_id),
  FOREIGN KEY (lot_id, tenant_id) REFERENCES batches (id, tenant_id)
);

CREATE TABLE transformation_outputs (
  transformation_id  UUID NOT NULL,
  tenant_id          UUID NOT NULL,
  lot_id             UUID NOT NULL UNIQUE,   -- a lot is born from at most one transformation
  PRIMARY KEY (transformation_id, lot_id),
  FOREIGN KEY (transformation_id, tenant_id) REFERENCES transformations (id, tenant_id),
  FOREIGN KEY (lot_id, tenant_id) REFERENCES batches (id, tenant_id)
);

-- Lineage walks go both ways.
CREATE INDEX idx_transformation_inputs_lot ON transformation_inputs (lot_id);
CREATE INDEX idx_transformations_tenant_created ON transformations (tenant_id, created_at DESC);

-- Transformations are part of the record: append-only like the ledger.
CREATE TRIGGER transformations_append_only BEFORE UPDATE OR DELETE ON transformations
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER transformation_inputs_append_only BEFORE UPDATE OR DELETE ON transformation_inputs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER transformation_outputs_append_only BEFORE UPDATE OR DELETE ON transformation_outputs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ── Ledger trigger: a fully consumed lot takes no further events ────────────
CREATE OR REPLACE FUNCTION ledger_append_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  b RECORD;
BEGIN
  SELECT tenant_id, head_hash, event_count, is_recalled, quantity, consumed_quantity
    INTO b
    FROM batches
   WHERE id = NEW.batch_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ledger: batch % does not exist', NEW.batch_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF b.tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION 'ledger: event tenant does not match batch tenant' USING ERRCODE = 'check_violation';
  END IF;
  IF b.is_recalled THEN
    RAISE EXCEPTION 'ledger: batch % is recalled, no further events allowed', NEW.batch_id USING ERRCODE = 'check_violation';
  END IF;
  IF b.consumed_quantity >= b.quantity THEN
    RAISE EXCEPTION 'ledger: batch % has been fully consumed, no further events allowed', NEW.batch_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.sequence_number <> b.event_count THEN
    RAISE EXCEPTION 'ledger: expected sequence_number %, got %', b.event_count, NEW.sequence_number
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.prev_hash <> b.head_hash THEN
    RAISE EXCEPTION 'ledger: prev_hash does not match the current head of batch %', NEW.batch_id
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE batches
     SET head_hash = NEW.hash,
         event_count = event_count + 1
   WHERE id = NEW.batch_id;

  RETURN NEW;
END;
$$;

-- Consumption only ever grows.
CREATE OR REPLACE FUNCTION batches_guard_update() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  stages CONSTANT TEXT[] := ARRAY['HARVEST', 'PROCESSING', 'QUALITY_CHECK', 'PACKAGING', 'DISTRIBUTION', 'RETAIL'];
BEGIN
  IF OLD.is_recalled AND NOT NEW.is_recalled THEN
    RAISE EXCEPTION 'batch %: a recall cannot be undone', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.event_count < OLD.event_count THEN
    RAISE EXCEPTION 'batch %: ledger head cannot move backwards', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.consumed_quantity < OLD.consumed_quantity THEN
    RAISE EXCEPTION 'batch %: consumed quantity cannot decrease', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.current_stage IS NOT NULL AND (
       NEW.current_stage IS NULL
       OR array_position(stages, NEW.current_stage) < array_position(stages, OLD.current_stage)
     ) THEN
    RAISE EXCEPTION 'batch %: current_stage cannot regress from % to %', OLD.id, OLD.current_stage, NEW.current_stage
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- ── Anomalies: mass balance ─────────────────────────────────────────────────
ALTER TABLE anomalies DROP CONSTRAINT anomalies_type_check;
ALTER TABLE anomalies ADD CONSTRAINT anomalies_type_check CHECK (
  type IN ('STAGE_SKIPPED', 'DUPLICATE_STAGE', 'OUT_OF_ORDER', 'CHAIN_TAMPERED', 'MASS_BALANCE_VIOLATION')
);

-- ── Privileges + row-level security ─────────────────────────────────────────
GRANT UPDATE (consumed_quantity) ON batches TO tracechain_app;
GRANT SELECT, INSERT ON transformations, transformation_inputs, transformation_outputs TO tracechain_app;

ALTER TABLE transformations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE transformation_inputs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE transformation_outputs ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON transformations
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON transformation_inputs
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
CREATE POLICY tenant_isolation ON transformation_outputs
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
