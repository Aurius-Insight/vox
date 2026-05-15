import { describe, expect, it } from 'vitest';
import { redact, serializeError } from './logger.js';

const REDACTED = '[REDACTED]';

describe('redact', () => {
  it('mascara chaves sensiveis em qualquer profundidade', () => {
    const input = {
      name: 'Ana',
      password: 'segredo',
      nested: { token: 'abc', cpf: '12345678900', ok: 1 },
    };
    expect(redact(input)).toEqual({
      name: 'Ana',
      password: REDACTED,
      nested: { token: REDACTED, cpf: REDACTED, ok: 1 },
    });
  });

  it('mascara variantes (camelCase, snake_case, kebab-case)', () => {
    expect(
      redact({
        passwordHash: 'a',
        password_hash: 'b',
        refreshToken: 'c',
        accessToken: 'd',
        'api-key': 'e',
        'set-cookie': 'f',
        cpfMasked: '111.***',
      }),
    ).toEqual({
      passwordHash: REDACTED,
      password_hash: REDACTED,
      refreshToken: REDACTED,
      accessToken: REDACTED,
      'api-key': REDACTED,
      'set-cookie': REDACTED,
      cpfMasked: REDACTED,
    });
  });

  it('mascara email, whatsapp e Authorization (case-insensitive)', () => {
    expect(redact({ Authorization: 'Bearer x', WhatsApp: '21999', email: 'a@b.c' })).toEqual({
      Authorization: REDACTED,
      WhatsApp: REDACTED,
      email: REDACTED,
    });
  });

  it('mascara dentro de arrays', () => {
    expect(redact([{ whatsapp: '21999998888' }, { ok: true }])).toEqual([
      { whatsapp: REDACTED },
      { ok: true },
    ]);
  });

  it('preserva Date como ISO string (nao zera para {})', () => {
    const date = new Date('2026-05-14T12:00:00.000Z');
    expect(redact({ when: date })).toEqual({ when: '2026-05-14T12:00:00.000Z' });
  });

  it('nao altera o objeto original (imutavel)', () => {
    const input = { password: 'x' };
    redact(input);
    expect(input.password).toBe('x');
  });

  it('lida com referencia circular sem estourar', () => {
    const node: Record<string, unknown> = { name: 'loop' };
    node.self = node;
    expect(() => redact(node)).not.toThrow();
  });

  it('passa valores primitivos sem alteracao', () => {
    expect(redact('texto')).toBe('texto');
    expect(redact(42)).toBe(42);
    expect(redact(null)).toBeNull();
  });

  it('nao mascara identificadores comuns como id, name, status', () => {
    expect(redact({ id: 'u1', name: 'Ana', status: 'ok', userId: 'u1' })).toEqual({
      id: 'u1',
      name: 'Ana',
      status: 'ok',
      userId: 'u1',
    });
  });
});

describe('serializeError', () => {
  it('extrai nome e mensagem; stack so em dev/test (nao em producao)', () => {
    const result = serializeError(new TypeError('quebrou'));
    expect(result.name).toBe('TypeError');
    expect(result.message).toBe('quebrou');
    // NODE_ENV=test => nao e producao, stack inclusa para debugging.
    expect(typeof result.stack).toBe('string');
  });

  it('serializa valores que nao sao Error', () => {
    expect(serializeError('falha crua')).toEqual({ value: 'falha crua' });
  });
});
