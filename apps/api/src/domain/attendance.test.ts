import { describe, expect, it } from 'vitest';
import { resolveAttendanceCredit } from './attendance.js';

describe('resolveAttendanceCredit', () => {
  it('consome 1 credito quando presenca e confirmada e ainda nao foi cobrada', () => {
    const result = resolveAttendanceCredit({
      status: 'presente',
      consumesCredit: true,
      alreadyConsumed: false,
      creditBalance: 3,
    });

    expect(result).toEqual({ ok: true, willConsume: true, creditDelta: -1 });
  });

  it('nao cobra de novo quando o credito ja foi consumido', () => {
    const result = resolveAttendanceCredit({
      status: 'presente',
      consumesCredit: true,
      alreadyConsumed: true,
      creditBalance: 0,
    });

    expect(result).toEqual({ ok: true, willConsume: true, creditDelta: 0 });
  });

  it('bloqueia presenca confirmada quando o aluno esta sem saldo', () => {
    const result = resolveAttendanceCredit({
      status: 'presente',
      consumesCredit: true,
      alreadyConsumed: false,
      creditBalance: 0,
    });

    expect(result).toEqual({ ok: false, reason: 'insufficient_credit' });
  });

  it('estorna o credito quando uma presenca confirmada vira no-show', () => {
    const result = resolveAttendanceCredit({
      status: 'no_show',
      consumesCredit: true,
      alreadyConsumed: true,
      creditBalance: 0,
    });

    expect(result).toEqual({ ok: true, willConsume: false, creditDelta: 1 });
  });

  it('no-show sem consumo previo nao mexe no saldo', () => {
    const result = resolveAttendanceCredit({
      status: 'no_show',
      consumesCredit: true,
      alreadyConsumed: false,
      creditBalance: 2,
    });

    expect(result).toEqual({ ok: true, willConsume: false, creditDelta: 0 });
  });

  it('aula experimental nao consome credito mesmo com presenca confirmada', () => {
    const result = resolveAttendanceCredit({
      status: 'presente',
      consumesCredit: false,
      alreadyConsumed: false,
      creditBalance: 0,
    });

    expect(result).toEqual({ ok: true, willConsume: false, creditDelta: 0 });
  });
});
