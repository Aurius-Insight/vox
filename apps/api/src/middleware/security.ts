import type { Express, RequestHandler } from 'express';
import cors from 'cors';
import { env, isProduction } from '../config/env.js';

export function applySecurity(app: Express) {
  app.disable('x-powered-by');

  app.use(
    cors({
      origin: env.APP_ORIGIN,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-VOX-Webhook-Secret'],
    }),
  );

  app.use(securityHeaders);
}

export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cache-Control', 'no-store');
  // A API so devolve JSON: nenhuma origem de recurso e legitima, e a resposta
  // nunca deve ser embutida em frame de terceiros.
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");

  if (isProduction) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  next();
};
