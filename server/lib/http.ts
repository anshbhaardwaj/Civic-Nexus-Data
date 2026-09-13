/**
 * HTTP plumbing: consistent error envelope {error:{code,message,details?}},
 * auth + RBAC middleware, Zod validation helpers, audit-on-mutation helper.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, ZodTypeAny, z } from 'zod';
import { appendAudit } from './audit';
import { Permission, Role, can, verifyToken } from './auth';

export interface AuthedUser {
  id: number;
  email: string;
  name: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser;
      validated?: { body?: unknown; query?: unknown; params?: unknown };
    }
  }
}

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
  static unauthorized(message = 'Authentication required') {
    return new ApiError(401, 'UNAUTHORIZED', message);
  }
  static forbidden(message = 'Not permitted for your role') {
    return new ApiError(403, 'FORBIDDEN', message);
  }
  static notFound(message = 'Resource not found') {
    return new ApiError(404, 'NOT_FOUND', message);
  }
  static validation(message: string, details?: unknown) {
    return new ApiError(422, 'VALIDATION_ERROR', message, details);
  }
  /** 422 for analytically-not-applicable requests (e.g. forecast on cross-sectional data) */
  static notApplicable(message: string, details?: unknown) {
    return new ApiError(422, 'NOT_APPLICABLE', message, details);
  }
  static badRequest(message: string, details?: unknown) {
    return new ApiError(400, 'BAD_REQUEST', message, details);
  }
}

/** Wraps sync/async handlers so thrown errors reach the error middleware. */
export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => unknown): RequestHandler {
  return (req, res, next) => {
    try {
      const out = fn(req, res, next);
      if (out && typeof (out as Promise<unknown>).catch === 'function') {
        (out as Promise<unknown>).catch(next);
      }
    } catch (err) {
      next(err);
    }
  };
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(header);
  const token = m ? m[1] : typeof req.query.token === 'string' ? req.query.token : null;
  if (!token) return next(ApiError.unauthorized('Missing bearer token'));
  const payload = verifyToken(token);
  if (!payload) return next(ApiError.unauthorized('Invalid or expired token'));
  req.user = { id: payload.sub, email: payload.email, name: payload.name, role: payload.role };
  next();
};

export function requirePermission(permission: Permission): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!can(req.user.role, permission)) {
      return next(
        ApiError.forbidden(`Role '${req.user.role}' lacks permission '${permission}'`),
      );
    }
    next();
  };
}

export interface ValidateShape {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

export function validate(shape: ValidateShape): RequestHandler {
  return (req, _res, next) => {
    req.validated = {};
    for (const key of ['body', 'query', 'params'] as const) {
      const schema = shape[key];
      if (!schema) continue;
      const result = schema.safeParse(req[key]);
      if (!result.success) {
        const err = result.error as ZodError;
        return next(
          ApiError.validation(`Invalid ${key}`, err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))),
        );
      }
      req.validated[key] = result.data;
    }
    next();
  };
}

export function v<T>(req: Request, key: 'body' | 'query' | 'params'): T {
  return (req.validated?.[key] ?? {}) as T;
}

/** Records an audit entry for a mutating request. */
export function audit(req: Request, action: string, entity: string, payload?: unknown) {
  return appendAudit({
    actor: req.user?.email ?? 'system',
    actorRole: req.user?.role ?? 'system',
    action,
    entity,
    payload,
  });
}

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `No route matches ${req.method} ${req.path}` },
  });
};

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ApiError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) },
    });
    return;
  }
  if (err instanceof ZodError) {
    res.status(422).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
    return;
  }
  const message = err instanceof Error ? err.message : 'Unexpected server error';
  // eslint-disable-next-line no-console
  console.error('[error]', err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message } });
}

/* --------------------------------------------------- common zod schemas */

export const zPositiveInt = z.coerce.number().int().positive();
export const zIdParam = z.object({ id: zPositiveInt });
export const zPaging = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
