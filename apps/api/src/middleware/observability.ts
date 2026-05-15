import type { RequestHandler } from 'express';
import { logger } from '../lib/logger.js';

// Status que merecem trilha de monitoramento: acesso negado e rate limit.
// Erros 5xx ja sao logados pelo errorHandler, entao ficam de fora aqui.
const MONITORED = new Set([401, 403, 429]);

/**
 * Registra um evento estruturado para respostas 401/403/429, dando base
 * para alertas de tentativas barradas sem depender de stack externa.
 */
export const observability: RequestHandler = (req, res, next) => {
  res.on('finish', () => {
    if (!MONITORED.has(res.statusCode)) return;
    logger.warn('access_denied', {
      status: res.statusCode,
      method: req.method,
      path: req.path,
      ip: req.ip,
      userId: req.user?.id,
    });
  });
  next();
};
