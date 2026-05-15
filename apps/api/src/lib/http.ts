import type { NextFunction, Request, Response } from 'express';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function parsePagination(query: Request['query']) {
  const page = Math.max(Number(query.page ?? 1), 1);
  const pageSize = Math.min(Math.max(Number(query.pageSize ?? 25), 1), 100);
  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize,
  };
}

export function maskPhone(phone: string) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8) return '***';
  return `${digits.slice(0, 2)}*****${digits.slice(-4)}`;
}

export function maskCpf(cpf?: string) {
  if (!cpf) return undefined;
  const digits = cpf.replace(/\D/g, '');
  if (digits.length !== 11) return '***';
  return `${digits.slice(0, 3)}.***.***-${digits.slice(-2)}`;
}
