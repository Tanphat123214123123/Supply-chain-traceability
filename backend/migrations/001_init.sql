-- TraceChain schema — run once against a fresh PostgreSQL database.
-- When switching from InMemory repos, wire PostgresBatchRepo / PostgresActorRepo / PostgresEventRepo
-- (backend/src/repository/postgres/) against a pg.Pool connected to this schema.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TYPE actor_role AS ENUM (
  'FARMER', 'PROCESSOR', 'INSPECTOR', 'DISTRIBUTOR', 'RETAILER', 'ADMIN'
);

CREATE TYPE supply_chain_stage AS ENUM (
  'HARVEST', 'PROCESSING', 'QUALITY_CHECK', 'PACKAGING', 'DISTRIBUTION', 'RETAIL'
);

CREATE TABLE actors (
  id            UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          VARCHAR(255)  NOT NULL,
  email         VARCHAR(255)  UNIQUE NOT NULL,
  password_hash VARCHAR(255)  NOT NULL,
  role          actor_role    NOT NULL,
  organization  VARCHAR(255)  NOT NULL,
  is_active     BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE batches (
  id             UUID                 PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_name   VARCHAR(255)         NOT NULL,
  product_type   VARCHAR(255)         NOT NULL,
  origin         VARCHAR(500)         NOT NULL,
  quantity       DECIMAL(12, 3)       NOT NULL,
  unit           VARCHAR(50)          NOT NULL,
  created_by     UUID                 NOT NULL REFERENCES actors(id),
  current_stage  supply_chain_stage,
  is_recalled    BOOLEAN              NOT NULL DEFAULT FALSE,
  recall_reason  TEXT,
  metadata       JSONB                NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ          NOT NULL DEFAULT NOW()
);

CREATE TABLE trace_events (
  id              UUID                 PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_id        UUID                 NOT NULL REFERENCES batches(id),
  stage           supply_chain_stage   NOT NULL,
  actor_id        UUID                 NOT NULL REFERENCES actors(id),
  location        VARCHAR(500)         NOT NULL,
  notes           TEXT,
  data            JSONB                NOT NULL DEFAULT '{}',
  hash            CHAR(64)             NOT NULL UNIQUE,
  prev_hash       CHAR(64)             NOT NULL,
  sequence_number INTEGER              NOT NULL,
  timestamp       TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
  UNIQUE (batch_id, sequence_number)
);

CREATE INDEX idx_trace_events_batch_id ON trace_events (batch_id);
CREATE INDEX idx_trace_events_stage    ON trace_events (stage);
CREATE INDEX idx_batches_created_by    ON batches (created_by);
