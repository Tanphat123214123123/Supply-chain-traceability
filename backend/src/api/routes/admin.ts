import { Router } from 'express';
import { z } from 'zod';
import { IActorRepo, IAuditLogRepo } from '../../repository/interfaces';
import { AdminService } from '../../services/adminService';
import { AuthService } from '../../services/authService';
import { requireAuth, requireRole } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';
import { validateQuery } from '../middleware/validate';
import { anomalyListQuerySchema, paginationSchema } from '../../validation/schemas';

export function adminRoutes(
  auditLogRepo: IAuditLogRepo,
  adminService: AdminService,
  authService: AuthService,
  actorRepo: IActorRepo,
): Router {
  const router = Router();
  router.use(requireAuth(authService, actorRepo));
  router.use(requireRole('ADMIN'));

  router.get(
    '/audit-logs',
    validateQuery(paginationSchema),
    asyncHandler(async (req, res) => {
      const { page, pageSize } = req.query as unknown as z.infer<typeof paginationSchema>;
      res.json(await auditLogRepo.findPageByTenant(req.actor!.tenantId, page, pageSize));
    }),
  );

  router.get(
    '/anomalies',
    validateQuery(anomalyListQuerySchema),
    asyncHandler(async (req, res) => {
      const query = req.query as unknown as z.infer<typeof anomalyListQuerySchema>;
      res.json(await adminService.listAnomalies(req.actor!.tenantId, query));
    }),
  );

  router.patch(
    '/anomalies/:id/resolve',
    asyncHandler(async (req, res) => {
      res.json(await adminService.resolveAnomaly(req.actor!, req.params.id));
    }),
  );

  // On-demand chain-integrity sweep — also run once automatically at server startup.
  router.post(
    '/scan-integrity',
    asyncHandler(async (_req, res) => {
      const flagged = await adminService.scanForTamperedChains();
      res.json({ flagged });
    }),
  );

  return router;
}
