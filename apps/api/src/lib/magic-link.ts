import { randomUUID } from 'node:crypto';
import { redis } from '../db/redis.js';
import { env } from '../config/env.js';

// Link magico do portal do aluno: token de uso unico, valido por 1 hora.
// So serve para "abrir a porta" uma vez — depois a sessao do portal
// (deslizante, renovada a cada uso) mantem o aluno logado por muito tempo.
// Usado pelo proprio aluno (POST /api/portal/magic-links) e pela equipe
// interna (POST /api/students/:id/magic-link) para reenviar acesso.
export const MAGIC_LINK_TTL_SECONDS = 60 * 60;

const magicLinkKey = (token: string) => `magic:${token}`;

/** Gera um token de acesso e devolve token + URL pronta do portal. */
export async function createMagicLink(
  studentId: string,
): Promise<{ token: string; link: string }> {
  const token = randomUUID();
  await redis.set(magicLinkKey(token), studentId, MAGIC_LINK_TTL_SECONDS);
  return { token, link: `${env.APP_ORIGIN}/portal/entrar?token=${token}` };
}

/** Consome o token (GETDEL atomico — uso unico). Devolve o studentId ou null. */
export async function consumeMagicLink(token: string): Promise<string | null> {
  return redis.getdel(magicLinkKey(token));
}
