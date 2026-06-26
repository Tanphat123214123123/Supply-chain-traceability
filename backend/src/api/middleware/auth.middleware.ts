import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../../services/authService';
import { ActorRole } from '../../domain/types';

export interface AuthRequest extends Request {
  actor?: {
    actorId: string;
    role: ActorRole;
    email: string;
  };
}

export function authMiddleware(authService: AuthService) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid Authorization header' });
      return;
    }
    try {
      req.actor = authService.verifyToken(header.slice(7));
      next();
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
}

export function requireRole(...roles: ActorRole[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.actor || !roles.includes(req.actor.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}
