export type AttendanceStatus = 'presente' | 'no_show';

export type CreditResolution =
  | { ok: true; willConsume: boolean; creditDelta: number }
  | { ok: false; reason: 'insufficient_credit' };

/**
 * Regra de credito da presenca, isolada do banco para ser testavel.
 *
 * - Presenca confirmada em aula que consome credito gasta 1 credito.
 * - No-show nao consome credito no MVP.
 * - Corrigir presente -> no-show estorna o credito ja consumido.
 * - Aluno sem saldo nao pode ter presenca confirmada que ainda nao foi cobrada.
 */
export function resolveAttendanceCredit(input: {
  status: AttendanceStatus;
  consumesCredit: boolean;
  alreadyConsumed: boolean;
  creditBalance: number;
}): CreditResolution {
  const willConsume = input.status === 'presente' && input.consumesCredit;

  if (willConsume && !input.alreadyConsumed && input.creditBalance <= 0) {
    return { ok: false, reason: 'insufficient_credit' };
  }

  let creditDelta = 0;
  if (willConsume && !input.alreadyConsumed) creditDelta = -1;
  if (!willConsume && input.alreadyConsumed) creditDelta = 1;

  return { ok: true, willConsume, creditDelta };
}
