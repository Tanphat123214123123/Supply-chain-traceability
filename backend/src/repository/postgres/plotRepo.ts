import { Database, isUuid } from '../../db/database';

export interface Plot {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  ownerActorId: string;
  /** 'polygon' = boundary recorded; 'point' = single coordinate (< 4 ha only). */
  shape: 'polygon' | 'point';
  areaHa: number;
  /** GeoJSON geometry, 6 decimal places (EUDR precision). */
  geometry: GeoJsonGeometry;
  createdAt: Date;
}

export interface GeoJsonGeometry {
  type: string;
  coordinates: unknown;
}

/** Result of checking a candidate geometry against SPEC §4 — before anything is written. */
export interface GeometryCheck {
  ok: boolean;
  shape?: 'polygon' | 'point';
  /** Area computed on the WGS84 ellipsoid, for polygons. */
  areaHa?: number;
  problem?: 'INVALID_GEOJSON' | 'UNSUPPORTED_TYPE' | 'INVALID_GEOMETRY' | 'OUTSIDE_VIETNAM' | 'OVERLAPS';
  detail?: string;
}

interface PlotRow {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  owner_actor_id: string;
  is_polygon: boolean;
  area_ha: string;
  geometry: string;
  created_at: Date;
}

const COLUMNS = `p.id, p.tenant_id, p.code, p.name, p.owner_actor_id, (p.geom IS NOT NULL) AS is_polygon, p.area_ha,
  ST_AsGeoJSON(COALESCE(p.geom, p.point), 6) AS geometry, p.created_at`;

function toPlot(r: PlotRow): Plot {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    code: r.code,
    name: r.name,
    ownerActorId: r.owner_actor_id,
    shape: r.is_polygon ? 'polygon' : 'point',
    areaHa: Number(r.area_ha),
    geometry: JSON.parse(r.geometry),
    createdAt: r.created_at,
  };
}

/** Max shared area (m²) tolerated between two plots of the same tenant — survey noise along a shared boundary. */
export const OVERLAP_TOLERANCE_M2 = 100;

/** Coarse national envelope (SPEC §4); the DB CHECK uses the same box. */
const VN_ENVELOPE = 'ST_MakeEnvelope(102.1, 8.4, 109.5, 23.4, 4326)';

export class PostgresPlotRepo {
  constructor(private readonly db: Database) {}

  /** Validates a GeoJSON geometry in PostGIS itself — the same engine that enforces the CHECKs. */
  async checkGeometry(geometry: GeoJsonGeometry): Promise<GeometryCheck> {
    const type = geometry?.type;
    if (!['Point', 'Polygon', 'MultiPolygon'].includes(type)) return { ok: false, problem: 'UNSUPPORTED_TYPE', detail: type };
    let row: { valid: boolean; reason: string; inside: boolean; area_ha: string | null; overlap_code: string | null };
    try {
      const r = await this.db.query<typeof row>(
        `WITH g AS (SELECT ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)) AS geom)
         SELECT ST_IsValid(g.geom) AS valid,
                ST_IsValidReason(g.geom) AS reason,
                ST_Within(g.geom, ${VN_ENVELOPE}) AS inside,
                CASE WHEN GeometryType(g.geom) IN ('POLYGON', 'MULTIPOLYGON') THEN ST_Area(g.geom::geography) / 10000 END AS area_ha,
                (SELECT p.code FROM plots p
                  WHERE p.geom IS NOT NULL
                    AND GeometryType(g.geom) IN ('POLYGON', 'MULTIPOLYGON')
                    AND ST_IsValid(g.geom)
                    AND ST_Intersects(p.geom, g.geom)
                    AND ST_Area(ST_Intersection(p.geom, g.geom)::geography) > ${OVERLAP_TOLERANCE_M2}
                  LIMIT 1) AS overlap_code
           FROM g`,
        [JSON.stringify(geometry)],
      );
      row = r.rows[0];
    } catch (err) {
      return { ok: false, problem: 'INVALID_GEOJSON', detail: (err as Error).message.split('\n')[0] };
    }
    const shape = type === 'Point' ? 'point' : 'polygon';
    if (!row.valid) return { ok: false, shape, problem: 'INVALID_GEOMETRY', detail: row.reason };
    if (!row.inside) return { ok: false, shape, problem: 'OUTSIDE_VIETNAM' };
    if (row.overlap_code) return { ok: false, shape, problem: 'OVERLAPS', detail: row.overlap_code };
    return { ok: true, shape, areaHa: row.area_ha === null ? undefined : Number(row.area_ha) };
  }

  async create(p: { id: string; tenantId: string; code: string; name: string; ownerActorId: string; geometry: GeoJsonGeometry; areaHa: number }): Promise<Plot> {
    const geomExpr = 'ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON($6), 4326))';
    const result = await this.db.query<PlotRow>(
      `INSERT INTO plots AS p (id, tenant_id, code, name, owner_actor_id, geom, point, area_ha)
       VALUES ($1, $2, $3, $4, $5,
               CASE WHEN $7 THEN ST_Multi(${geomExpr}) END,
               CASE WHEN $7 THEN NULL ELSE ${geomExpr} END,
               $8)
       RETURNING ${COLUMNS}`,
      [p.id, p.tenantId, p.code, p.name, p.ownerActorId, JSON.stringify(p.geometry), p.geometry.type !== 'Point', p.areaHa],
    );
    return toPlot(result.rows[0]);
  }

  async findById(id: string): Promise<Plot | null> {
    if (!isUuid(id)) return null;
    const r = await this.db.query<PlotRow>(`SELECT ${COLUMNS} FROM plots p WHERE p.id = $1`, [id]);
    return r.rows[0] ? toPlot(r.rows[0]) : null;
  }

  async findByIds(ids: string[]): Promise<Plot[]> {
    const valid = ids.filter(isUuid);
    if (valid.length === 0) return [];
    const r = await this.db.query<PlotRow>(`SELECT ${COLUMNS} FROM plots p WHERE p.id = ANY ($1::uuid[]) ORDER BY p.code`, [valid]);
    return r.rows.map(toPlot);
  }

  async list(tenantId: string, ownerActorId?: string): Promise<Plot[]> {
    const r = await this.db.query<PlotRow>(
      `SELECT ${COLUMNS} FROM plots p WHERE p.tenant_id = $1 AND ($2::uuid IS NULL OR p.owner_actor_id = $2) ORDER BY p.code`,
      [tenantId, ownerActorId ?? null],
    );
    return r.rows.map(toPlot);
  }
}
