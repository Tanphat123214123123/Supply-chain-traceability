import { Router } from 'express';
import { z } from 'zod';
import { AdminService } from '../../services/adminService';
import { AuthService } from '../../services/authService';
import { requireAuth, requireRole } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';
import { validateBody, validateQuery } from '../middleware/validate';
import { anomalyListQuerySchema, createInvitationSchema, paginationSchema } from '../../validation/schemas';

export function adminRoutes(adminService: AdminService, authService: AuthService): Router {
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
