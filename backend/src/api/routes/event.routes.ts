import { Router, Response, NextFunction } from 'express';
import { SupplyChainService } from '../../services/supplyChainService';
import { AuthService } from '../../services/authService';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { SupplyChainStage } from '../../domain/types';

export function eventRouter(supplyChainService: SupplyChainService, authService: AuthService): Router {
  const router = Router();
  const auth = authMiddleware(authService);

  router.post('/', auth, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { batchId, stage, location, notes, data } = req.body;
      if (!batchId || !stage || !location) {
        res.status(400).json({ error: 'batchId, stage, and location are required' });
        return;
      }
      if (!Object.values(SupplyChainStage).includes(stage)) {
        res.status(400).json({ error: `Invalid stage. Valid values: ${Object.values(SupplyChainStage).join(', ')}` });
        return;
      }
      const event = await supplyChainService.recordEvent(
        { batchId, stage, location, notes, data },
        req.actor!.actorId,
      );
      res.status(201).json(event);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
