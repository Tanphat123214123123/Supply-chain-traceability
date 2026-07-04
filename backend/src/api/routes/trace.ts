import { Router } from 'express';
import { IActorRepo } from '../../repository/interfaces';
import { AuthService } from '../../services/authService';
import { TraceDirection, TraceService } from '../../services/traceService';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';

export function traceRoutes(traceService: TraceService, authService: AuthService, actorRepo: IActorRepo): Router {
  const router = Router();

  // Public — no auth required, powers the QR-scan provenance page.
  router.get(
    '/public/:batchId',
    asyncHandler(async (req, res) => {
      res.json(await traceService.publicTrace(req.params.batchId));
    }),
  );

  router.use(requireAuth(authService, actorRepo));

  router.get(
    '/:batchId',
    asyncHandler(async (req, res) => {
      const direction = (req.query.direction as TraceDirection) ?? 'forward';
      res.json(await traceService.trace(req.params.batchId, direction));
    }),
  );

  return router;
}
