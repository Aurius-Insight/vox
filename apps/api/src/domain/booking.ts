export type BookingCheck =
  | { ok: true }
  | {
      ok: false;
      reason: 'no_credit' | 'class_full' | 'already_booked' | 'class_started' | 'time_conflict';
    };

export type CancelCheck =
  | { ok: true }
  | { ok: false; reason: 'not_booked' | 'class_started' };

/**
 * Regra de agendamento de aula regular pelo aluno, isolada do banco.
 *
 * - Aula que ja comecou nao aceita novo agendamento.
 * - Aluno nao pode agendar a mesma aula duas vezes.
 * - Aluno nao pode ter duas aulas no mesmo horario (overlap entre `startsAt`
 *   e `endsAt` de qualquer agendamento ativo). O caller calcula `hasOverlap`
 *   consultando o banco; aqui ele entra como entrada pura.
 * - Aula cheia nao aceita novo agendamento.
 * - Aluno sem saldo nao pode agendar aula regular (o credito so e consumido
 *   na presenca, mas o saldo precisa existir no agendamento).
 */
export function canBookClass(input: {
  creditBalance: number;
  bookedCount: number;
  capacity: number;
  isBooked: boolean;
  hasOverlap: boolean;
  startsAt: Date;
  now?: Date;
}): BookingCheck {
  const now = input.now ?? new Date();

  if (input.startsAt <= now) return { ok: false, reason: 'class_started' };
  if (input.isBooked) return { ok: false, reason: 'already_booked' };
  if (input.hasOverlap) return { ok: false, reason: 'time_conflict' };
  if (input.bookedCount >= input.capacity) return { ok: false, reason: 'class_full' };
  if (input.creditBalance <= 0) return { ok: false, reason: 'no_credit' };

  return { ok: true };
}

/**
 * Regra de cancelamento de agendamento pelo aluno regular.
 *
 * - So e possivel cancelar um agendamento ativo.
 * - Nao e possivel cancelar uma aula que ja comecou.
 *
 * A "janela de cancelamento tardio" (ex.: bloquear X minutos antes) foi
 * explicitamente adiada para fase futura na reuniao de validacao.
 */
export function canCancelBooking(input: {
  hasActiveBooking: boolean;
  startsAt: Date;
  now?: Date;
}): CancelCheck {
  const now = input.now ?? new Date();

  if (!input.hasActiveBooking) return { ok: false, reason: 'not_booked' };
  if (input.startsAt <= now) return { ok: false, reason: 'class_started' };

  return { ok: true };
}
