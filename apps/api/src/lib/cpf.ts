import { createHash } from 'node:crypto';
import { env } from '../config/env.js';

export function normalizeCpf(cpf: string) {
  return cpf.replace(/\D/g, '');
}

export function hashCpf(cpf: string) {
  return createHash('sha256')
    .update(`${env.SESSION_SECRET}:${normalizeCpf(cpf)}`)
    .digest('hex');
}
