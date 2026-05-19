import { describe, expect, it } from 'vitest';
import { leadSearchConditions } from './lead-search.js';

describe('leadSearchConditions', () => {
  it('termo textual busca nome, unidade e campanha — sem filtro de WhatsApp', () => {
    const conditions = leadSearchConditions('Guilherme');
    expect(conditions).toHaveLength(3);
    expect(conditions.some((condition) => 'whatsapp' in condition)).toBe(false);
  });

  it('termo com digitos adiciona o filtro de WhatsApp so com os digitos', () => {
    const conditions = leadSearchConditions('(21) 99999-8888');
    expect(conditions).toHaveLength(4);
    expect(conditions.at(-1)).toEqual({ whatsapp: { contains: '21999998888' } });
  });

  it('termo so com pontuacao nao gera filtro de WhatsApp (evita contains vazio)', () => {
    const conditions = leadSearchConditions('---');
    expect(conditions.some((condition) => 'whatsapp' in condition)).toBe(false);
  });
});
