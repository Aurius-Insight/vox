import { prisma } from '../../db/client.js';

// Visao de professores no dashboard: contagem de ativos + ranking dos top
// professores no mes corrente (aulas dadas, alunos distintos, taxa de
// presenca das aulas deles).
export async function computeTeachers({ unitId }: { unitId?: string }) {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [activeCount, teachers] = await Promise.all([
    prisma.user.count({ where: { active: true, roles: { has: 'professor' } } }),
    prisma.user.findMany({
      where: {
        active: true,
        roles: { has: 'professor' },
        ...(unitId ? { unitId } : {}),
      },
      select: { id: true, name: true, subject: { select: { name: true } } },
    }),
  ]);

  // Aulas dadas + bookings + presencas por professor no mes corrente.
  const sessions = await prisma.classSession.findMany({
    where: {
      canceledAt: null,
      startsAt: { gte: startOfMonth },
      teacherUserId: { not: null },
      ...(unitId ? { unitId } : {}),
    },
    select: {
      teacherUserId: true,
      attendances: { select: { studentId: true, status: true } },
    },
  });

  type Acc = {
    classesGiven: number;
    presentes: number;
    noShows: number;
    students: Set<string>;
  };
  const byTeacher = new Map<string, Acc>();
  for (const s of sessions) {
    const t = s.teacherUserId!;
    const acc = byTeacher.get(t) ?? {
      classesGiven: 0,
      presentes: 0,
      noShows: 0,
      students: new Set<string>(),
    };
    acc.classesGiven += 1;
    for (const att of s.attendances) {
      acc.students.add(att.studentId);
      if (att.status === 'presente') acc.presentes += 1;
      else acc.noShows += 1;
    }
    byTeacher.set(t, acc);
  }

  const top = teachers
    .map((teacher) => {
      const acc = byTeacher.get(teacher.id);
      const classesGiven = acc?.classesGiven ?? 0;
      const presentes = acc?.presentes ?? 0;
      const noShows = acc?.noShows ?? 0;
      const total = presentes + noShows;
      return {
        id: teacher.id,
        name: teacher.name,
        subject: teacher.subject?.name ?? null,
        classesGiven,
        uniqueStudents: acc?.students.size ?? 0,
        attendanceRate: total === 0 ? 0 : Number(((presentes / total) * 100).toFixed(1)),
      };
    })
    .filter((row) => row.classesGiven > 0)
    .sort((a, b) => b.classesGiven - a.classesGiven)
    .slice(0, 8);

  return { activeCount, top };
}
