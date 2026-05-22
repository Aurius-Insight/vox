import { describe, expect, it } from 'vitest';
import { canConvertLead, randomEnrollmentCode, uniqueEnrollmentCode } from './enrollment.js';

describe('canConvertLead', () => {
  it('permite converter um lead que ainda nao virou aluno', () => {
    expect(canConvertLead({})).toEqual({ ok: true });
  });

  it('permite converter (promover) um lead com aluno experimental', () => {
    expect(canConvertLead({ studentType: 'experimental' })).toEqual({ ok: true });
  });

  it('bloqueia converter um lead que ja tem aluno matriculado', () => {
    expect(canConvertLead({ studentType: 'matriculado' })).toEqual({
      ok: false,
      reason: 'already_enrolled',
    });
  });
});

describe('randomEnrollmentCode', () => {
  it('gera um codigo no formato VX-0000', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(randomEnrollmentCode()).toMatch(/^VX-\d{4}$/);
    }
  });
});

describe('uniqueEnrollmentCode', () => {
  it('retorna o primeiro codigo livre', async () => {
    const code = await uniqueEnrollmentCode(async () => false);
    expect(code).toMatch(/^VX-\d{4}$/);
  });

  it('tenta de novo enquanto o codigo ja existe', async () => {
    let calls = 0;
    const code = await uniqueEnrollmentCode(async () => {
      calls += 1;
      return calls < 3; // os 2 primeiros candidatos "existem"
    });
    expect(calls).toBe(3);
    expect(code).toMatch(/^VX-\d{4}$/);
  });
});
