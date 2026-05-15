import { describe, expect, it } from 'vitest';
import { canBookClass, canCancelBooking } from './booking.js';

const future = new Date('2026-06-01T12:00:00.000Z');
const past = new Date('2026-01-01T12:00:00.000Z');
const now = new Date('2026-05-14T12:00:00.000Z');

describe('canBookClass', () => {
  it('permite agendar quando ha saldo, vaga e a aula esta no futuro', () => {
    expect(
      canBookClass({
        creditBalance: 2,
        bookedCount: 3,
        capacity: 12,
        isBooked: false,
        startsAt: future,
        now,
      }),
    ).toEqual({ ok: true });
  });

  it('bloqueia aula que ja comecou', () => {
    expect(
      canBookClass({
        creditBalance: 2,
        bookedCount: 0,
        capacity: 12,
        isBooked: false,
        startsAt: past,
        now,
      }),
    ).toEqual({ ok: false, reason: 'class_started' });
  });

  it('bloqueia agendamento duplicado', () => {
    expect(
      canBookClass({
        creditBalance: 2,
        bookedCount: 5,
        capacity: 12,
        isBooked: true,
        startsAt: future,
        now,
      }),
    ).toEqual({ ok: false, reason: 'already_booked' });
  });

  it('bloqueia aula cheia', () => {
    expect(
      canBookClass({
        creditBalance: 2,
        bookedCount: 12,
        capacity: 12,
        isBooked: false,
        startsAt: future,
        now,
      }),
    ).toEqual({ ok: false, reason: 'class_full' });
  });

  it('bloqueia aluno sem saldo', () => {
    expect(
      canBookClass({
        creditBalance: 0,
        bookedCount: 1,
        capacity: 12,
        isBooked: false,
        startsAt: future,
        now,
      }),
    ).toEqual({ ok: false, reason: 'no_credit' });
  });

  it('aula iniciada tem prioridade sobre os demais bloqueios', () => {
    expect(
      canBookClass({
        creditBalance: 0,
        bookedCount: 12,
        capacity: 12,
        isBooked: true,
        startsAt: past,
        now,
      }),
    ).toEqual({ ok: false, reason: 'class_started' });
  });
});

describe('canCancelBooking', () => {
  it('permite cancelar agendamento ativo de aula futura', () => {
    expect(canCancelBooking({ hasActiveBooking: true, startsAt: future, now })).toEqual({ ok: true });
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
