import { v4 as uuidv4 } from 'uuid';
import { Database, isUniqueViolation } from '../db/database';
import { Actor } from '../domain/types';
import { ConflictError, ForbiddenError, NotFoundError } from '../errors';
import { IAuditLogRepo } from '../repository/interfaces';
import { GeoJsonGeometry, GeometryCheck, Plot, PostgresPlotRepo } from '../repository/postgres/plotRepo';
import { LineageService } from './lineageService';

/** EUDR: from this size up a plot must be recorded as a polygon, not a point. */
export const POLYGON_REQUIRED_FROM_HA = 4;

export interface CreatePlotDTO {
  code: string;
  name: string;
  geometry: GeoJsonGeometry;
  /** Required for a point (no boundary to measure); ignored for polygons, whose area is computed. */
  declaredAreaHa?: number;
  /** ADMIN may register a plot on behalf of a farmer; farmers always own what they register. */
  ownerActorId?: string;
}

export class PlotValidationError extends ConflictError {
  constructor(
    message: string,
    readonly check: GeometryCheck | { ok: false; problem: string },
  ) {
    super(message);
  }
}

const PROBLEM_MESSAGES: Record<string, string> = {
  INVALID_GEOJSON: 'Invalid GeoJSON geometry',
  UNSUPPORTED_TYPE: 'Only Point, Polygon and MultiPolygon are supported',
  INVALID_GEOMETRY: 'Plot boundary is not a valid polygon',
  OUTSIDE_VIETNAM: 'Plot lies outside Vietnam',
  OVERLAPS: 'Plot overlaps an existing plot',
  POLYGON_REQUIRED: 'Plots of 4 ha or more must be recorded with their boundary (polygon)',
  AREA_REQUIRED: 'A plot recorded as a single point needs its declared area',
};

/** GeoJSON FeatureCollection — the format EUDR due-diligence statements take. */
export interface PlotFeatureCollection {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: GeoJsonGeometry;
    properties: { plotCode: string; plotName: string; areaHa: number; producer: string; shape: 'polygon' | 'point' };
  }>;
}

/** Plots (fields) with geolocation — docs/SPEC_PHASE1.md §4. */
export class PlotService {
  constructor(
    private readonly db: Database,
    private readonly plotRepo: PostgresPlotRepo,
    private readonly auditLogRepo: IAuditLogRepo,
    private readonly lineage: LineageService,
    private readonly organizationOf: (actorId: string) => Promise<string>,
  ) {}

  async create(actor: Actor, dto: CreatePlotDTO): Promise<Plot> {
    if (actor.role !== 'FARMER' && actor.role !== 'ADMIN') throw new ForbiddenError('Only farmers and admins register plots');
    const owner = actor.role === 'ADMIN' && dto.ownerActorId ? dto.ownerActorId : actor.id;

    return this.db.withTenant(actor.tenantId, async () => {
      const check = await this.plotRepo.checkGeometry(dto.geometry);
      if (!check.ok) throw new PlotValidationError(PROBLEM_MESSAGES[check.problem!] ?? 'Invalid plot', check);

      let areaHa: number;
      if (check.shape === 'polygon') {
        areaHa = Math.round(check.areaHa! * 10_000) / 10_000;
      } else {
        if (!dto.declaredAreaHa) throw new PlotValidationError(PROBLEM_MESSAGES.AREA_REQUIRED, { ok: false, problem: 'AREA_REQUIRED' });
        areaHa = dto.declaredAreaHa;
        if (areaHa >= POLYGON_REQUIRED_FROM_HA) {
          throw new PlotValidationError(PROBLEM_MESSAGES.POLYGON_REQUIRED, { ok: false, problem: 'POLYGON_REQUIRED' });
        }
      }

      try {
        const plot = await this.plotRepo.create({
          id: uuidv4(),
          tenantId: actor.tenantId,
          code: dto.code,
          name: dto.name,
          ownerActorId: owner,
          geometry: dto.geometry,
          areaHa,
        });
        await this.auditLogRepo.create({
          id: uuidv4(),
          actorId: actor.id,
          tenantId: actor.tenantId,
          action: 'PLOT_REGISTERED',
          entityType: 'plot',
          entityId: plot.id,
          metadata: { code: plot.code, areaHa: plot.areaHa, shape: plot.shape },
          createdAt: new Date(),
        });
        return plot;
      } catch (err) {
        if (isUniqueViolation(err)) throw new ConflictError('Plot code already in use');
        if ((err as { code?: string }).code === '23503') throw new NotFoundError('Owner not found');
        throw err;
      }
    });
  }

  /** Registers each feature of a GeoJSON FeatureCollection; returns per-feature results (partial success allowed). */
  async importCollection(
    actor: Actor,
    features: Array<{ geometry: GeoJsonGeometry; properties?: Record<string, unknown> }>,
  ): Promise<Array<{ index: number; plot?: Plot; error?: string }>> {
    const results: Array<{ index: number; plot?: Plot; error?: string }> = [];
    for (const [index, f] of features.entries()) {
      const props = f.properties ?? {};
      const code = String(props.code ?? props.plotCode ?? props.ma ?? `L-${index + 1}`).slice(0, 60);
      const name = String(props.name ?? props.plotName ?? props.ten ?? code).slice(0, 200);
      const declared = Number(props.areaHa ?? props.area_ha ?? props.dienTich);
      try {
        const plot = await this.create(actor, {
          code,
          name,
          geometry: f.geometry,
          declaredAreaHa: Number.isFinite(declared) && declared > 0 ? declared : undefined,
        });
        results.push({ index, plot });
      } catch (err) {
        results.push({ index, error: (err as Error).message });
      }
    }
    return results;
  }

  async list(actor: Actor): Promise<Plot[]> {
    // Farmers see their own fields; other roles the whole tenant (they buy from these plots).
    return this.db.withTenant(actor.tenantId, () =>
      this.plotRepo.list(actor.tenantId, actor.role === 'FARMER' ? actor.id : undefined),
    );
  }

  /**
   * Every plot that fed into `lotId`, through any number of merges, splits
   * and transformations — the geolocation an EUDR due-diligence statement
   * for that lot needs.
   */
  async originFeatures(actor: Actor, lotId: string): Promise<PlotFeatureCollection> {
    return this.db.withTenant(actor.tenantId, async () => {
      const graph = await this.lineage.lineageInScope(lotId, actor.tenantId);
      const plotIds = [...new Set(graph.rootLotIds.map((id) => graph.lots[id]?.plotId).filter((x): x is string => !!x))];
      const plots = await this.plotRepo.findByIds(plotIds);
      const producers = new Map<string, string>();
      for (const owner of new Set(plots.map((p) => p.ownerActorId))) producers.set(owner, await this.organizationOf(owner));
      const features: PlotFeatureCollection['features'] = plots.map((p) => ({
        type: 'Feature',
        geometry: p.geometry,
        properties: { plotCode: p.code, plotName: p.name, areaHa: p.areaHa, producer: producers.get(p.ownerActorId) ?? '', shape: p.shape },
      }));
      return { type: 'FeatureCollection', features };
    });
  }
}
