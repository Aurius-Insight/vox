export type ClassEditCheck =
  | { ok: true }
  | {
      ok: false;
      reason: 'class_canceled' | 'capacity_below_booked' | 'teacher_does_not_teach_subject';
    };

/**
 * Regra de edicao de aula, isolada do banco.
 *
 * - Aula cancelada nao aceita mais edicao.
 * - Nova capacidade nao pode ser menor que a quantidade ja agendada
 *   (seria um over-booking retroativo).
 * - Se nao for "professor convidado", o professor escolhido tem que
 *   lecionar a materia da aula.
 */
export function canEditClass(input: {
  canceledAt: Date | null;
  bookedCount: number;
  nextCapacity?: number;
  isGuest: boolean;
  classSubjectId: string | null;
  nextTeacher?: { subjectId: string | null } | null;
}): ClassEditCheck {
  if (input.canceledAt) return { ok: false, reason: 'class_canceled' };

  if (input.nextCapacity !== undefined && input.nextCapacity < input.bookedCount) {
    return { ok: false, reason: 'capacity_below_booked' };
  }

  if (!input.isGuest && input.nextTeacher) {
    if (!input.classSubjectId || input.nextTeacher.subjectId !== input.classSubjectId) {
      return { ok: false, reason: 'teacher_does_not_teach_subject' };
    }
  }

  return { ok: true };
}
