export type StudentSnapshot = {
  createdAt: Date;
};

export type LeadSnapshot = {
  createdAt: Date;
  campaign: string | null;
  source: string;
} | null;

export type BookingSnapshot = {
  id: string;
  createdAt: Date;
  canceledAt: Date | null;
  type: 'regular' | 'experimental';
  classLabel: string;
  classStartsAt: Date;
};

export type AttendanceSnapshot = {
  id: string;
  markedAt: Date;
  status: 'presente' | 'no_show';
  creditConsumed: boolean;
  classLabel: string;
  classStartsAt: Date;
};

export type RenewalSnapshot = {
  at: Date;
  packageName: string | null;
  classesAdded: number;
};

export type TimelineEvent =
  | { type: 'lead_created'; at: string; data: { campaign: string | null; source: string } }
  | { type: 'student_created'; at: string }
  | {
      type: 'booking_created';
      at: string;
      data: {
        bookingId: string;
        kind: 'regular' | 'experimental';
        classLabel: string;
        classStartsAt: string;
      };
    }
  | {
      type: 'booking_canceled';
      at: string;
      data: { bookingId: string; classLabel: string; classStartsAt: string };
    }
  | {
      type: 'attendance';
      at: string;
      data: {
        attendanceId: string;
        status: 'presente' | 'no_show';
        creditConsumed: boolean;
        classLabel: string;
        classStartsAt: string;
      };
    }
  | {
      type: 'package_renewed';
      at: string;
      data: { packageName: string | null; classesAdded: number };
    };

export type StudentKpis = {
  presenceRate: number;
  noShowRate: number;
  lifetimeClasses: number;
  daysSinceLastClass: number | null;
  nextClassAt: string | null;
  averageClassesPerMonth: number;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function computeStudentKpis(input: {
  now: Date;
  windowDays: number;
  attendancesInWindow: { markedAt: Date; status: 'presente' | 'no_show' }[];
  lastAttendanceAt: Date | null;
  lifetimePresentCount: number;
  nextBookingAt: Date | null;
}): StudentKpis {
  const total = input.attendancesInWindow.length;
  const presentes = input.attendancesInWindow.filter((a) => a.status === 'presente').length;
  const noShows = total - presentes;

  const presenceRate = total === 0 ? 0 : presentes / total;
  const noShowRate = total === 0 ? 0 : noShows / total;

  const daysSinceLastClass =
    input.lastAttendanceAt === null
      ? null
      : Math.floor((input.now.getTime() - input.lastAttendanceAt.getTime()) / MS_PER_DAY);

  const months = input.windowDays / 30;
  const averageClassesPerMonth = months === 0 ? 0 : presentes / months;

  return {
    presenceRate,
    noShowRate,
    lifetimeClasses: input.lifetimePresentCount,
    daysSinceLastClass,
    nextClassAt: input.nextBookingAt === null ? null : input.nextBookingAt.toISOString(),
    averageClassesPerMonth,
  };
}

export function buildStudentTimeline(input: {
  now: Date;
  student: StudentSnapshot;
  lead: LeadSnapshot;
  bookings: BookingSnapshot[];
  attendances: AttendanceSnapshot[];
  renewals: RenewalSnapshot[];
}): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  events.push({ type: 'student_created', at: input.student.createdAt.toISOString() });

  if (input.lead) {
    events.push({
      type: 'lead_created',
      at: input.lead.createdAt.toISOString(),
      data: { campaign: input.lead.campaign, source: input.lead.source },
    });
  }

  for (const booking of input.bookings) {
    events.push({
      type: 'booking_created',
      at: booking.createdAt.toISOString(),
      data: {
        bookingId: booking.id,
        kind: booking.type,
        classLabel: booking.classLabel,
        classStartsAt: booking.classStartsAt.toISOString(),
      },
    });

    if (booking.canceledAt !== null) {
      events.push({
        type: 'booking_canceled',
        at: booking.canceledAt.toISOString(),
        data: {
          bookingId: booking.id,
          classLabel: booking.classLabel,
          classStartsAt: booking.classStartsAt.toISOString(),
        },
      });
    }
  }

  for (const attendance of input.attendances) {
    events.push({
      type: 'attendance',
      at: attendance.markedAt.toISOString(),
      data: {
        attendanceId: attendance.id,
        status: attendance.status,
        creditConsumed: attendance.creditConsumed,
        classLabel: attendance.classLabel,
        classStartsAt: attendance.classStartsAt.toISOString(),
      },
    });
  }

  for (const renewal of input.renewals) {
    events.push({
      type: 'package_renewed',
      at: renewal.at.toISOString(),
      data: { packageName: renewal.packageName, classesAdded: renewal.classesAdded },
    });
  }

  return [...events].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}
