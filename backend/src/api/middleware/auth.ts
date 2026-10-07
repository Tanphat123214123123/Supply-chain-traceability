import { NextFunction, Request, Response } from 'express';
import { Actor, ActorRole } from '../../domain/types';
import { AuthService } from '../../services/authService';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      actor?: Actor;
    }
  }
}

export function requireAuth(authService: AuthService) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing bearer token' });
      return;
    }

    try {
      const actor = await authService.authenticate(header.slice('Bearer '.length));
      if (!actor) {
        res.status(401).json({ error: 'Invalid, expired or inactive session' });
        return;
      }
      req.actor = actor;
      next();
    } catch (err) {
      // A database failure is not an authentication failure — let it surface as a 500.
      next(err);
    }
  };
}

export function requireRole(...roles: ActorRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.actor || !roles.includes(req.actor.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}
