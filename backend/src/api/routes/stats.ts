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
    asyncHandler(async (_req, res) => {
      res.json(await statsService.overview());
    }),
  );

  router.get(
    '/by-stage',
    asyncHandler(async (_req, res) => {
      res.json(await statsService.byStage());
    }),
  );

  return router;
}
