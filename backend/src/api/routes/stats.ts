import { Router } from 'express';
import { AuthService } from '../../services/authService';
import { StatsService } from '../../services/statsService';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';
import { validateQuery } from '../middleware/validate';
import { reportQuerySchema } from '../../validation/schemas';
import { z } from 'zod';

export function statsRoutes(statsService: StatsService, authService: AuthService): Router {
  const router = Router();
  router.use(requireAuth(authService));

  router.get(
    '/overview',
    asyncHandler(async (req, res) => {
      res.json(await statsService.overview(req.actor!.tenantId));
    }),
  );

  router.get(
    '/by-stage',
    asyncHandler(async (req, res) => {
      res.json(await statsService.byStage(req.actor!.tenantId));
    }),
  );

  router.get(
    '/by-day',
    asyncHandler(async (req, res) => {
      res.json(await statsService.byDay(req.actor!.tenantId));
    }),
  );

  router.get(
    '/attention',
    asyncHandler(async (req, res) => {
      res.json(await statsService.attention(req.actor!.tenantId));
    }),
  );

  router.get(
    '/report',
    validateQuery(reportQuerySchema),
    asyncHandler(async (req, res) => {
      const q = req.query as unknown as z.infer<typeof reportQuerySchema>;
      res.json(await statsService.report(req.actor!.tenantId, q));
    }),
  );

  router.get(
    '/by-origin',
    asyncHandler(async (req, res) => {
      res.json(await statsService.byOrigin(req.actor!.tenantId));
    }),
  );

  return router;
}
