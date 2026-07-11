import { Router } from 'express';
import { z } from 'zod';
import { IActorRepo } from '../../repository/interfaces';
import { AdminService } from '../../services/adminService';
import { AuthService } from '../../services/authService';
import { requireAuth, requireRole } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';
import { validateBody } from '../middleware/validate';
import { setActorRoleSchema, setActorStatusSchema } from '../../validation/schemas';

/**
 * Visible to every authenticated role (read-only) — knowing which partner
 * organizations participate in the chain is part of traceability itself.
 * Only ADMIN can change status/role, gated per-route below.
 */
export function actorsRoutes(adminService: AdminService, authService: AuthService, actorRepo: IActorRepo): Router {
  const router = Router();
  router.use(requireAuth(authService, actorRepo));

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      res.json(await adminService.listActors(req.actor!));
    }),
  );

  router.get(
    '/partners',
    asyncHandler(async (req, res) => {
      res.json(await adminService.listPartners(req.actor!.tenantId));
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      res.json(await adminService.getActorDetail(req.params.id, req.actor!));
    }),
  );

  router.patch(
    '/:id/status',
    requireRole('ADMIN'),
    validateBody(setActorStatusSchema),
    asyncHandler(async (req, res) => {
      const { isActive } = req.body as z.infer<typeof setActorStatusSchema>;
      const updated = await adminService.setActorStatus(req.actor!, req.params.id, isActive);
      const { passwordHash: _omit, ...actorPublic } = updated;
      res.json(actorPublic);
    }),
  );

  router.patch(
    '/:id/role',
    requireRole('ADMIN'),
    validateBody(setActorRoleSchema),
    asyncHandler(async (req, res) => {
      const { role } = req.body as z.infer<typeof setActorRoleSchema>;
      const updated = await adminService.setActorRole(req.actor!, req.params.id, role);
      const { passwordHash: _omit, ...actorPublic } = updated;
      res.json(actorPublic);
    }),
  );

  return router;
}
