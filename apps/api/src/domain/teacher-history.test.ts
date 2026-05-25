import { describe, expect, it } from 'vitest';
import {
  buildTeacherTimeline,
  computeTeacherKpis,
  type ClassSessionSnapshot,
  type TeacherAttendanceSnapshot,
} from './teacher-history.js';

const NOW = new Date('2026-05-25T12:00:00.000Z');

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000);
}

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

function daysFromNow(days: number): Date {
  return new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000);
}

describe('computeTeacherKpis', () => {
  it('devolve zeros e nulls quando o professor nao tem aulas nem presencas', () => {
    const kpis = computeTeacherKpis({
      now: NOW,
      windowDays: 90,
      sessionsInWindow: [],
      attendancesInWindow: [],
      punctualityDelays: [],
      nextSessionAt: null,
    });

    expect(kpis).toEqual({
      classesTaught: 0,
      uniqueStudents: 0,
      presenceRate: 0,
      noShowRate: 0,
      averagePunctualityHours: null,
      nextClassAt: null,
    });
  });

  it('conta apenas aulas ja realizadas (passadas e nao canceladas)', () => {
    const sessions: ClassSessionSnapshot[] = [
      {
        id: 's1',
        subjectName: 'Piano',
        unitName: 'Centro',
        startsAt: daysAgo(5),
        endsAt: daysAgo(5),
        canceledAt: null,
        capacity: 4,
      },
      // futura — nao conta como "ja dada"
      {
        id: 's2',
        subjectName: 'Piano',
        unitName: 'Centro',
        startsAt: daysFromNow(2),
        endsAt: daysFromNow(2),
        canceledAt: null,
        capacity: 4,
      },
      // cancelada — nao conta
      {
        id: 's3',
        subjectName: 'Piano',
        unitName: 'Centro',
        startsAt: daysAgo(3),
        endsAt: daysAgo(3),
        canceledAt: daysAgo(4),
        capacity: 4,
      },
    ];

    const kpis = computeTeacherKpis({
      now: NOW,
      windowDays: 90,
      sessionsInWindow: sessions,
      attendancesInWindow: [],
      punctualityDelays: [],
      nextSessionAt: daysFromNow(2),
    });

    expect(kpis.classesTaught).toBe(1);
    expect(kpis.nextClassAt).toBe(daysFromNow(2).toISOString());
  });

  it('calcula taxa de presenca e no-show das turmas do professor', () => {
    const attendances: TeacherAttendanceSnapshot[] = [
      { studentId: 'a', status: 'presente', markedAt: daysAgo(1) },
      { studentId: 'b', status: 'presente', markedAt: daysAgo(1) },
      { studentId: 'c', status: 'presente', markedAt: daysAgo(2) },
      { studentId: 'd', status: 'no_show', markedAt: daysAgo(2) },
    ];

    const kpis = computeTeacherKpis({
      now: NOW,
      windowDays: 30,
      sessionsInWindow: [],
      attendancesInWindow: attendances,
      punctualityDelays: [],
      nextSessionAt: null,
    });

    expect(kpis.presenceRate).toBeCloseTo(0.75, 5);
    expect(kpis.noShowRate).toBeCloseTo(0.25, 5);
    expect(kpis.uniqueStudents).toBe(4);
  });

  it('alunos unicos sao deduplicados quando o mesmo aluno aparece em varias presencas', () => {
    const attendances: TeacherAttendanceSnapshot[] = [
      { studentId: 'a', status: 'presente', markedAt: daysAgo(1) },
      { studentId: 'a', status: 'presente', markedAt: daysAgo(5) },
      { studentId: 'b', status: 'presente', markedAt: daysAgo(2) },
    ];

    const kpis = computeTeacherKpis({
      now: NOW,
      windowDays: 30,
      sessionsInWindow: [],
      attendancesInWindow: attendances,
      punctualityDelays: [],
      nextSessionAt: null,
    });

    expect(kpis.uniqueStudents).toBe(2);
  });

  it('averagePunctualityHours = media de (markedAt - endsAt) em horas; null se sem dados', () => {
    const kpis = computeTeacherKpis({
      now: NOW,
      windowDays: 30,
      sessionsInWindow: [],
      attendancesInWindow: [],
      punctualityDelays: [
        { markedAt: hoursAgo(1), sessionEndsAt: hoursAgo(3) },
        { markedAt: hoursAgo(2), sessionEndsAt: hoursAgo(4) },
      ],
      nextSessionAt: null,
    });

    expect(kpis.averagePunctualityHours).toBeCloseTo(2, 5);
  });
});

describe('buildTeacherTimeline', () => {
  it('emite class_taught para aulas passadas com summary de presencas', () => {
    const sessions: ClassSessionSnapshot[] = [
      {
        id: 's1',
        subjectName: 'Piano',
        unitName: 'Centro',
        startsAt: daysAgo(5),
        endsAt: daysAgo(5),
        canceledAt: null,
        capacity: 4,
      },
    ];
    const attendances: TeacherAttendanceSnapshot[] = [
      { studentId: 'a', sessionId: 's1', status: 'presente', markedAt: daysAgo(5) },
      { studentId: 'b', sessionId: 's1', status: 'presente', markedAt: daysAgo(5) },
      { studentId: 'c', sessionId: 's1', status: 'no_show', markedAt: daysAgo(5) },
    ];

    const timeline = buildTeacherTimeline({
      now: NOW,
      sessions,
      attendancesBySession: attendances,
    });

    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({
      type: 'class_taught',
      data: {
        sessionId: 's1',
        subject: 'Piano',
        unit: 'Centro',
        present: 2,
        noShow: 1,
        capacity: 4,
      },
    });
  });

  it('emite class_canceled para aulas com canceledAt e ignora futuras nao realizadas', () => {
    const sessions: ClassSessionSnapshot[] = [
      {
        id: 's1',
        subjectName: 'Piano',
        unitName: 'Centro',
        startsAt: daysAgo(3),
        endsAt: daysAgo(3),
        canceledAt: daysAgo(4),
        capacity: 4,
      },
      // futura — nao gera evento (nao aconteceu nem foi cancelada)
      {
        id: 's2',
        subjectName: 'Piano',
        unitName: 'Centro',
        startsAt: daysFromNow(2),
        endsAt: daysFromNow(2),
        canceledAt: null,
        capacity: 4,
      },
    ];

    const timeline = buildTeacherTimeline({
      now: NOW,
      sessions,
      attendancesBySession: [],
    });

    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({ type: 'class_canceled', data: { sessionId: 's1' } });
  });

  it('ordena timeline do mais novo pro mais antigo', () => {
    const sessions: ClassSessionSnapshot[] = [
      {
        id: 's-old',
        subjectName: 'Piano',
        unitName: 'Centro',
        startsAt: daysAgo(20),
        endsAt: daysAgo(20),
        canceledAt: null,
        capacity: 4,
      },
      {
        id: 's-new',
        subjectName: 'Piano',
        unitName: 'Centro',
        startsAt: daysAgo(2),
        endsAt: daysAgo(2),
        canceledAt: null,
        capacity: 4,
      },
    ];

    const timeline = buildTeacherTimeline({
      now: NOW,
      sessions,
      attendancesBySession: [],
    });

    expect(timeline.map((e) => e.data.sessionId)).toEqual(['s-new', 's-old']);
  });
});
