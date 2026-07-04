import { NextFunction, Request, Response } from 'express';
import { Actor, ActorRole } from '../../domain/types';
import { IActorRepo } from '../../repository/interfaces';
import { AuthService } from '../../services/authService';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      actor?: Actor;
    }
  }
}

export function requireAuth(authService: AuthService, actorRepo: IActorRepo) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing bearer token' });
      return;
    }

    try {
      const payload = authService.verifyToken(header.slice('Bearer '.length));
      const actor = await actorRepo.findById(payload.actorId);
      if (!actor || !actor.isActive) {
        res.status(401).json({ error: 'Invalid or inactive account' });
        return;
      }
      req.actor = actor;
      next();
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
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
