import { Router, Response, NextFunction } from 'express';
import { SupplyChainService } from '../../services/supplyChainService';
import { AuthService } from '../../services/authService';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';

export function batchRouter(supplyChainService: SupplyChainService, authService: AuthService): Router {
  const router = Router();
  const auth = authMiddleware(authService);

  router.post('/', auth, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const batch = await supplyChainService.createBatch(req.body, req.actor!.actorId);
      res.status(201).json(batch);
    } catch (err) {
      next(err);
    }
  });

  router.get('/', auth, async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      res.json(await supplyChainService.getAllBatches());
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', auth, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const batch = await supplyChainService.getBatch(req.params.id);
      if (!batch) { res.status(404).json({ error: 'Batch not found' }); return; }
      res.json(batch);
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/recall', auth, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { reason } = req.body;
      if (!reason) { res.status(400).json({ error: 'reason is required' }); return; }
      const batch = await supplyChainService.recallBatch(req.params.id, reason, req.actor!.actorId);
      res.json(batch);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
