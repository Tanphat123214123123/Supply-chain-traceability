import { Router } from 'express';
import { RecordEventDTO } from '../../domain/types';
import { IActorRepo } from '../../repository/interfaces';
import { AuthService } from '../../services/authService';
import { SupplyChainService } from '../../services/supplyChainService';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';

export function eventRoutes(
  supplyChainService: SupplyChainService,
  authService: AuthService,
  actorRepo: IActorRepo,
): Router {
  const router = Router();
  router.use(requireAuth(authService, actorRepo));

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const dto = req.body as RecordEventDTO;
      const event = await supplyChainService.recordEvent(req.actor!, dto);
      res.status(201).json(event);
    }),
  );

  return router;
}
