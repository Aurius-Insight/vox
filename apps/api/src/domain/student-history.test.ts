import { describe, expect, it } from 'vitest';
import {
  buildStudentTimeline,
  computeStudentKpis,
  type AttendanceSnapshot,
  type BookingSnapshot,
  type LeadSnapshot,
  type RenewalSnapshot,
  type StudentSnapshot,
} from './student-history.js';

const NOW = new Date('2026-05-25T12:00:00.000Z');

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

function daysFromNow(days: number): Date {
  return new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000);
}

const baseStudent: StudentSnapshot = { createdAt: daysAgo(120) };

describe('computeStudentKpis', () => {
  it('devolve zeros e nulls quando o aluno nao tem aulas nem agendamentos', () => {
    const kpis = computeStudentKpis({
      now: NOW,
      windowDays: 90,
      attendancesInWindow: [],
      lastAttendanceAt: null,
      lifetimePresentCount: 0,
      nextBookingAt: null,
    });

    expect(kpis).toEqual({
      presenceRate: 0,
      noShowRate: 0,
      lifetimeClasses: 0,
      daysSinceLastClass: null,
      nextClassAt: null,
      averageClassesPerMonth: 0,
    });
  });

  it('calcula presence/no-show rate com base nas presencas+no_shows da janela', () => {
    const attendances: { markedAt: Date; status: 'presente' | 'no_show' }[] = [
      { markedAt: daysAgo(1), status: 'presente' },
      { markedAt: daysAgo(5), status: 'presente' },
      { markedAt: daysAgo(10), status: 'presente' },
      { markedAt: daysAgo(20), status: 'no_show' },
    ];

    const kpis = computeStudentKpis({
      now: NOW,
      windowDays: 90,
      attendancesInWindow: attendances,
      lastAttendanceAt: daysAgo(1),
      lifetimePresentCount: 42,
      nextBookingAt: daysFromNow(2),
    });

    expect(kpis.presenceRate).toBeCloseTo(0.75, 5);
    expect(kpis.noShowRate).toBeCloseTo(0.25, 5);
    expect(kpis.lifetimeClasses).toBe(42);
    expect(kpis.daysSinceLastClass).toBe(1);
    expect(kpis.nextClassAt).toBe(daysFromNow(2).toISOString());
  });

  it('averageClassesPerMonth = presencas na janela / (windowDays/30)', () => {
    const attendances: { markedAt: Date; status: 'presente' | 'no_show' }[] = Array.from(
      { length: 12 },
      (_, i) => ({ markedAt: daysAgo(i * 7), status: 'presente' as const }),
    );

    const kpis = computeStudentKpis({
      now: NOW,
      windowDays: 90,
      attendancesInWindow: attendances,
      lastAttendanceAt: daysAgo(0),
      lifetimePresentCount: 12,
      nextBookingAt: null,
    });

    expect(kpis.averageClassesPerMonth).toBeCloseTo(4, 5);
  });

  it('daysSinceLastClass arredonda pra baixo (dias completos)', () => {
    const kpis = computeStudentKpis({
      now: NOW,
      windowDays: 90,
      attendancesInWindow: [],
      lastAttendanceAt: new Date(NOW.getTime() - 1.7 * 24 * 60 * 60 * 1000),
      lifetimePresentCount: 1,
      nextBookingAt: null,
    });

    expect(kpis.daysSinceLastClass).toBe(1);
  });
});

describe('buildStudentTimeline', () => {
  it('devolve apenas student_created quando o aluno e novinho e sem nada', () => {
    const timeline = buildStudentTimeline({
      now: NOW,
      student: { createdAt: daysAgo(2) },
      lead: null,
      bookings: [],
      attendances: [],
      renewals: [],
    });

    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({
      type: 'student_created',
      at: daysAgo(2).toISOString(),
    });
  });

  it('inclui lead_created antes de student_created quando ha lead', () => {
    const lead: LeadSnapshot = {
      createdAt: daysAgo(30),
      campaign: 'Outubro 2025',
      source: 'botconversa',
    };

    const timeline = buildStudentTimeline({
      now: NOW,
      student: { createdAt: daysAgo(20) },
      lead,
      bookings: [],
      attendances: [],
      renewals: [],
    });

    expect(timeline.map((e) => e.type)).toEqual(['student_created', 'lead_created']);
    expect(timeline[1]).toMatchObject({
      type: 'lead_created',
      data: { campaign: 'Outubro 2025', source: 'botconversa' },
    });
  });

  it('ordena eventos do mais novo pro mais antigo', () => {
    const bookings: BookingSnapshot[] = [
      {
        id: 'b1',
        createdAt: daysAgo(15),
        canceledAt: null,
        type: 'regular',
        classLabel: 'Piano',
        classStartsAt: daysAgo(10),
      },
    ];
    const attendances: AttendanceSnapshot[] = [
      {
        id: 'a1',
        markedAt: daysAgo(10),
        status: 'presente',
        creditConsumed: true,
        classLabel: 'Piano',
        classStartsAt: daysAgo(10),
      },
    ];

    const timeline = buildStudentTimeline({
      now: NOW,
      student: { createdAt: daysAgo(20) },
      lead: null,
      bookings,
      attendances,
      renewals: [],
    });

    const ats = timeline.map((e) => new Date(e.at).getTime());
    const sortedDesc = [...ats].sort((a, b) => b - a);
    expect(ats).toEqual(sortedDesc);
    expect(timeline.map((e) => e.type)).toEqual([
      'attendance',
      'booking_created',
      'student_created',
    ]);
  });

  it('emite booking_canceled apenas quando canceledAt nao e null', () => {
    const bookings: BookingSnapshot[] = [
      {
        id: 'b1',
        createdAt: daysAgo(10),
        canceledAt: daysAgo(5),
        type: 'regular',
        classLabel: 'Violao',
        classStartsAt: daysAgo(3),
      },
      {
        id: 'b2',
        createdAt: daysAgo(8),
        canceledAt: null,
        type: 'regular',
        classLabel: 'Violao',
        classStartsAt: daysFromNow(2),
      },
    ];

    const timeline = buildStudentTimeline({
      now: NOW,
      student: baseStudent,
      lead: null,
      bookings,
      attendances: [],
      renewals: [],
    });

    const types = timeline.map((e) => e.type);
    expect(types.filter((t) => t === 'booking_created')).toHaveLength(2);
    expect(types.filter((t) => t === 'booking_canceled')).toHaveLength(1);
  });

  it('inclui package_renewed com classesAdded vindo do AuditLog', () => {
    const renewals: RenewalSnapshot[] = [
      { at: daysAgo(60), packageName: 'Mensal 4 aulas', classesAdded: 4 },
      { at: daysAgo(30), packageName: 'Mensal 8 aulas', classesAdded: 8 },
    ];

    const timeline = buildStudentTimeline({
      now: NOW,
      student: baseStudent,
      lead: null,
      bookings: [],
      attendances: [],
      renewals,
    });

    const renewedEvents = timeline.filter((e) => e.type === 'package_renewed');
    expect(renewedEvents).toHaveLength(2);
    expect(renewedEvents[0]).toMatchObject({
      type: 'package_renewed',
      data: { packageName: 'Mensal 8 aulas', classesAdded: 8 },
    });
  });

  it('attendance carrega status e creditConsumed pra UI marcar visualmente', () => {
    const attendances: AttendanceSnapshot[] = [
      {
        id: 'a1',
        markedAt: daysAgo(5),
        status: 'no_show',
        creditConsumed: false,
        classLabel: 'Piano',
        classStartsAt: daysAgo(5),
      },
    ];

    const timeline = buildStudentTimeline({
      now: NOW,
      student: baseStudent,
      lead: null,
      bookings: [],
      attendances,
      renewals: [],
    });

    const event = timeline.find((e) => e.type === 'attendance');
    expect(event).toMatchObject({
      type: 'attendance',
      data: { status: 'no_show', creditConsumed: false, classLabel: 'Piano' },
    });
  });
});
