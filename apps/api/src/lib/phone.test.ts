import { describe, expect, it } from 'vitest';
import { brazilPhoneCandidates, brazilSendNumber, normalizePhone } from './phone.js';

describe('brazilSendNumber', () => {
  it('insere o 9 no numero BR sem o 9 (wa_id da Meta -> envio)', () => {
    expect(brazilSendNumber('556181508486')).toBe('5561981508486');
  });
  it('mantem numero BR que ja tem o 9', () => {
    expect(brazilSendNumber('5561981508486')).toBe('5561981508486');
  });
  it('mantem numero sem codigo de pais inalterado', () => {
    expect(brazilSendNumber('21999998888')).toBe('21999998888');
  });
});

describe('normalizePhone', () => {
  it('reduz a digitos', () => {
    expect(normalizePhone('(21) 99999-8888')).toBe('21999998888');
  });
  it('nulo/indefinido viram vazio', () => {
    expect(normalizePhone(null)).toBe('');
    expect(normalizePhone(undefined)).toBe('');
  });
});

describe('brazilPhoneCandidates', () => {
  it('com 9o digito + CC gera a forma sem o 9 (caso real da Meta)', () => {
    const c = brazilPhoneCandidates('5561981508486'); // 13 digitos
    expect(c).toContain('5561981508486'); // original
    expect(c).toContain('556181508486'); // sem o 9 (wa_id da Meta)
    expect(c).toContain('61981508486'); // nacional com 9
    expect(c).toContain('6181508486'); // nacional sem 9
  });

  it('sem o 9o digito gera a forma com o 9', () => {
    const c = brazilPhoneCandidates('556181508486'); // 12 digitos
    expect(c).toContain('5561981508486');
    expect(c).toContain('556181508486');
  });

  it('numero nacional sem CC tambem gera as variantes', () => {
    const c = brazilPhoneCandidates('61981508486'); // 11 digitos
    expect(c).toContain('61981508486');
    expect(c).toContain('6181508486');
    expect(c).toContain('5561981508486');
  });

  it('vazio devolve lista vazia', () => {
    expect(brazilPhoneCandidates('')).toEqual([]);
  });

  it('sempre inclui o proprio numero normalizado', () => {
    expect(brazilPhoneCandidates('(61) 98150-8486')).toContain('61981508486');
  });
});
