import { Router } from 'express';
import { z } from 'zod';
import { AuthService } from '../../services/authService';
import { CreatePlotDTO, PlotService, PlotValidationError } from '../../services/plotService';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';
import { validateBody } from '../middleware/validate';
import { createPlotSchema, importPlotsSchema } from '../../validation/schemas';

/** Plots (fields) with geolocation — docs/SPEC_PHASE1.md §4. */
export function plotRoutes(plotService: PlotService, authService: AuthService): Router {
  const router = Router();
  router.use(requireAuth(authService));

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      res.json(await plotService.list(req.actor!));
    }),
  );

  router.post(
    '/',
    validateBody(createPlotSchema),
    asyncHandler(async (req, res) => {
      try {
        res.status(201).json(await plotService.create(req.actor!, req.body as CreatePlotDTO));
      } catch (err) {
        // 422 with the machine-readable reason, so the form can say exactly what's wrong.
        if (err instanceof PlotValidationError) {
          res.status(422).json({ error: err.message, check: err.check });
          return;
        }
        throw err;
      }
    }),
  );

  router.post(
    '/import',
    validateBody(importPlotsSchema),
    asyncHandler(async (req, res) => {
      const { features } = req.body as z.infer<typeof importPlotsSchema>;
      const results = await plotService.importCollection(
        req.actor!,
        features.map((f) => ({ geometry: f.geometry, properties: f.properties ?? undefined })),
      );
      res.status(results.some((r) => r.plot) ? 201 : 422).json({ results });
    }),
  );

  return router;
}
