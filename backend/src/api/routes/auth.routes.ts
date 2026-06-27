import { Router, Request, Response, NextFunction } from 'express';
import { AuthService } from '../../services/authService';
import { ActorRole } from '../../domain/types';

export function authRouter(authService: AuthService): Router {
  const router = Router();

  router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        res.status(400).json({ error: 'email and password are required' });
        return;
      }
      const result = await authService.login({ email, password });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, email, password, role, organization } = req.body;
      if (!name || !email || !password || !role || !organization) {
        res.status(400).json({ error: 'name, email, password, role, and organization are required' });
        return;
      }
      if (!Object.values(ActorRole).includes(role)) {
        res.status(400).json({ error: `Invalid role. Valid values: ${Object.values(ActorRole).join(', ')}` });
        return;
      }
      const actor = await authService.register(name, email, password, role as ActorRole, organization);
      const { passwordHash: _omit, ...actorPublic } = actor;
      res.status(201).json(actorPublic);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
