import { env, isProduction } from '../config/env.js';

type LogLevel = 'info' | 'warn' | 'error';

// Padroes (case-insensitive, substring) cujos VALORES nunca devem ir para o log.
// Padrao em vez de set exato pega variantes (`passwordHash`, `password_hash`,
// `refreshToken`, `set-cookie`, `cpfMasked`, etc.).
const SENSITIVE_PATTERNS: readonly RegExp[] = [
  /pass(word)?/i,
  /secret/i,
  /token/i,
  /authorization/i,
  /cookie/i,
  /api[-_]?key/i,
  /cpf/i,
  /whatsapp/i,
  /email/i,
  /\bjwt\b/i,
  /bearer/i,
  /credential/i,
];

const REDACTED = '[REDACTED]';

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(key));
}

/**
 * Remove valores de chaves sensiveis antes de logar. Recursivo, imutavel
 * (nao altera o objeto original) e tolerante a referencias circulares.
 */
export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== 'object') return value;
  // Tipos especiais que `Object.entries` zeraria silenciosamente.
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, seen));
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, val]) => [
      key,
      isSensitiveKey(key) ? REDACTED : redact(val, seen),
    ]),
  );
}

/**
 * Serializa um erro de forma segura para virar contexto de log. Em producao
 * a stack nao vai pro log (pode embutir valores sensiveis na descricao do
 * frame); em dev a stack ajuda a debugar.
 */
export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(isProduction ? {} : { stack: error.stack }),
    };
  }
  return { value: String(error) };
}

function write(level: LogLevel, msg: string, context?: Record<string, unknown>) {
  // Logs nao poluem a saida dos testes.
  if (env.NODE_ENV === 'test') return;

  const entry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(context ? (redact(context) as Record<string, unknown>) : {}),
  };
  const line = `${JSON.stringify(entry)}\n`;
  if (level === 'error') process.stderr.write(line);
  else process.stdout.write(line);
}

/** Logger estruturado em JSON. Uma linha por evento, campos sensiveis redigidos. */
export const logger = {
  info: (msg: string, context?: Record<string, unknown>) => write('info', msg, context),
  warn: (msg: string, context?: Record<string, unknown>) => write('warn', msg, context),
  error: (msg: string, context?: Record<string, unknown>) => write('error', msg, context),
};
