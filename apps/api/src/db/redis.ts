import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

/**
 * Interface comum que a app usa pra Redis-like storage (sessoes, magic link,
 * rate limit). Tem 2 implementacoes:
 *
 * - **IoRedisAdapter** (dev/test): TCP persistente, usa o Redis em Docker.
 * - **VercelKvAdapter** (prod em Vercel): HTTP via @vercel/kv, friendly com
 *   serverless (sem socket long-lived).
 *
 * O selector escolhe baseado em `KV_REST_API_URL` (env injetada
 * automaticamente quando Vercel KV esta provisionado).
 */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  /** Set com TTL opcional em segundos. */
  set(key: string, value: string, ttlSeconds?: number): Promise<unknown>;
  /** Apaga uma ou mais chaves. */
  del(...keys: string[]): Promise<number>;
  /** GET + DEL atomico (uso unico do magic link). */
  getdel(key: string): Promise<string | null>;
  incr(key: string): Promise<number>;
  /** TTL restante em ms; -1 = sem TTL; -2 = nao existe. */
  pttl(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  /** No-op em adapters HTTP; fecha conexao em adapters TCP. */
  quit(): Promise<unknown>;
}

class IoRedisAdapter implements RedisLike {
  private readonly client: Redis;

  constructor(url: string) {
    this.client = new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: false });
    this.client.on('error', (error: Error) => {
      logger.error('redis_error', { message: error.message });
    });
  }

  get(key: string) {
    return this.client.get(key);
  }
  set(key: string, value: string, ttlSeconds?: number) {
    return ttlSeconds !== undefined
      ? this.client.set(key, value, 'EX', ttlSeconds)
      : this.client.set(key, value);
  }
  del(...keys: string[]) {
    return keys.length === 0 ? Promise.resolve(0) : this.client.del(...keys);
  }
  getdel(key: string) {
    return this.client.getdel(key);
  }
  incr(key: string) {
    return this.client.incr(key);
  }
  pttl(key: string) {
    return this.client.pttl(key);
  }
  pexpire(key: string, ms: number) {
    return this.client.pexpire(key, ms);
  }
  keys(pattern: string) {
    return this.client.keys(pattern);
  }
  quit() {
    return this.client.quit();
  }
}

class VercelKvAdapter implements RedisLike {
  // Lazy import: @vercel/kv so eh requerido em prod no Vercel; em dev/test
  // nem precisa estar instalado se nao for ser carregado.
  private readonly kv: any;

  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    this.kv = (require('@vercel/kv') as { kv: unknown }).kv;
  }

  async get(key: string) {
    const value = await this.kv.get(key);
    // @vercel/kv desserializa JSON por default; sessoes/tokens sao strings simples.
    return value == null ? null : String(value);
  }
  set(key: string, value: string, ttlSeconds?: number) {
    return ttlSeconds !== undefined
      ? this.kv.set(key, value, { ex: ttlSeconds })
      : this.kv.set(key, value);
  }
  del(...keys: string[]) {
    return keys.length === 0 ? Promise.resolve(0) : this.kv.del(...keys);
  }
  async getdel(key: string) {
    const value = await this.kv.getdel(key);
    return value == null ? null : String(value);
  }
  incr(key: string) {
    return this.kv.incr(key);
  }
  pttl(key: string) {
    return this.kv.pttl(key);
  }
  pexpire(key: string, ms: number) {
    return this.kv.pexpire(key, ms);
  }
  keys(pattern: string) {
    return this.kv.keys(pattern);
  }
  // KV e HTTP-based; nao ha conexao a fechar.
  async quit() {
    return undefined;
  }
}

function buildRedis(): RedisLike {
  const useVercelKv =
    !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN;
  return useVercelKv ? new VercelKvAdapter() : new IoRedisAdapter(env.REDIS_URL);
}

export const redis: RedisLike = buildRedis();
