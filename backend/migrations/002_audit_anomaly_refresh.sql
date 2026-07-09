-- Audit log, persisted anomalies, and refresh tokens

CREATE TABLE IF NOT EXISTS anomalies (
  id           UUID PRIMARY KEY,
  batch_id     UUID NOT NULL REFERENCES batches(id),
  event_id     UUID REFERENCES trace_events(id),
  type         TEXT NOT NULL CHECK (type IN ('STAGE_SKIPPED', 'DUPLICATE_STAGE', 'OUT_OF_ORDER', 'CHAIN_TAMPERED')),
  severity     TEXT NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  message      TEXT NOT NULL,
  detected_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_anomalies_batch_id ON anomalies (batch_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id           UUID PRIMARY KEY,
  actor_id     UUID REFERENCES actors(id),
  action       TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT,
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  token        TEXT PRIMARY KEY,
  actor_id     UUID NOT NULL REFERENCES actors(id),
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked      BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_actor_id ON refresh_tokens (actor_id);
