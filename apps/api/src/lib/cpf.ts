import { createHash } from 'node:crypto';
import { env } from '../config/env.js';

export function normalizeCpf(cpf: string) {
  return cpf.replace(/\D/g, '');
}

/**
 * Hash determinista do CPF pra dedup sem armazenar o numero em claro.
 *
 * Prefere `CPF_HASH_SALT` (env dedicada). Cai pro `SESSION_SECRET` se
 * a env nao estiver setada — preserva os hashes legados. Quem ja tem
 * dados em prod NAO deve setar `CPF_HASH_SALT` retroativamente: isso
 * mudaria todos os hashes e quebraria a dedup historica. Setar apenas
 * em deploys novos.
 */
const CPF_SALT = env.CPF_HASH_SALT ?? env.SESSION_SECRET;

export function hashCpf(cpf: string) {
  return createHash('sha256')
    .update(`${CPF_SALT}:${normalizeCpf(cpf)}`)
    .digest('hex');
}
