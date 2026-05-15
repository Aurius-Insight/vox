import { describe, expect, it } from 'vitest';
import { canEditClass } from './class.js';

const base = {
  canceledAt: null,
  bookedCount: 3,
  isGuest: false,
  classSubjectId: 'subj_x',
};

describe('canEditClass', () => {
  it('libera edicao trivial em aula ativa', () => {
    expect(canEditClass(base)).toEqual({ ok: true });
  });

  it('bloqueia edicao em aula ja cancelada', () => {
    expect(canEditClass({ ...base, canceledAt: new Date() })).toEqual({
      ok: false,
      reason: 'class_canceled',
    });
  });

  it('bloqueia capacidade menor que a quantidade ja agendada', () => {
    expect(canEditClass({ ...base, bookedCount: 10, nextCapacity: 8 })).toEqual({
      ok: false,
      reason: 'capacity_below_booked',
    });
  });

  it('libera capacidade igual a quantidade agendada', () => {
    expect(canEditClass({ ...base, bookedCount: 10, nextCapacity: 10 })).toEqual({ ok: true });
  });

  it('bloqueia trocar para professor que nao leciona a materia', () => {
    expect(
      canEditClass({ ...base, nextTeacher: { subjectId: 'subj_y' } }),
    ).toEqual({ ok: false, reason: 'teacher_does_not_teach_subject' });
  });

  it('libera trocar para professor que leciona a mesma materia', () => {
    expect(
      canEditClass({ ...base, nextTeacher: { subjectId: 'subj_x' } }),
    ).toEqual({ ok: true });
  });

  it('aula com professor convidado ignora regra de materia', () => {
    expect(
      canEditClass({
        ...base,
        isGuest: true,
        classSubjectId: null,
        nextTeacher: { subjectId: 'subj_x' },
      }),
    ).toEqual({ ok: true });
  });

  it('cancelamento tem prioridade sobre outras checagens', () => {
    expect(
      canEditClass({
        canceledAt: new Date(),
        bookedCount: 99,
        nextCapacity: 1,
        isGuest: false,
        classSubjectId: 'subj_x',
        nextTeacher: { subjectId: 'subj_y' },
      }),
    ).toEqual({ ok: false, reason: 'class_canceled' });
  });
});
