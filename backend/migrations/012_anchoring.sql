-- 012: Anchoring event hashes on a public blockchain (docs/SPEC_PHASE1.md §2).
--
-- anchors        — one row per Merkle root sent to the TraceAnchor contract.
--                  Holds nothing but public data (root, tx hash, block), so it
--                  is not tenant-scoped.
-- anchor_leaves  — which anchor (and where in its tree) each event landed in,
--                  plus the inclusion proof. Tenant-scoped like the events.

CREATE TABLE anchors (
  id                UUID PRIMARY KEY,
  root              CHAR(64) NOT NULL UNIQUE CHECK (root ~ '^[0-9a-f]{64}$'),
  leaf_count        INTEGER NOT NULL CHECK (leaf_count > 0),
  status            TEXT NOT NULL CHECK (status IN ('built', 'submitted', 'confirmed')),
  chain_id          INTEGER NOT NULL,
  contract_address  TEXT NOT NULL CHECK (contract_address ~ '^0x[0-9a-fA-F]{40}$'),
  tx_hash           TEXT CHECK (tx_hash IS NULL OR tx_hash ~ '^0x[0-9a-f]{64}$'),
  block_number      BIGINT,
  anchored_at       TIMESTAMPTZ,
  attempts          INTEGER NOT NULL DEFAULT 0,
  last_error        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at      TIMESTAMPTZ,
  confirmed_at      TIMESTAMPTZ,
  CONSTRAINT anchors_confirmed_complete CHECK (
    status <> 'confirmed' OR (block_number IS NOT NULL AND anchored_at IS NOT NULL AND confirmed_at IS NOT NULL)
  )
);

-- Exactly one batch in flight at a time keeps nonce handling trivial.
CREATE UNIQUE INDEX uq_anchors_single_in_flight ON anchors ((true)) WHERE status <> 'confirmed';
CREATE INDEX idx_anchors_created ON anchors (created_at DESC);

CREATE TABLE anchor_leaves (
  event_id    UUID PRIMARY KEY,
  tenant_id   UUID NOT NULL,
  anchor_id   UUID NOT NULL REFERENCES anchors(id),
  leaf_index  INTEGER NOT NULL CHECK (leaf_index >= 0),
  proof       TEXT[] NOT NULL,
  UNIQUE (anchor_id, leaf_index),
  FOREIGN KEY (event_id, tenant_id) REFERENCES trace_events (id, tenant_id)
);

CREATE INDEX idx_anchor_leaves_anchor ON anchor_leaves (anchor_id);

CREATE TRIGGER anchor_leaves_append_only BEFORE UPDATE OR DELETE ON anchor_leaves
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

GRANT SELECT, INSERT ON anchors TO tracechain_app;
GRANT UPDATE (status, tx_hash, block_number, anchored_at, attempts, last_error, submitted_at, confirmed_at)
  ON anchors TO tracechain_app;
GRANT SELECT, INSERT ON anchor_leaves TO tracechain_app;

ALTER TABLE anchor_leaves ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON anchor_leaves
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
