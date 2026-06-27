import { Router, Request, Response, NextFunction } from 'express';
import { SupplyChainService } from '../../services/supplyChainService';
import { AuthService } from '../../services/authService';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';

export function traceRouter(supplyChainService: SupplyChainService, authService: AuthService): Router {
  const router = Router();
  const auth = authMiddleware(authService);

  // Public endpoint — consumers can scan QR code without a token
  router.get('/public/:batchId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await supplyChainService.traceForward(req.params.batchId);
      res.json({
        batch: {
          id: result.batch.id,
          productName: result.batch.productName,
          productType: result.batch.productType,
          origin: result.batch.origin,
          currentStage: result.batch.currentStage,
          isRecalled: result.batch.isRecalled,
          recallReason: result.batch.recallReason,
        },
        stageCount: result.events.length,
        isValid: result.isValid,
        hasAnomalies: result.anomalies.length > 0,
      });
    } catch (err) {
      next(err);
    }
  });

  // Authenticated full trace — supports ?direction=backward
  router.get('/:batchId', auth, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const backward = req.query.direction === 'backward';
      const result = backward
        ? await supplyChainService.traceBackward(req.params.batchId)
        : await supplyChainService.traceForward(req.params.batchId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
