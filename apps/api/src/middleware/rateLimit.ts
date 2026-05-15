import type { Request, RequestHandler } from 'express';
import { redis } from '../db/redis.js';

type RateLimitOptions = {
  windowMs: number;
  max: number;
  keyPrefix: string;
};

function getClientKey(keyPrefix: string, req: Request) {
  const userId = req.user?.id;
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  return `rl:${keyPrefix}:${userId ?? ip}`;
}

export function rateLimit(options: RateLimitOptions): RequestHandler {
  return async (req, res, next) => {
    try {
      const key = getClientKey(options.keyPrefix, req);

      const count = await redis.incr(key);
      let ttlMs = await redis.pttl(key);

      if (ttlMs < 0) {
        await redis.pexpire(key, options.windowMs);
        ttlMs = options.windowMs;
      }

      const resetAtSeconds = Math.ceil((Date.now() + ttlMs) / 1000);
      const remaining = Math.max(options.max - count, 0);

      res.setHeader('RateLimit-Limit', String(options.max));
      res.setHeader('RateLimit-Remaining', String(remaining));
      res.setHeader('RateLimit-Reset', String(resetAtSeconds));

      if (count > options.max) {
        res.setHeader('Retry-After', String(Math.ceil(ttlMs / 1000)));
        return res.status(429).json({
          error: {
            code: 'too_many_requests',
            message: 'Muitas requisicoes. Tente novamente em instantes.',
          },
        });
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export const apiLimiter = rateLimit({
  keyPrefix: 'api',
  windowMs: 60_000,
  max: 300,
});

export const authLimiter = rateLimit({
  keyPrefix: 'auth',
  windowMs: 15 * 60_000,
  max: 20,
});

export const portalLimiter = rateLimit({
  keyPrefix: 'portal',
  windowMs: 15 * 60_000,
  max: 30,
});

export const webhookLimiter = rateLimit({
  keyPrefix: 'webhook',
  windowMs: 60_000,
  max: 120,
});
