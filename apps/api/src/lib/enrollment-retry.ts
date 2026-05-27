import { Prisma } from '@prisma/client';

/**
 * Retry helper para handlers que criam Student e podem colidir no
 * `enrollmentCode` (gerado aleatoriamente por `uniqueEnrollmentCode`).
 *
 * A geracao no app (`check → insert`) tem janela de race: duas criacoes
 * simultaneas podem pegar o mesmo codigo antes do insert. O banco rejeita
 * a segunda com P2002 (unique constraint em `Student.enrollmentCode`).
 * Em vez de explodir 500, capturamos o P2002 especificamente do campo
 * `enrollmentCode` e refazemos o handler ate `maxAttempts` vezes.
 *
 * Apenas P2002 em `enrollmentCode` e retentado — qualquer outro erro
 * (incluindo P2002 em outro campo, como cpfHash) propaga normalmente.
 */
export async function withEnrollmentCodeRetry<T>(
  handler: () => Promise<T>,
  maxAttempts = 5,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await handler();
    } catch (error) {
      if (isEnrollmentCodeConflict(error)) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }
  throw lastError ?? new Error('enrollment_code_conflict_max_retries');
}

export function isEnrollmentCodeConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== 'P2002') return false;
  const target = (error.meta as { target?: string[] | string } | undefined)?.target;
  if (Array.isArray(target)) return target.includes('enrollmentCode');
  if (typeof target === 'string') return target.includes('enrollmentCode');
  return false;
}
