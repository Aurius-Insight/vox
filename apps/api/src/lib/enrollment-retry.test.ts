import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { isEnrollmentCodeConflict, withEnrollmentCodeRetry } from './enrollment-retry.js';

function p2002(target: string[] | string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target },
  });
}

describe('isEnrollmentCodeConflict', () => {
  it('reconhece conflito em enrollmentCode (array)', () => {
    expect(isEnrollmentCodeConflict(p2002(['enrollmentCode']))).toBe(true);
  });

  it('reconhece conflito em enrollmentCode (string)', () => {
    expect(isEnrollmentCodeConflict(p2002('enrollmentCode'))).toBe(true);
  });

  it('ignora P2002 em outros campos (ex: cpfHash, whatsapp)', () => {
    expect(isEnrollmentCodeConflict(p2002(['cpfHash']))).toBe(false);
    expect(isEnrollmentCodeConflict(p2002(['whatsapp']))).toBe(false);
  });

  it('ignora erros que nao sao P2002', () => {
    const other = new Prisma.PrismaClientKnownRequestError('not found', {
      code: 'P2025',
      clientVersion: 'test',
    });
    expect(isEnrollmentCodeConflict(other)).toBe(false);
  });

  it('ignora erros genericos (nao do Prisma)', () => {
    expect(isEnrollmentCodeConflict(new Error('qualquer'))).toBe(false);
  });
});

describe('withEnrollmentCodeRetry', () => {
  it('retorna o resultado quando handler succeed na primeira', async () => {
    let calls = 0;
    const result = await withEnrollmentCodeRetry(async () => {
      calls += 1;
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(calls).toBe(1);
  });

  it('retenta em P2002 de enrollmentCode ate succeed', async () => {
    let calls = 0;
    const result = await withEnrollmentCodeRetry(async () => {
      calls += 1;
      if (calls < 3) throw p2002(['enrollmentCode']);
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('propaga erros que nao sao conflict de enrollmentCode', async () => {
    await expect(
      withEnrollmentCodeRetry(async () => {
        throw p2002(['cpfHash']);
      }),
    ).rejects.toMatchObject({ code: 'P2002', meta: { target: ['cpfHash'] } });
  });

  it('propaga o ultimo erro apos exaurir tentativas', async () => {
    let calls = 0;
    await expect(
      withEnrollmentCodeRetry(async () => {
        calls += 1;
        throw p2002(['enrollmentCode']);
      }, 3),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(calls).toBe(3);
  });
});
