import { Router } from 'express';
import { z } from 'zod';
import { CreateTransformationDTO } from '../../domain/types';
import { AuthService } from '../../services/authService';
import { LineageService } from '../../services/lineageService';
import { PlotService } from '../../services/plotService';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';
import { validateBody } from '../middleware/validate';
import { createTransformationSchema } from '../../validation/schemas';

/** Merge / split / transform, and the lot graph — docs/SPEC_PHASE1.md §3. */
export function lineageRoutes(lineageService: LineageService, plotService: PlotService, authService: AuthService): Router {
  const router = Router();
  router.use(requireAuth(authService));

  router.post(
    '/',
    validateBody(createTransformationSchema),
    asyncHandler(async (req, res) => {
      const dto = req.body as z.infer<typeof createTransformationSchema> as CreateTransformationDTO;
      res.status(201).json(await lineageService.createTransformation(req.actor!, dto));
    }),
  );

  router.get(
    '/lineage/:lotId',
    asyncHandler(async (req, res) => {
      res.json(await lineageService.lineage(req.actor!, req.params.lotId));
    }),
  );

  // Every plot behind a lot, as GeoJSON (EUDR due-diligence geolocation).
  router.get(
    '/lineage/:lotId/plots.geojson',
    asyncHandler(async (req, res) => {
      const fc = await plotService.originFeatures(req.actor!, req.params.lotId);
      res.type('application/geo+json').attachment(`vung-trong-${req.params.lotId.slice(0, 8)}.geojson`).send(JSON.stringify(fc, null, 2));
    }),
  );

  return router;
}
