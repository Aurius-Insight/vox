import type { Role } from '../auth/AuthProvider';

export const ROLE_VALUES: Role[] = ['diretor', 'coordenacao', 'professor'];

export const ROLE_LABELS: Record<Role, string> = {
  diretor: 'Diretor',
  coordenacao: 'Coordenacao',
  professor: 'Professor',
};

export type Subject = {
  id: string;
  name: string;
};

export type UnitRef = {
  id: string;
  name: string;
};

export type AppUser = {
  id: string;
  name: string;
  email: string;
  roles: Role[];
  active: boolean;
  subjectId: string | null;
  subject: Subject | null;
  unitId: string | null;
  unit: UnitRef | null;
  createdAt: string;
};

export type ClassStudent = {
  id: string;
  name: string;
  whatsapp: string;
  enrollmentCode: string;
  creditBalance: number;
  bookingType: string;
};

export type ClassSession = {
  id: string;
  subjectId: string | null;
  subjectName: string | null;
  isGuest: boolean;
  displayName: string;
  unitId: string | null;
  unitName: string | null;
  teacherUserId: string | null;
  teacherName: string | null;
  startsAt: string;
  endsAt: string;
  capacity: number;
  bookedCount: number;
  bookedStudents: ClassStudent[];
};

export type LeadStage =
  | 'novo_lead'
  | 'em_atendimento'
  | 'pre_agendamento'
  | 'experimental_agendada'
  | 'matriculado'
  | 'perdido';

// Ordem e labels DEFAULT — fallback quando o `/api/stages` ainda nao
// carregou ou em telas que nao usam config dinamica (selects auxiliares).
// Em runtime, a `StageConfig` do servidor sobreescreve.
export const LEAD_STAGES: LeadStage[] = [
  'novo_lead',
  'em_atendimento',
  'pre_agendamento',
  'experimental_agendada',
  'matriculado',
  'perdido',
];

export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  novo_lead: 'Novo lead',
  em_atendimento: 'Em atendimento',
  pre_agendamento: 'Pre-agendamento',
  experimental_agendada: 'Experimental agendada',
  matriculado: 'Matriculado',
  perdido: 'Perdido',
};

export type LeadStageKind = 'active' | 'won' | 'lost';

// Etapa do pipeline (CRUD completo via UI quando user e diretor). O `slug`
// e estavel pros sistemicos (`novo_lead`, `matriculado`…) e gerado a partir
// do label pros custom criados pelo operador.
export type StageConfig = {
  id: string;
  slug: string;
  label: string;
  color: string | null;
  order: number;
  kind: LeadStageKind;
  systemic: boolean;
  archived: boolean;
  visible: boolean;
};

export type Lead = {
  id: string;
  name: string;
  whatsapp: string;
  unitInterest: string;
  campaign?: string;
  source: string;
  /** Slug da etapa atual. Pode ser sistemico (LeadStage) ou custom. */
  stage: string;
  /** ISO string. Quando o lead entrou no funil — usado pra exibir idade. */
  createdAt?: string;
};

export type StudentType = 'experimental' | 'matriculado';

export type StudentSummary = {
  id: string;
  name: string;
  type: StudentType;
  enrollmentCode: string;
  whatsapp: string;
  cpf?: string;
  unitId: string | null;
  unitName: string | null;
  packageName: string | null;
  creditBalance: number;
  status: string;
};

export type StudentBooking = {
  id: string;
  status: string;
  type: string;
  classLabel: string;
  unit: string | null;
  startsAt: string;
};

export type StudentAttendance = {
  id: string;
  status: string;
  creditConsumed: boolean;
  classLabel: string;
  startsAt: string;
  markedAt: string;
};

export type StudentOrigin = {
  campaign?: string;
  source: string;
  stage: LeadStage;
};

export type StudentDetail = StudentSummary & {
  email?: string;
  origin?: StudentOrigin;
  bookings: StudentBooking[];
  attendances: StudentAttendance[];
};

export type StudentKpis = {
  presenceRate: number;
  noShowRate: number;
  lifetimeClasses: number;
  daysSinceLastClass: number | null;
  nextClassAt: string | null;
  averageClassesPerMonth: number;
};

export type StudentTimelineEvent =
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

export type StudentHistory = {
  windowDays: number;
  since: string;
  kpis: StudentKpis;
  timeline: StudentTimelineEvent[];
};

export type TeacherKpis = {
  classesTaught: number;
  uniqueStudents: number;
  presenceRate: number;
  noShowRate: number;
  averagePunctualityHours: number | null;
  nextClassAt: string | null;
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
      data: { sessionId: string; subject: string | null; unit: string | null };
    };

export type TeachingHistory = {
  teacher: AppUser;
  windowDays: number;
  since: string;
  kpis: TeacherKpis;
  timeline: TeacherTimelineEvent[];
};

export type Unit = {
  id: string;
  name: string;
  address: string;
  phone: string | null;
  capacity: number;
  active: boolean;
};

export type Package = {
  id: string;
  name: string;
  classCount: number;
  priceCents: number;
  validityDays: number;
  active: boolean;
  effectiveFrom: string;
};

export type DashboardData = {
  unitId: string;
  availableUnits: UnitRef[];
  leads: {
    total: number;
    byStage: Array<{ stage: LeadStage; count: number }>;
    byCampaign: Array<{ campaign: string; count: number }>;
  };
  sales: {
    enrolled: number;
    conversionRate: number;
  };
  classes: {
    occupancy: number;
    experimentalBookings: number;
    consumedThisMonth: number;
  };
  students: {
    total: number;
    active: number;
    withoutBalance: number;
  };
  attendance: {
    rate: number;
  };
};
