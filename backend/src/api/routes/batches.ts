import { Router } from 'express';
import QRCode from 'qrcode';
import { CreateBatchDTO } from '../../domain/types';
import { IActorRepo } from '../../repository/interfaces';
import { AuthService } from '../../services/authService';
import { SupplyChainService } from '../../services/supplyChainService';
import { asyncHandler } from '../middleware/error';
import { requireAuth, requireRole } from '../middleware/auth';

export function batchRoutes(
  supplyChainService: SupplyChainService,
  authService: AuthService,
  actorRepo: IActorRepo,
  publicOrigin: string,
): Router {
  const router = Router();
  router.use(requireAuth(authService, actorRepo));

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      res.json(await supplyChainService.listBatches());
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      res.json(await supplyChainService.getBatch(req.params.id));
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const dto = req.body as CreateBatchDTO;
      const batch = await supplyChainService.createBatch(req.actor!, dto);
      res.status(201).json(batch);
    }),
  );

  router.post(
    '/:id/recall',
    requireRole('ADMIN'),
    asyncHandler(async (req, res) => {
      const { reason } = req.body as { reason: string };
      const batch = await supplyChainService.recallBatch(req.params.id, reason);
      res.json(batch);
    }),
  );

  router.get(
    '/:id/qr',
    asyncHandler(async (req, res) => {
      await supplyChainService.getBatch(req.params.id); // 404 if missing
      const url = `${publicOrigin}/provenance/${req.params.id}`;
      const svg = await QRCode.toString(url, { type: 'svg', margin: 1, width: 256 });
      res.type('image/svg+xml').send(svg);
    }),
  );

  return router;
}
