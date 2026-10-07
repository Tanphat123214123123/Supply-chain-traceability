-- 007: The ledger is append-only and its chain linkage is enforced on insert.
--
-- 1. Hash v2 (public, salted) alongside the legacy v1 (HMAC) rows already stored.
-- 2. Each batch records the head of its chain (head_hash, event_count). Deleting
--    the tail of a chain no longer goes unnoticed: the remaining events stop
--    matching the recorded head. Those two columns are maintained only by the
--    trigger below — the application role has no privilege to write them.
-- 3. trace_events and audit_logs reject UPDATE, DELETE and TRUNCATE outright.
--
-- See docs/DATABASE.md ("Sổ cái") for the exact hash specification.

-- ── Hash versioning ─────────────────────────────────────────────────────────
-- v1 = HMAC-SHA256 with a server-held key (verifiable only by the server).
-- v2 = SHA-256 over RFC 8785 canonical JSON including a per-event random salt
--      (recomputable by anyone holding the event — the basis for anchoring).
ALTER TABLE trace_events ADD COLUMN hash_version SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE trace_events ALTER COLUMN hash_version DROP DEFAULT;
ALTER TABLE trace_events ADD COLUMN salt CHAR(64);
ALTER TABLE trace_events ADD CONSTRAINT trace_events_hash_version_salt CHECK (
  (hash_version = 1 AND salt IS NULL)
  OR (hash_version = 2 AND salt ~ '^[0-9a-f]{64}$')
);

-- ── Chain head per batch ────────────────────────────────────────────────────
ALTER TABLE batches ADD COLUMN head_hash CHAR(64) NOT NULL DEFAULT repeat('0', 64);
ALTER TABLE batches ADD COLUMN event_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE batches ADD CONSTRAINT batches_event_count_nonnegative CHECK (event_count >= 0);
ALTER TABLE batches ADD CONSTRAINT batches_head_hash_hex CHECK (head_hash ~ '^[0-9a-f]{64}$');

UPDATE batches b
SET head_hash = last.hash, event_count = last.sequence_number + 1
FROM (
  SELECT DISTINCT ON (batch_id) batch_id, hash, sequence_number
  FROM trace_events
  ORDER BY batch_id, sequence_number DESC
) last
WHERE last.batch_id = b.id;

-- ── Insert-time chain validation ────────────────────────────────────────────
-- SECURITY DEFINER: runs as the schema owner so it can advance head_hash /
-- event_count, which the application role is deliberately not granted.
CREATE FUNCTION ledger_append_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  b RECORD;
BEGIN
  SELECT tenant_id, head_hash, event_count, is_recalled
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

CREATE TRIGGER trace_events_ledger_append BEFORE INSERT ON trace_events
  FOR EACH ROW EXECUTE FUNCTION ledger_append_event();

-- ── Append-only tables ──────────────────────────────────────────────────────
CREATE FUNCTION forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER trace_events_append_only BEFORE UPDATE OR DELETE ON trace_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER trace_events_no_truncate BEFORE TRUNCATE ON trace_events
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- ── Batch state transitions that must never go backwards ────────────────────
CREATE FUNCTION batches_guard_update() RETURNS trigger
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

CREATE TRIGGER batches_guard_update BEFORE UPDATE ON batches
  FOR EACH ROW EXECUTE FUNCTION batches_guard_update();
