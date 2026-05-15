import type { RequestHandler } from 'express';
import { env } from '../config/env.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function originFromReferer(referer?: string): string | undefined {
  if (!referer) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}

/**
 * Defesa CSRF para a API com cookie de sessao. Em requisicoes que alteram
 * estado (POST/PATCH/PUT/DELETE), se vier `Origin`/`Referer` de um navegador,
 * ele tem que bater com `APP_ORIGIN`. Requisicoes sem Origin (curl,
 * server-to-server) passam — o webhook tem seu proprio segredo e os cookies
 * sao `SameSite=lax`. O proprio webhook fica isento por nao ser chamado pelo
 * navegador.
 */
export const csrfGuard: RequestHandler = (req, res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  if (req.path.startsWith('/api/webhooks')) return next();

  const origin = req.get('origin') ?? originFromReferer(req.get('referer'));
  if (origin && origin !== env.APP_ORIGIN) {
    return res.status(403).json({
      error: {
        code: 'csrf_origin_mismatch',
        message: 'Origem da requisicao nao autorizada.',
      },
    });
  }

  return next();
};
