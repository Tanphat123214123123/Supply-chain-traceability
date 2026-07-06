import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { IActorRepo } from '../../repository/interfaces';
import { AuthService, REFRESH_TOKEN_TTL_MS } from '../../services/authService';
import { UnauthorizedError } from '../../errors';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';
import { validateBody } from '../middleware/validate';
import { changePasswordSchema, loginSchema, registerSchema, updateProfileSchema } from '../../validation/schemas';

const REFRESH_COOKIE_NAME = 'refreshToken';
const REFRESH_COOKIE_PATH = '/api/auth';

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_TOKEN_TTL_MS,
  };
}

export function authRoutes(authService: AuthService, actorRepo: IActorRepo): Router {
  const router = Router();

  // Login attempts are far more brute-forceable than the rest of the API, so
  // they get their own tight limit on top of the app-wide one in app.ts.
  // Created per-router (not module-scoped) so each app instance — notably
  // each test's own `createApp()` call — gets an independent counter.
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts, please try again in a few minutes' },
  });

  router.post(
    '/login',
    loginLimiter,
    validateBody(loginSchema),
    asyncHandler(async (req, res) => {
      const { email, password } = req.body as { email: string; password: string };
      const { token, refreshToken, actor } = await authService.login({ email, password });
      res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions());
      res.json({ token, actor });
    }),
  );

  router.post(
    '/register',
    validateBody(registerSchema),
    asyncHandler(async (req, res) => {
      const dto = req.body as z.infer<typeof registerSchema>;
      const actor = await authService.register(
        dto.name,
        dto.email,
        dto.password,
        dto.role,
        dto.organization,
        dto.tenantSlug,
        dto.tenantName,
      );
      const { passwordHash: _omit, ...actorPublic } = actor;
      res.status(201).json(actorPublic);
    }),
  );

  router.post(
    '/refresh',
    asyncHandler(async (req, res) => {
      const refreshToken = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE_NAME];
      if (!refreshToken) throw new UnauthorizedError('Missing refresh token');

      const tokens = await authService.refresh(refreshToken);
      res.cookie(REFRESH_COOKIE_NAME, tokens.refreshToken, refreshCookieOptions());
      res.json({ token: tokens.token, actor: tokens.actor });
    }),
  );

  router.post(
    '/logout',
    asyncHandler(async (req, res) => {
      const refreshToken = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE_NAME];
      if (refreshToken) await authService.logout(refreshToken);
      res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
      res.status(204).send();
    }),
  );

  const authed = requireAuth(authService, actorRepo);

  router.get(
    '/me',
    authed,
    asyncHandler(async (req, res) => {
      const { passwordHash: _omit, ...actorPublic } = req.actor!;
      res.json(actorPublic);
    }),
  );

  router.patch(
    '/me',
    authed,
    validateBody(updateProfileSchema),
    asyncHandler(async (req, res) => {
      const updated = await authService.updateProfile(req.actor!.id, req.body as z.infer<typeof updateProfileSchema>);
      const { passwordHash: _omit, ...actorPublic } = updated;
      res.json(actorPublic);
    }),
  );

  router.patch(
    '/me/password',
    authed,
    validateBody(changePasswordSchema),
    asyncHandler(async (req, res) => {
      await authService.changePassword(req.actor!.id, req.body as z.infer<typeof changePasswordSchema>);
      res.status(204).send();
    }),
  );

  router.get(
    '/sessions',
    authed,
    asyncHandler(async (req, res) => {
      const sessions = await authService.listSessions(req.actor!.id);
      res.json(sessions.map((s) => ({ token: s.token.slice(0, 8), expiresAt: s.expiresAt, createdAt: s.createdAt })));
    }),
  );

  router.delete(
    '/sessions/:tokenPrefix',
    authed,
    asyncHandler(async (req, res) => {
      const sessions = await authService.listSessions(req.actor!.id);
      const full = sessions.find((s) => s.token.startsWith(req.params.tokenPrefix));
      if (full) await authService.revokeSession(req.actor!.id, full.token);
      res.status(204).send();
    }),
  );

  return router;
}
