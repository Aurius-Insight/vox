import { prisma } from '../../db/client.js';
import type { Prisma } from '@prisma/client';

// Tendencias temporais (ultimos 30 dias):
//  - leadsByDay: novos Leads criados em cada dia.
//  - salesByDay: matriculas (entradas em LeadStage kind='won') em cada dia.
//  - attendanceByDay: presencas marcadas (status='presente') em cada dia.
//  - velocity: tempo medio entre Lead.createdAt e a virada pra Student
//    (proxy: Student.createdAt quando o Student esta vinculado ao Lead).
//
// Buckets por dia local — JS Date no fuso do server. Pra MVP serve;
// se precisar de timezones explicitos, mover pra date-fns-tz.
export async function computeTrends({
  unitId,
  leadWhere,
}: {
  unitId?: string;
  leadWhere: Prisma.LeadWhereInput;
}) {
  const days = 30;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));

  const classRelationFilter = unitId ? { classSession: { unitId } } : {};

  const [leads, sales, attendances, velocityRows] = await Promise.all([
    prisma.lead.findMany({
      where: { ...leadWhere, createdAt: { gte: start } },
      select: { createdAt: true },
    }),
    prisma.student.findMany({
      where: {
        active: true,
        type: 'matriculado',
        createdAt: { gte: start },
        ...(unitId ? { unitId } : {}),
      },
      select: { createdAt: true },
    }),
    prisma.attendance.findMany({
      where: {
        status: 'presente',
        markedAt: { gte: start },
        ...classRelationFilter,
      },
      select: { markedAt: true },
    }),
    // Velocidade lead→matricula: alunos matriculados nos ultimos 90 dias
    // com lead vinculado. Calcula media simples (sample limitado a 500).
    prisma.student.findMany({
      where: {
        type: 'matriculado',
        leadId: { not: null },
        createdAt: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
      },
      select: { createdAt: true, lead: { select: { createdAt: true } } },
      take: 500,
    }),
  ]);

  const series = buildSeries(start, days);

  for (const row of leads) {
    increment(series, row.createdAt, 'leads');
  }
  for (const row of sales) {
    increment(series, row.createdAt, 'sales');
  }
  for (const row of attendances) {
    increment(series, row.markedAt, 'attendance');
  }

  const totalDays = velocityRows.reduce((sum, row) => {
    if (!row.lead) return sum;
    const diffMs = row.createdAt.getTime() - row.lead.createdAt.getTime();
    return sum + diffMs / (1000 * 60 * 60 * 24);
  }, 0);
  const velocity = {
    sampleSize: velocityRows.filter((r) => r.lead).length,
    avgDaysLeadToEnrolled:
      velocityRows.length === 0 ? 0 : Number((totalDays / velocityRows.length).toFixed(1)),
  };

  return { series, velocity };
}

type Series = Array<{ date: string; leads: number; sales: number; attendance: number }>;

function buildSeries(start: Date, days: number): Series {
  const out: Series = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    out.push({ date: d.toISOString().slice(0, 10), leads: 0, sales: 0, attendance: 0 });
  }
  return out;
}

function increment(series: Series, when: Date, key: 'leads' | 'sales' | 'attendance') {
  const iso = new Date(
    when.getFullYear(),
    when.getMonth(),
    when.getDate(),
  )
    .toISOString()
    .slice(0, 10);
  const bucket = series.find((b) => b.date === iso);
  if (bucket) bucket[key] += 1;
}
