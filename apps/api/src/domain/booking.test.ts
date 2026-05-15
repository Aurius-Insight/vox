import { describe, expect, it } from 'vitest';
import { canBookClass, canCancelBooking } from './booking.js';

const future = new Date('2026-06-01T12:00:00.000Z');
const past = new Date('2026-01-01T12:00:00.000Z');
const now = new Date('2026-05-14T12:00:00.000Z');

// Base "boa" — testes individuais sobrescrevem so o campo de interesse.
const baseOk = {
  creditBalance: 2,
  bookedCount: 3,
  capacity: 12,
  isBooked: false,
  hasOverlap: false,
  startsAt: future,
  now,
};

describe('canBookClass', () => {
  it('permite agendar quando ha saldo, vaga e a aula esta no futuro', () => {
    expect(canBookClass(baseOk)).toEqual({ ok: true });
  });

  it('bloqueia aula que ja comecou', () => {
    expect(canBookClass({ ...baseOk, startsAt: past })).toEqual({
      ok: false,
      reason: 'class_started',
    });
  });

  it('bloqueia agendamento duplicado', () => {
    expect(canBookClass({ ...baseOk, isBooked: true })).toEqual({
      ok: false,
      reason: 'already_booked',
    });
  });

  it('bloqueia quando ha aula com horario sobreposto', () => {
    expect(canBookClass({ ...baseOk, hasOverlap: true })).toEqual({
      ok: false,
      reason: 'time_conflict',
    });
  });

  it('bloqueia aula cheia', () => {
    expect(canBookClass({ ...baseOk, bookedCount: 12 })).toEqual({
      ok: false,
      reason: 'class_full',
    });
  });

  it('bloqueia aluno sem saldo', () => {
    expect(canBookClass({ ...baseOk, creditBalance: 0 })).toEqual({
      ok: false,
      reason: 'no_credit',
    });
  });

  it('aula iniciada tem prioridade sobre os demais bloqueios', () => {
    expect(
      canBookClass({
        ...baseOk,
        startsAt: past,
        isBooked: true,
        hasOverlap: true,
        bookedCount: 12,
        creditBalance: 0,
      }),
    ).toEqual({ ok: false, reason: 'class_started' });
  });

  it('overlap tem prioridade sobre vaga cheia e saldo zero', () => {
    expect(
      canBookClass({
        ...baseOk,
        hasOverlap: true,
        bookedCount: 12,
        creditBalance: 0,
      }),
    ).toEqual({ ok: false, reason: 'time_conflict' });
  });
});

describe('canCancelBooking', () => {
  it('permite cancelar agendamento ativo de aula futura', () => {
    expect(canCancelBooking({ hasActiveBooking: true, startsAt: future, now })).toEqual({
      ok: true,
    });
  });

  it('bloqueia cancelamento sem agendamento ativo', () => {
    expect(canCancelBooking({ hasActiveBooking: false, startsAt: future, now })).toEqual({
      ok: false,
      reason: 'not_booked',
    });
  });

  it('bloqueia cancelamento de aula que ja comecou', () => {
    expect(canCancelBooking({ hasActiveBooking: true, startsAt: past, now })).toEqual({
      ok: false,
      reason: 'class_started',
    });
  });
});
