import { Router } from 'express';
import { RecordEventDTO } from '../../domain/types';
import { AuthService } from '../../services/authService';
import { SupplyChainService } from '../../services/supplyChainService';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';
import { validateBody } from '../middleware/validate';
import { recordEventSchema } from '../../validation/schemas';

export function eventRoutes(
  supplyChainService: SupplyChainService,
  authService: AuthService,
): Router {
  const router = Router();
  router.use(requireAuth(authService));

  router.post(
    '/',
    validateBody(recordEventSchema),
    asyncHandler(async (req, res) => {
      const dto = req.body as RecordEventDTO;
      const event = await supplyChainService.recordEvent(req.actor!, dto);
      res.status(201).json(event);
    }),
  );

  return router;
}
