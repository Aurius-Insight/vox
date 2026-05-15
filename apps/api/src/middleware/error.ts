import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { ApiError } from '../lib/http.js';
import { logger, serializeError } from '../lib/logger.js';

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({
    error: {
      code: 'not_found',
      message: 'Endpoint nao encontrado.',
    },
  });
};

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (error instanceof ApiError) {
    return res.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    });
  }

  if (error instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'invalid_payload',
        message: 'Dados invalidos.',
        details: error.flatten(),
      },
    });
  }

  logger.error('unhandled_error', {
    method: req.method,
    path: req.path,
    ...serializeError(error),
  });

  return res.status(500).json({
    error: {
      code: 'internal_error',
      message: 'Erro interno.',
    },
  });
};
