-- 006: Tenant consistency and data shape enforced by the database itself.
--
-- Until now, "a batch's creator belongs to the batch's tenant" (and every
-- similar rule) lived only in application code. Composite foreign keys on
-- (id, tenant_id) make a cross-tenant reference impossible to write at all,
-- whatever bug or SQL injection the application might have.

-- ── tenant_id on the two tables that didn't carry one ────────────────────────
ALTER TABLE trace_events ADD COLUMN tenant_id UUID;
UPDATE trace_events e SET tenant_id = b.tenant_id FROM batches b WHERE e.batch_id = b.id;
ALTER TABLE trace_events ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE refresh_tokens ADD COLUMN tenant_id UUID;
UPDATE refresh_tokens t SET tenant_id = a.tenant_id FROM actors a WHERE t.actor_id = a.id;
ALTER TABLE refresh_tokens ALTER COLUMN tenant_id SET NOT NULL;

-- ── (id, tenant_id) candidate keys for composite references ─────────────────
ALTER TABLE actors       ADD CONSTRAINT actors_id_tenant_key       UNIQUE (id, tenant_id);
ALTER TABLE batches      ADD CONSTRAINT batches_id_tenant_key      UNIQUE (id, tenant_id);
ALTER TABLE trace_events ADD CONSTRAINT trace_events_id_tenant_key UNIQUE (id, tenant_id);

-- ── Replace single-column FKs with tenant-aware composite ones ──────────────
-- MATCH SIMPLE (the default) means a NULL in the referencing column (an
-- unassigned batch, a system audit entry with no actor) is simply not checked.
ALTER TABLE batches
  DROP CONSTRAINT IF EXISTS batches_created_by_fkey,
  ADD CONSTRAINT batches_created_by_fkey
    FOREIGN KEY (created_by, tenant_id) REFERENCES actors (id, tenant_id),
  DROP CONSTRAINT IF EXISTS batches_assigned_to_actor_id_fkey,
  ADD CONSTRAINT batches_assigned_to_actor_id_fkey
    FOREIGN KEY (assigned_to_actor_id, tenant_id) REFERENCES actors (id, tenant_id);

ALTER TABLE trace_events
  ADD CONSTRAINT trace_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  DROP CONSTRAINT IF EXISTS trace_events_batch_id_fkey,
  ADD CONSTRAINT trace_events_batch_id_fkey
    FOREIGN KEY (batch_id, tenant_id) REFERENCES batches (id, tenant_id),
  DROP CONSTRAINT IF EXISTS trace_events_actor_id_fkey,
  ADD CONSTRAINT trace_events_actor_id_fkey
    FOREIGN KEY (actor_id, tenant_id) REFERENCES actors (id, tenant_id);

ALTER TABLE anomalies
  DROP CONSTRAINT IF EXISTS anomalies_batch_id_fkey,
  ADD CONSTRAINT anomalies_batch_id_fkey
    FOREIGN KEY (batch_id, tenant_id) REFERENCES batches (id, tenant_id),
  DROP CONSTRAINT IF EXISTS anomalies_event_id_fkey,
  ADD CONSTRAINT anomalies_event_id_fkey
    FOREIGN KEY (event_id, tenant_id) REFERENCES trace_events (id, tenant_id),
  DROP CONSTRAINT IF EXISTS anomalies_resolved_by_fkey,
  ADD CONSTRAINT anomalies_resolved_by_fkey
    FOREIGN KEY (resolved_by, tenant_id) REFERENCES actors (id, tenant_id);

ALTER TABLE audit_logs
  DROP CONSTRAINT IF EXISTS audit_logs_actor_id_fkey,
  ADD CONSTRAINT audit_logs_actor_id_fkey
    FOREIGN KEY (actor_id, tenant_id) REFERENCES actors (id, tenant_id);

ALTER TABLE refresh_tokens
  ADD CONSTRAINT refresh_tokens_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  DROP CONSTRAINT IF EXISTS refresh_tokens_actor_id_fkey,
  ADD CONSTRAINT refresh_tokens_actor_id_fkey
    FOREIGN KEY (actor_id, tenant_id) REFERENCES actors (id, tenant_id);

-- ── Domain checks the API already validates, now guaranteed at rest ─────────
ALTER TABLE tenants
  ADD CONSTRAINT tenants_slug_format CHECK (slug ~ '^[a-z0-9-]{2,60}$');

ALTER TABLE batches
  ADD CONSTRAINT batches_quantity_positive CHECK (quantity > 0),
  ADD CONSTRAINT batches_current_stage_check CHECK (
    current_stage IS NULL
    OR current_stage IN ('HARVEST', 'PROCESSING', 'QUALITY_CHECK', 'PACKAGING', 'DISTRIBUTION', 'RETAIL')
  ),
  ADD CONSTRAINT batches_recall_reason_required CHECK (NOT is_recalled OR recall_reason IS NOT NULL),
  ADD CONSTRAINT batches_metadata_is_object CHECK (jsonb_typeof(metadata) = 'object');

ALTER TABLE trace_events
  ADD CONSTRAINT trace_events_sequence_nonnegative CHECK (sequence_number >= 0),
  ADD CONSTRAINT trace_events_hash_hex CHECK (hash ~ '^[0-9a-f]{64}$' AND prev_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT trace_events_data_is_object CHECK (jsonb_typeof(data) = 'object');

ALTER TABLE anomalies
  ADD CONSTRAINT anomalies_resolution_consistent CHECK (
    (resolved AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL)
    OR (NOT resolved AND resolved_by IS NULL AND resolved_at IS NULL)
  );

ALTER TABLE audit_logs
  ADD CONSTRAINT audit_logs_metadata_is_object CHECK (jsonb_typeof(metadata) = 'object');

-- ── updated_at on the two mutable entities ──────────────────────────────────
ALTER TABLE actors  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE batches ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER actors_set_updated_at BEFORE UPDATE ON actors
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER batches_set_updated_at BEFORE UPDATE ON batches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
