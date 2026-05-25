export type ClassSessionSnapshot = {
  id: string;
  subjectName: string | null;
  unitName: string | null;
  startsAt: Date;
  endsAt: Date;
  canceledAt: Date | null;
  capacity: number;
};

export type TeacherAttendanceSnapshot = {
  studentId: string;
  sessionId?: string;
  status: 'presente' | 'no_show';
  markedAt: Date;
};

export type PunctualityDelay = {
  markedAt: Date;
  sessionEndsAt: Date;
};

export type TeacherTimelineEvent =
  | {
      type: 'class_taught';
      at: string;
      data: {
        sessionId: string;
        subject: string | null;
        unit: string | null;
        capacity: number;
        present: number;
        noShow: number;
      };
    }
  | {
      type: 'class_canceled';
      at: string;
      data: {
        sessionId: string;
        subject: string | null;
        unit: string | null;
      };
    };

export type TeacherKpis = {
  classesTaught: number;
  uniqueStudents: number;
  presenceRate: number;
  noShowRate: number;
  averagePunctualityHours: number | null;
  nextClassAt: string | null;
};

const MS_PER_HOUR = 60 * 60 * 1000;

export function computeTeacherKpis(input: {
  now: Date;
  windowDays: number;
  sessionsInWindow: ClassSessionSnapshot[];
  attendancesInWindow: TeacherAttendanceSnapshot[];
  punctualityDelays: PunctualityDelay[];
  nextSessionAt: Date | null;
}): TeacherKpis {
  const classesTaught = input.sessionsInWindow.filter(
    (session) => session.canceledAt === null && session.startsAt.getTime() <= input.now.getTime(),
  ).length;

  const studentIds = new Set(input.attendancesInWindow.map((a) => a.studentId));

  const total = input.attendancesInWindow.length;
  const presentes = input.attendancesInWindow.filter((a) => a.status === 'presente').length;
  const noShows = total - presentes;

  const presenceRate = total === 0 ? 0 : presentes / total;
  const noShowRate = total === 0 ? 0 : noShows / total;

  let averagePunctualityHours: number | null = null;
  if (input.punctualityDelays.length > 0) {
    const totalHours = input.punctualityDelays.reduce(
      (sum, d) => sum + (d.markedAt.getTime() - d.sessionEndsAt.getTime()) / MS_PER_HOUR,
      0,
    );
    averagePunctualityHours = totalHours / input.punctualityDelays.length;
  }

  return {
    classesTaught,
    uniqueStudents: studentIds.size,
    presenceRate,
    noShowRate,
    averagePunctualityHours,
    nextClassAt: input.nextSessionAt === null ? null : input.nextSessionAt.toISOString(),
  };
}

export function buildTeacherTimeline(input: {
  now: Date;
  sessions: ClassSessionSnapshot[];
  attendancesBySession: TeacherAttendanceSnapshot[];
}): TeacherTimelineEvent[] {
  const events: TeacherTimelineEvent[] = [];

  for (const session of input.sessions) {
    if (session.canceledAt !== null) {
      events.push({
        type: 'class_canceled',
        at: session.canceledAt.toISOString(),
        data: {
          sessionId: session.id,
          subject: session.subjectName,
          unit: session.unitName,
        },
      });
      continue;
    }

    // Aula futura ainda nao gera evento na timeline — so quando acontece.
    if (session.startsAt.getTime() > input.now.getTime()) continue;

    const attendances = input.attendancesBySession.filter((a) => a.sessionId === session.id);
    const present = attendances.filter((a) => a.status === 'presente').length;
    const noShow = attendances.filter((a) => a.status === 'no_show').length;

    events.push({
      type: 'class_taught',
      at: session.startsAt.toISOString(),
      data: {
        sessionId: session.id,
        subject: session.subjectName,
        unit: session.unitName,
        capacity: session.capacity,
        present,
        noShow,
      },
    });
  }

  return [...events].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}
