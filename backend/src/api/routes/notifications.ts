import { Router } from 'express';
import { IActorRepo } from '../../repository/interfaces';
import { AdminService } from '../../services/adminService';
import { AuthService } from '../../services/authService';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';

export function notificationsRoutes(adminService: AdminService, authService: AuthService, actorRepo: IActorRepo): Router {
  const router = Router();
  router.use(requireAuth(authService, actorRepo));

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const limit = Math.min(Number(req.query.limit) || 20, 100);
      res.json(await adminService.listNotifications(limit, req.actor!));
    }),
  );

  return router;
}
