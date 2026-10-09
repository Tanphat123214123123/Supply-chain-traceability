-- 013: Plots (fields) with geolocation — PostGIS (docs/SPEC_PHASE1.md §4).
-- Requires the postgis/postgis image; migrations run as the schema owner.

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE plots (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  code            TEXT NOT NULL CHECK (length(code) BETWEEN 1 AND 60),
  name            TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  owner_actor_id  UUID NOT NULL,
  -- Exactly one of the two: a boundary (required ≥ 4 ha) or a single point (< 4 ha).
  geom            geometry(MultiPolygon, 4326),
  point           geometry(Point, 4326),
  area_ha         NUMERIC NOT NULL CHECK (area_ha > 0 AND area_ha < 100000),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, tenant_id),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (owner_actor_id, tenant_id) REFERENCES actors (id, tenant_id),
  CONSTRAINT plots_one_geometry CHECK ((geom IS NULL) <> (point IS NULL)),
  -- EUDR: a plot of 4 ha or more must be described by its boundary.
  CONSTRAINT plots_large_needs_polygon CHECK (geom IS NOT NULL OR area_ha < 4),
  CONSTRAINT plots_geom_valid CHECK (geom IS NULL OR ST_IsValid(geom)),
  -- Coarse national envelope (102.1–109.5°E, 8.4–23.4°N).
  CONSTRAINT plots_within_vietnam CHECK (
    ST_Within(COALESCE(geom, point), ST_MakeEnvelope(102.1, 8.4, 109.5, 23.4, 4326))
  )
);

CREATE INDEX idx_plots_geom  ON plots USING gist (geom);
CREATE INDEX idx_plots_point ON plots USING gist (point);
CREATE INDEX idx_plots_owner ON plots (owner_actor_id);

ALTER TABLE batches ADD COLUMN plot_id UUID;
ALTER TABLE batches ADD CONSTRAINT batches_plot_id_fkey FOREIGN KEY (plot_id, tenant_id) REFERENCES plots (id, tenant_id);
CREATE INDEX idx_batches_plot ON batches (plot_id) WHERE plot_id IS NOT NULL;

GRANT SELECT, INSERT ON plots TO tracechain_app;
ALTER TABLE plots ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON plots
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
