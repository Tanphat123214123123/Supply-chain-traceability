import { Router } from 'express';
import { RegisterDTO } from '../../domain/types';
import { AuthService } from '../../services/authService';
import { asyncHandler } from '../middleware/error';

export function authRoutes(authService: AuthService): Router {
  const router = Router();

  router.post(
    '/login',
    asyncHandler(async (req, res) => {
      const { email, password } = req.body as { email: string; password: string };
      const { token, actor } = await authService.login({ email, password });
      res.json({ token, actor });
    }),
  );

  router.post(
    '/register',
    asyncHandler(async (req, res) => {
      const dto = req.body as RegisterDTO;
      const actor = await authService.register(dto.name, dto.email, dto.password, dto.role, dto.organization);
      const { passwordHash: _omit, ...actorPublic } = actor;
      res.status(201).json(actorPublic);
    }),
  );

  return router;
}
