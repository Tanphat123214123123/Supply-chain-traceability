-- TraceChain initial schema

CREATE TABLE IF NOT EXISTS actors (
  id             UUID PRIMARY KEY,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('FARMER', 'PROCESSOR', 'INSPECTOR', 'DISTRIBUTOR', 'RETAILER', 'ADMIN')),
  organization   TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active      BOOLEAN NOT NULL DEFAULT true
);

-- Case-insensitive uniqueness: the app looks up/creates accounts by lower(email),
-- so the DB constraint must match or two differently-cased emails could collide.
CREATE UNIQUE INDEX IF NOT EXISTS idx_actors_email_lower ON actors (lower(email));

CREATE TABLE IF NOT EXISTS batches (
  id             UUID PRIMARY KEY,
  product_name   TEXT NOT NULL,
  product_type   TEXT NOT NULL,
  origin         TEXT NOT NULL,
  quantity       NUMERIC NOT NULL,
  unit           TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     UUID NOT NULL REFERENCES actors(id),
  current_stage  TEXT,
  is_recalled    BOOLEAN NOT NULL DEFAULT false,
  recall_reason  TEXT,
  metadata       JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS trace_events (
  id               UUID PRIMARY KEY,
  batch_id         UUID NOT NULL REFERENCES batches(id),
  stage            TEXT NOT NULL CHECK (stage IN ('HARVEST', 'PROCESSING', 'QUALITY_CHECK', 'PACKAGING', 'DISTRIBUTION', 'RETAIL')),
  actor_id         UUID NOT NULL REFERENCES actors(id),
  timestamp        TIMESTAMPTZ NOT NULL DEFAULT now(),
  location         TEXT NOT NULL,
  notes            TEXT,
  data             JSONB NOT NULL DEFAULT '{}'::jsonb,
  hash             CHAR(64) NOT NULL,
  prev_hash        CHAR(64) NOT NULL,
  sequence_number  INTEGER NOT NULL,
  UNIQUE (batch_id, sequence_number)
);

CREATE INDEX IF NOT EXISTS idx_batches_created_at ON batches (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trace_events_batch_id ON trace_events (batch_id, sequence_number);
