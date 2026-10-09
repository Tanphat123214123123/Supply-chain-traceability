-- 014: Reference data for mass balance (docs/SPEC_PHASE1.md §5).
-- Platform-wide (not tenant data); read-only to the application.

CREATE TABLE conversion_factors (
  from_type  TEXT NOT NULL,
  to_type    TEXT NOT NULL,
  min_ratio  NUMERIC NOT NULL CHECK (min_ratio > 0),
  max_ratio  NUMERIC NOT NULL CHECK (max_ratio >= min_ratio),
  PRIMARY KEY (from_type, to_type)
);

CREATE TABLE yield_caps (
  product_type     TEXT PRIMARY KEY,
  max_kg_per_ha    NUMERIC NOT NULL CHECK (max_kg_per_ha > 0)
);

INSERT INTO conversion_factors (from_type, to_type, min_ratio, max_ratio) VALUES
  ('Cà phê quả tươi', 'Cà phê nhân xanh', 0.16, 0.22),
  ('Cà phê quả tươi', 'Cà phê nhân xô',   0.40, 0.50),
  ('Cà phê nhân xô',  'Cà phê nhân xanh', 0.78, 0.85),
  ('Cà phê nhân xanh','Cà phê rang',      0.80, 0.88),
  ('Mủ cao su nước',  'Cao su khối',      0.28, 0.40);

INSERT INTO yield_caps (product_type, max_kg_per_ha) VALUES
  ('Cà phê quả tươi',  30000),
  ('Cà phê nhân xanh',  6000),
  ('Mủ cao su nước',    6000);

GRANT SELECT ON conversion_factors, yield_caps TO tracechain_app;
