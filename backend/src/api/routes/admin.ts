import { Router } from 'express';
import { z } from 'zod';
import { AdminService } from '../../services/adminService';
import { AppContext } from '../../bootstrap';
import { AuthService } from '../../services/authService';
import { requireAuth, requireRole } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';
import { validateBody, validateQuery } from '../middleware/validate';
import { anomalyListQuerySchema, createInvitationSchema, paginationSchema } from '../../validation/schemas';

export function adminRoutes(
  adminService: AdminService,
  authService: AuthService,
  anchoring: Pick<AppContext, 'anchorStore' | 'anchorWorker' | 'anchorInfo'>,
): Router {
  const router = Router();
  router.use(requireAuth(authService));
  router.use(requireRole('ADMIN'));

  router.get(
    '/audit-logs',
    validateQuery(paginationSchema),
    asyncHandler(async (req, res) => {
      const { page, pageSize } = req.query as unknown as z.infer<typeof paginationSchema>;
      res.json(await adminService.listAuditLogs(req.actor!, page, pageSize));
    }),
  );

  router.get(
    '/anomalies',
    validateQuery(anomalyListQuerySchema),
    asyncHandler(async (req, res) => {
      const query = req.query as unknown as z.infer<typeof anomalyListQuerySchema>;
      res.json(await adminService.listAnomalies(req.actor!, query));
    }),
  );

  router.patch(
    '/anomalies/:id/resolve',
    asyncHandler(async (req, res) => {
      res.json(await adminService.resolveAnomaly(req.actor!, req.params.id));
    }),
  );

  router.get(
    '/invitations',
    asyncHandler(async (req, res) => {
      res.json(await authService.listInvitations(req.actor!));
    }),
  );

  router.post(
    '/invitations',
    validateBody(createInvitationSchema),
    asyncHandler(async (req, res) => {
      const dto = req.body as z.infer<typeof createInvitationSchema>;
      res.status(201).json(await authService.createInvitation(req.actor!, dto));
    }),
  );

  router.delete(
    '/invitations/:id',
    asyncHandler(async (req, res) => {
      res.json(await authService.revokeInvitation(req.actor!, req.params.id));
    }),
  );

  // Anchoring status — the anchors table holds only public data (roots, tx hashes).
  router.get(
    '/anchors',
    asyncHandler(async (_req, res) => {
      res.json({ ...anchoring.anchorInfo, anchors: await anchoring.anchorStore.findRecent(50) });
    }),
  );

  // Run one anchoring step now instead of waiting for the next interval (demo, ops).
  router.post(
    '/anchors/run',
    asyncHandler(async (_req, res) => {
      if (!anchoring.anchorWorker) {
        res.status(409).json({ error: 'Anchoring is not configured' });
        return;
      }
      res.json(await anchoring.anchorWorker.tick());
    }),
  );

  // On-demand chain-integrity sweep of the admin's own tenant — every tenant
  // is also swept once in the background at server startup.
  router.post(
    '/scan-integrity',
    asyncHandler(async (req, res) => {
      const flagged = await adminService.scanForTamperedChains(req.actor!.tenantId);
      res.json({ flagged });
    }),
  );

  return router;
}
