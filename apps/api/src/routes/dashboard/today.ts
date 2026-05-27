import { prisma } from '../../db/client.js';

// Painel "Hoje" do dashboard: visao operacional do dia corrente.
//  - sessionsCount: aulas com startsAt no dia (nao canceladas).
//  - expectedStudents: somatoria de bookings ativos nessas aulas.
//  - teachersScheduled: professores distintos escalados pra hoje.
//  - confirmationsPending: aulas que ja terminaram e ainda nao tiveram
//    a presenca marcada (Attendance < bookings).
export async function computeToday({ unitId }: { unitId?: string }) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const now = new Date();

  const where = {
    canceledAt: null,
    startsAt: { gte: start, lt: end },
    ...(unitId ? { unitId } : {}),
  };

  const todaysSessions = await prisma.classSession.findMany({
    where,
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      teacherUserId: true,
      bookings: { where: { status: 'agendado' }, select: { id: true } },
      attendances: { select: { id: true } },
    },
  });

  const sessionsCount = todaysSessions.length;
  const expectedStudents = todaysSessions.reduce((sum, s) => sum + s.bookings.length, 0);
  const teacherIds = new Set(
    todaysSessions
      .map((s) => s.teacherUserId)
      .filter((id): id is string => id !== null),
  );

  const confirmationsPending = todaysSessions.filter(
    (s) => s.endsAt < now && s.bookings.length > 0 && s.attendances.length < s.bookings.length,
  ).length;

  return {
    sessionsCount,
    expectedStudents,
    teachersScheduled: teacherIds.size,
    confirmationsPending,
  };
}
