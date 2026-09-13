/** /api/auth/* — login, logout, session echo, demo users, permission map. */
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import {
  DEMO_USERS,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  Role,
  UserRow,
  findUserByEmail,
  signToken,
  verifyPassword,
} from '../lib/auth';
import { ApiError, asyncHandler, audit, requireAuth, v, validate } from '../lib/http';

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().min(3).max(120),
  password: z.string().min(4).max(200),
});

authRouter.post(
  '/login',
  validate({ body: loginSchema }),
  asyncHandler((req, res) => {
    const { email, password } = v<{ email: string; password: string }>(req, 'body');
    const user = findUserByEmail(email) as UserRow | undefined;
    if (!user || !user.active) {
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
    }
    if (!verifyPassword(password, user.salt, user.password_hash)) {
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
    }
    const { token, expiresAt } = signToken({ id: user.id, email: user.email, name: user.name, role: user.role });
    req.user = { id: user.id, email: user.email, name: user.name, role: user.role };
    audit(req, 'auth.login', `user:${user.email}`, { role: user.role });
    res.json({
      token,
      expiresAt,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        permissions: ROLE_PERMISSIONS[user.role],
      },
    });
  }),
);

authRouter.post(
  '/logout',
  requireAuth,
  asyncHandler((req, res) => {
    audit(req, 'auth.logout', `user:${req.user!.email}`, {});
    res.json({ ok: true, message: 'Token discarded client-side; no server session is kept.' });
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler((req, res) => {
    const u = req.user!;
    res.json({ user: { ...u, permissions: ROLE_PERMISSIONS[u.role] } });
  }),
);

authRouter.get(
  '/demo-users',
  asyncHandler((_req, res) => {
    const rows = (
      db.prepare('SELECT email, name, role FROM users ORDER BY id').all() as {
        email: string;
        name: string;
        role: Role;
      }[]
    ).filter((r) => DEMO_USERS.some((d) => d.email === r.email));
    res.json({
      users: rows.map((r) => ({
        ...r,
        password: DEMO_USERS.find((d) => d.email === r.email)?.password ?? 'Demo@1234',
        permissions: ROLE_PERMISSIONS[r.role],
      })),
      note: 'Demo credentials are intentionally published for the SIH evaluation build.',
    });
  }),
);

authRouter.get(
  '/permissions',
  asyncHandler((_req, res) => {
    res.json({ permissions: PERMISSIONS, roles: ROLE_PERMISSIONS });
  }),
);
