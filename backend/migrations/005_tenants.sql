-- Multi-tenancy: a Tenant is a SaaS customer boundary, completely isolated
-- from every other tenant. NOT the same thing as `organization` — multiple
-- organizations (farmer co-op, processor, distributor...) belong to the SAME
-- tenant and legitimately collaborate on the same batch as custody passes
-- between them.

CREATE TABLE IF NOT EXISTS tenants (
  id          UUID PRIMARY KEY,
  slug        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Backfill target for any pre-existing rows so the NOT NULL constraints below
-- don't break a database that already has data from before tenants existed.
INSERT INTO tenants (id, slug, name)
SELECT '00000000-0000-0000-0000-000000000001', 'demo-tenant', 'TraceChain Demo'
WHERE NOT EXISTS (SELECT 1 FROM tenants WHERE slug = 'demo-tenant');

ALTER TABLE actors ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
UPDATE actors SET tenant_id = (SELECT id FROM tenants WHERE slug = 'demo-tenant') WHERE tenant_id IS NULL;
ALTER TABLE actors ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE batches ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
UPDATE batches SET tenant_id = (SELECT id FROM tenants WHERE slug = 'demo-tenant') WHERE tenant_id IS NULL;
ALTER TABLE batches ALTER COLUMN tenant_id SET NOT NULL;

-- Denormalized from the batch at creation time so anomaly queries can filter
-- by tenant directly, without a join back to batches on every list/count.
ALTER TABLE anomalies ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
UPDATE anomalies a SET tenant_id = b.tenant_id FROM batches b WHERE a.batch_id = b.id AND a.tenant_id IS NULL;
ALTER TABLE anomalies ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
UPDATE audit_logs SET tenant_id = (SELECT id FROM tenants WHERE slug = 'demo-tenant') WHERE tenant_id IS NULL;
ALTER TABLE audit_logs ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_actors_tenant ON actors (tenant_id);
CREATE INDEX IF NOT EXISTS idx_batches_tenant ON batches (tenant_id);
CREATE INDEX IF NOT EXISTS idx_anomalies_tenant ON anomalies (tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON audit_logs (tenant_id);
