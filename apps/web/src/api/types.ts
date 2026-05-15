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
  room: string;
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

export type Lead = {
  id: string;
  name: string;
  whatsapp: string;
  unitInterest: string;
  campaign?: string;
  source: string;
  stage: LeadStage;
};

export type StudentSummary = {
  id: string;
  name: string;
  enrollmentCode: string;
  whatsapp: string;
  cpf?: string;
  unitId: string | null;
  unitName: string | null;
  packageName: string;
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

export type Unit = {
  id: string;
  name: string;
  address: string;
  rooms: number;
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
