import type { Request, RequestHandler, Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { Role } from '@prisma/client';
import { isProduction } from '../config/env.js';
import { prisma } from '../db/client.js';
import { redis } from '../db/redis.js';
import { ApiError } from '../lib/http.js';
import { hasRoleAccess } from '../domain/access.js';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        name: string;
        roles: Role[];
        unitId: string | null;
      };
      student?: {
        id: string;
        name: string;
      };
    }
  }
}

const SESSION_COOKIE = 'vox_session';
const PORTAL_COOKIE = 'vox_portal_session';
const PORTAL_COOKIE_PATH = '/api/portal';
const SESSION_TTL_MS = 8 * 60 * 60_000;
const PORTAL_SESSION_TTL_MS = 2 * 60 * 60_000;
const SESSION_TTL_SECONDS = SESSION_TTL_MS / 1000;
const PORTAL_SESSION_TTL_SECONDS = PORTAL_SESSION_TTL_MS / 1000;

const userSessionKey = (sessionId: string) => `sess:user:${sessionId}`;
const portalSessionKey = (sessionId: string) => `sess:portal:${sessionId}`;

async function publicUser(userId: string) {
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      active: true,
    },
    select: {
      id: true,
      email: true,
      name: true,
      roles: true,
      unitId: true,
    },
  });

  return user ?? undefined;
}

export async function createUserSession(userId: string) {
  const sessionId = randomUUID();
  await redis.set(userSessionKey(sessionId), userId, SESSION_TTL_SECONDS);
  return sessionId;
}

export async function createPortalSession(studentId: string) {
  const sessionId = randomUUID();
  await redis.set(portalSessionKey(sessionId), studentId, PORTAL_SESSION_TTL_SECONDS);
  return sessionId;
}

export function setUserSessionCookie(res: Response, sessionId: string) {
  res.cookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
}

export function setPortalSessionCookie(res: Response, sessionId: string) {
  res.cookie(PORTAL_COOKIE, sessionId, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: PORTAL_SESSION_TTL_MS,
    path: PORTAL_COOKIE_PATH,
  });
}

export async function clearUserSession(req: Request, res: Response) {
  const sessionId = req.cookies?.[SESSION_COOKIE];
  if (sessionId) await redis.del(userSessionKey(sessionId));
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export async function clearPortalSession(req: Request, res: Response) {
  const sessionId = req.cookies?.[PORTAL_COOKIE];
  if (sessionId) await redis.del(portalSessionKey(sessionId));
  res.clearCookie(PORTAL_COOKIE, { path: PORTAL_COOKIE_PATH });
}

export const attachUser: RequestHandler = async (req, _res, next) => {
  try {
    const sessionId = req.cookies?.[SESSION_COOKIE];
    if (!sessionId) return next();

    const userId = await redis.get(userSessionKey(sessionId));
    if (!userId) return next();

    const user = await publicUser(userId);
    if (user) req.user = user;
    return next();
  } catch (error) {
    return next(error);
  }
};

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user) {
    return next(new ApiError(401, 'unauthenticated', 'Login obrigatorio.'));
  }
  return next();
};

export function requireRole(...allowedRoles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      return next(new ApiError(401, 'unauthenticated', 'Login obrigatorio.'));
    }

    if (!hasRoleAccess(req.user.roles, allowedRoles)) {
      return next(new ApiError(403, 'forbidden', 'Permissao insuficiente.'));
    }

    return next();
  };
}

export const attachPortalStudent: RequestHandler = async (req, _res, next) => {
  try {
    const sessionId = req.cookies?.[PORTAL_COOKIE];
    if (!sessionId) return next();

    const studentId = await redis.get(portalSessionKey(sessionId));
    if (!studentId) return next();

    const student = await prisma.student.findFirst({
      where: {
        id: studentId,
        active: true,
      },
      select: {
        id: true,
        name: true,
      },
    });

    if (student) req.student = student;
    return next();
  } catch (error) {
    return next(error);
  }
};

export const requirePortalStudent: RequestHandler = (req, _res, next) => {
  if (!req.student) {
    return next(new ApiError(401, 'portal_unauthenticated', 'Acesso do aluno expirado ou invalido.'));
  }
  return next();
};
