import { Router } from 'express';
import { IActorRepo } from '../../repository/interfaces';
import { AuthService } from '../../services/authService';
import { StatsService } from '../../services/statsService';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';

export function statsRoutes(statsService: StatsService, authService: AuthService, actorRepo: IActorRepo): Router {
  const router = Router();
  router.use(requireAuth(authService, actorRepo));

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
    '/by-origin',
    asyncHandler(async (req, res) => {
      res.json(await statsService.byOrigin(req.actor!.tenantId));
    }),
  );

  return router;
}
