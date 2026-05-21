import { PrismaClient, type Role } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import dotenv from 'dotenv';
import path from 'node:path';
import { Pool } from 'pg';

dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config();

// Em Supabase usa-se DIRECT_URL (porta 5432) para seed/migrations — o pooler
// (PgBouncer transaction mode) nao suporta tudo que o Prisma faz aqui.
const pool = new Pool({
  connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
});

const prisma = new PrismaClient({
  adapter: new PrismaPg(pool),
});

function cpfHash(cpf: string) {
  const digits = cpf.replace(/\D/g, '');
  return createHash('sha256')
    .update(`${process.env.SESSION_SECRET ?? 'dev'}:${digits}`)
    .digest('hex');
}

function resolveAdminPassword(): string {
  const fromEnv = process.env.ADMIN_PASSWORD;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('ADMIN_PASSWORD obrigatorio em producao para rodar o seed.');
  }
  // Fallback so em dev/test, para facilitar o setup local.
  return 'admin-dev-password';
}

async function main() {
  const adminPassword = resolveAdminPassword();
  const adminEmail = (process.env.ADMIN_EMAIL ?? 'admin@voxrj.com').toLowerCase();
  const passwordHash = await bcrypt.hash(adminPassword, 12);
  const roles: Role[] = ['diretor'];

  // As cinco disciplinas fixas. "Pedagogias da Escuta", "Expressao Corporal" e
  // "Comunicacao Criativa" sao citadas na transcricao; as outras duas sao
  // sugestoes a confirmar com a Vox RJ.
  const subjects: Array<{ id: string; name: string }> = [
    { id: 'subj_pedagogias_escuta', name: 'Pedagogias da Escuta' },
    { id: 'subj_expressao_corporal', name: 'Expressao Corporal' },
    { id: 'subj_comunicacao_criativa', name: 'Comunicacao Criativa' },
    { id: 'subj_comunicacao_assertiva', name: 'Comunicacao Assertiva e Lideranca' },
    { id: 'subj_oratoria_argumentacao', name: 'Oratoria e Argumentacao' },
  ];

  for (const subject of subjects) {
    await prisma.subject.upsert({
      where: { id: subject.id },
      update: { name: subject.name, active: true },
      create: { id: subject.id, name: subject.name, active: true },
    });
  }

  // Unidades criadas antes de usuarios/alunos/aulas porque agora sao referenciadas
  // por FK (unitId).
  await prisma.unit.upsert({
    where: { id: 'unit_centro' },
    update: {},
    create: {
      id: 'unit_centro',
      name: 'Matriz / Centro',
      address: 'Centro, Rio de Janeiro',
      capacity: 48,
      active: true,
    },
  });

  await prisma.unit.upsert({
    where: { id: 'unit_barra' },
    update: {},
    create: {
      id: 'unit_barra',
      name: 'Barra da Tijuca',
      address: 'Barra da Tijuca, Rio de Janeiro',
      capacity: 36,
      active: true,
    },
  });

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      name: 'Diretor Vox RJ',
      passwordHash,
      roles,
      active: true,
    },
    create: {
      id: 'usr_diretor',
      name: 'Diretor Vox RJ',
      email: adminEmail,
      passwordHash,
      roles,
      active: true,
    },
  });

  await prisma.user.upsert({
    where: { email: 'joao.p@voxrj.com' },
    update: {
      name: 'Joao Pedro',
      passwordHash,
      roles: ['professor'],
      active: true,
      subjectId: 'subj_comunicacao_assertiva',
    },
    create: {
      id: 'usr_prof_joao',
      name: 'Joao Pedro',
      email: 'joao.p@voxrj.com',
      passwordHash,
      roles: ['professor'],
      active: true,
      subjectId: 'subj_comunicacao_assertiva',
    },
  });

  // Apos minimizar os papeis, a coordenacao e o unico papel interno alem de
  // diretor e professor. Ela fica vinculada a uma unidade (unit_centro) para
  // demonstrar a permissao por unidade.
  const staffUsers: Array<{
    id: string;
    name: string;
    email: string;
    roles: Role[];
    unitId?: string;
  }> = [
    {
      id: 'usr_coordenacao',
      name: 'Coordenacao Vox RJ',
      email: 'coordenacao@voxrj.com',
      roles: ['coordenacao'],
      unitId: 'unit_centro',
    },
  ];

  for (const staff of staffUsers) {
    await prisma.user.upsert({
      where: { email: staff.email },
      update: {
        name: staff.name,
        passwordHash,
        roles: staff.roles,
        active: true,
        unitId: staff.unitId ?? null,
      },
      create: {
        id: staff.id,
        name: staff.name,
        email: staff.email,
        passwordHash,
        roles: staff.roles,
        active: true,
        unitId: staff.unitId ?? null,
      },
    });
  }

  await prisma.lead.upsert({
    where: { id: 'lead_carlos' },
    update: {},
    create: {
      id: 'lead_carlos',
      name: 'Carlos Almeida',
      whatsapp: '21987654321',
      unitInterest: 'Matriz',
      campaign: 'CP01 Oratoria Advogados',
      source: 'Meta Ads',
      stage: 'novo_lead',
    },
  });

  await prisma.lead.upsert({
    where: { id: 'lead_mariana' },
    update: {},
    create: {
      id: 'lead_mariana',
      name: 'Mariana Costa',
      whatsapp: '21999887766',
      unitInterest: 'Barra',
      source: 'Indicacao',
      stage: 'em_atendimento',
    },
  });

  await prisma.student.upsert({
    where: { id: 'stu_ana' },
    update: {
      creditBalance: 3,
      active: true,
      unitId: 'unit_centro',
    },
    create: {
      id: 'stu_ana',
      contactId: 'contact_ana',
      name: 'Ana Silva',
      whatsapp: '21977776666',
      email: 'ana.silva@example.com',
      cpfHash: cpfHash('11122233344'),
      cpfMasked: '111.***.***-44',
      enrollmentCode: 'VX-8892',
      unitId: 'unit_centro',
      packageName: 'Pacote 15 aulas',
      creditBalance: 3,
      active: true,
    },
  });

  await prisma.student.upsert({
    where: { id: 'stu_roberto' },
    update: {
      creditBalance: 0,
      active: true,
      unitId: 'unit_centro',
    },
    create: {
      id: 'stu_roberto',
      contactId: 'contact_roberto',
      name: 'Roberto Mendes',
      whatsapp: '21966665555',
      cpfHash: cpfHash('22233344455'),
      cpfMasked: '222.***.***-55',
      enrollmentCode: 'VX-9021',
      unitId: 'unit_centro',
      packageName: 'Pacote 15 aulas',
      creditBalance: 0,
      active: true,
    },
  });

  const startsAt = new Date(Date.now() + 60 * 60_000);
  const endsAt = new Date(Date.now() + 3 * 60 * 60_000);

  await prisma.classSession.upsert({
    where: { id: 'class_lideranca_hoje' },
    update: {
      startsAt,
      endsAt,
      subjectId: 'subj_comunicacao_assertiva',
      teacherUserId: 'usr_prof_joao',
      unitId: 'unit_centro',
      isGuest: false,
    },
    create: {
      id: 'class_lideranca_hoje',
      subjectId: 'subj_comunicacao_assertiva',
      isGuest: false,
      unitId: 'unit_centro',
      teacherUserId: 'usr_prof_joao',
      startsAt,
      endsAt,
      capacity: 12,
    },
  });

  await prisma.classBooking.upsert({
    where: {
      classSessionId_studentId: {
        classSessionId: 'class_lideranca_hoje',
        studentId: 'stu_ana',
      },
    },
    update: {
      status: 'agendado',
    },
    create: {
      id: 'booking_ana_lideranca',
      classSessionId: 'class_lideranca_hoje',
      studentId: 'stu_ana',
      type: 'regular',
      status: 'agendado',
      consumesCredit: true,
    },
  });

  await prisma.classBooking.upsert({
    where: {
      classSessionId_studentId: {
        classSessionId: 'class_lideranca_hoje',
        studentId: 'stu_roberto',
      },
    },
    update: {
      status: 'agendado',
    },
    create: {
      id: 'booking_roberto_lideranca',
      classSessionId: 'class_lideranca_hoje',
      studentId: 'stu_roberto',
      type: 'regular',
      status: 'agendado',
      consumesCredit: true,
    },
  });

  await prisma.package.upsert({
    where: { id: 'pkg_15' },
    update: {},
    create: {
      id: 'pkg_15',
      name: 'Pacote 15 aulas',
      classCount: 15,
      priceCents: 150_000,
      validityDays: 365,
      active: true,
    },
  });

  // Pacote menor decidido na reuniao de arquitetura (7 aulas por R$ 850).
  await prisma.package.upsert({
    where: { id: 'pkg_7' },
    update: {},
    create: {
      id: 'pkg_7',
      name: 'Pacote 7 aulas',
      classCount: 7,
      priceCents: 85_000,
      validityDays: 365,
      active: true,
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
    await pool.end();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    await pool.end();
    process.exit(1);
  });
