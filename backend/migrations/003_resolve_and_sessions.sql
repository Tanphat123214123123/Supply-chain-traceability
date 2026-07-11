-- Anomaly resolution workflow + refresh-token session metadata

ALTER TABLE anomalies ADD COLUMN IF NOT EXISTS resolved BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE anomalies ADD COLUMN IF NOT EXISTS resolved_by UUID REFERENCES actors(id);
ALTER TABLE anomalies ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_anomalies_resolved ON anomalies (resolved, detected_at DESC);

ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
