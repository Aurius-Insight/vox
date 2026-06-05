import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { ApiError, asyncHandler, maskCpf, maskPhone } from '../lib/http.js';
import { hashCpf, normalizeCpf } from '../lib/cpf.js';
import { enrollmentStageSlug, uniqueEnrollmentCode } from '../domain/enrollment.js';
import { resolveUnitScope } from '../domain/access.js';
import { withEnrollmentCodeRetry } from '../lib/enrollment-retry.js';
import { getLeadStageBySlug } from '../lib/lead-stage-cache.js';
import {
  buildStudentTimeline,
  computeStudentKpis,
  type AttendanceSnapshot,
  type BookingSnapshot,
  type RenewalSnapshot,
} from '../domain/student-history.js';
import { createMagicLink, MAGIC_LINK_TTL_SECONDS } from '../lib/magic-link.js';

const router = Router();

const VIEW_ROLES = ['diretor', 'coordenacao'] as const;

// CPF e opcional em qualquer cadastro (decisao do operador: o time muitas
// vezes nao tem o CPF na hora do cadastro). Sem CPF, perde-se a dedup
// por cpfHash — pode entrar aluno duplicado se a equipe nao conferir.
// Pacote so e obrigatorio para matriculado (experimental nasce sem saldo).
//
// Quanto a CPF, aceita string vazia/whitespace como "nao informado" — o
// front pode mandar `cpf: ""` quando o campo nao foi preenchido.
const CreateStudentSchema = z
  .object({
    name: z.string().min(2).max(120),
    // WhatsApp opcional: ETL das planilhas legadas cria alunos sem fone;
    // operador completa depois. Quando vier, exige 8-30 chars.
    whatsapp: z.string().min(8).max(30).optional(),
    email: z.string().email().max(160).optional(),
    type: z.enum(['matriculado', 'experimental']).default('matriculado'),
    cpf: z
      .string()
      .optional()
      .transform((v) => (v && v.trim().length > 0 ? v : undefined))
      .pipe(z.string().min(11).max(14).optional()),
    unitId: z.string().min(1),
    packageId: z.string().min(1).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.type === 'matriculado' && !data.packageId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['packageId'],
        message: 'Pacote e obrigatorio para aluno matriculado.',
      });
    }
  });

const RenewSchema = z.object({
  packageId: z.string().min(1),
});

// Promove um aluno experimental pra matriculado. Ao contrario de RenewSchema
// (que e pra aluno ja matriculado), aqui o aluno vira matriculado pela
// primeira vez — packageId obrigatorio define o saldo, CPF e opcional, e o
// Lead vinculado (se houver) e movido pra etapa 'matriculado' (Student manda).
const EnrollSchema = z.object({
  packageId: z.string().min(1),
  cpf: z
    .string()
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v : undefined))
    .pipe(z.string().min(11).max(14).optional()),
  unitId: z.string().min(1).optional(),
});

// Edicao cadastral: campos operacionais. O CPF fica de fora de proposito —
// e a chave de identidade/dedup do aluno (cpfHash). String vazia no e-mail
// significa "limpar o campo".
const UpdateStudentSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    whatsapp: z.string().min(8).max(30).optional(),
    email: z.string().email().max(160).or(z.literal('')).optional(),
    unitId: z.string().min(1).optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'Informe ao menos um campo para atualizar.',
  });

router.get(
  '/',
  requireAuth,
  requireRole(...VIEW_ROLES),
  asyncHandler(async (req, res) => {
    const unitScope = resolveUnitScope({ roles: req.user!.roles, unitId: req.user!.unitId });

    const students = await prisma.student.findMany({
      where: { active: true, ...(unitScope ? { unitId: unitScope } : {}) },
      orderBy: { name: 'asc' },
      include: { unit: { select: { name: true } } },
    });

    res.json({
      data: students.map((student) => ({
        id: student.id,
        name: student.name,
        type: student.type,
        enrollmentCode: student.enrollmentCode,
        whatsapp: maskPhone(student.whatsapp),
        cpf: student.cpfMasked ?? undefined,
        unitId: student.unitId,
        unitName: student.unit?.name ?? null,
        packageName: student.packageName,
        creditBalance: student.creditBalance,
        tags: student.tags,
        status: student.active ? 'ativo' : 'inativo',
      })),
    });
  }),
);

// Cadastro manual de aluno (sem passar por lead). O fluxo principal continua
// sendo a conversao lead -> aluno; isso atende casos avulsos / legado.
router.post(
  '/',
  requireAuth,
  requireRole('diretor'),
  asyncHandler(async (req, res) => {
    const input = CreateStudentSchema.parse(req.body);

    // CPF e opcional em qualquer cadastro. Quando vem, valida os 11 digitos
    // e usa pra hash/dedup; quando nao, persiste sem cpfHash/cpfMasked.
    let cpfDigits: string | null = null;
    if (input.cpf) {
      cpfDigits = normalizeCpf(input.cpf);
      if (cpfDigits.length !== 11) {
        throw new ApiError(400, 'invalid_cpf', 'CPF deve ter 11 digitos.');
      }
    }

    const unitScope = resolveUnitScope({ roles: req.user!.roles, unitId: req.user!.unitId });
    if (unitScope && unitScope !== input.unitId) {
      throw new ApiError(403, 'unit_scope', 'Voce so pode cadastrar alunos na sua unidade.');
    }

    const whatsappDigits = input.whatsapp ? input.whatsapp.replace(/\D/g, '') : null;

    const result = await withEnrollmentCodeRetry(() => prisma.$transaction(async (tx) => {
      const unit = await tx.unit.findFirst({ where: { id: input.unitId, active: true } });
      if (!unit) return { ok: false as const, error: 'unit_not_found' as const };

      let packageName: string | null = null;
      let creditBalance = 0;
      if (input.type === 'matriculado') {
        const pkg = await tx.package.findFirst({
          where: { id: input.packageId!, active: true },
        });
        if (!pkg) return { ok: false as const, error: 'package_not_found' as const };
        packageName = pkg.name;
        creditBalance = pkg.classCount;
      }

      let cpfHashValue: string | null = null;
      let cpfMaskedValue: string | null = null;
      if (cpfDigits) {
        cpfHashValue = hashCpf(cpfDigits);
        const existing = await tx.student.findFirst({ where: { cpfHash: cpfHashValue } });
        if (existing) return { ok: false as const, error: 'cpf_already_used' as const };
        cpfMaskedValue = maskCpf(cpfDigits) ?? null;
      }

      // Dedup por whatsapp: sem CPF, e o unico campo que evita duplicata.
      // Bloqueia se ja existe aluno ativo com o mesmo numero — operador
      // deve usar o cadastro existente ou desativar antes. So roda quando
      // o whatsapp foi informado; cadastro sem fone (ETL legado, etc.)
      // depende do operador conferir manualmente eventuais duplicidades.
      if (whatsappDigits) {
        const existingByWhatsapp = await tx.student.findFirst({
          where: { whatsapp: whatsappDigits, active: true },
          select: { id: true, enrollmentCode: true },
        });
        if (existingByWhatsapp) {
          return {
            ok: false as const,
            error: 'whatsapp_already_used' as const,
            existing: existingByWhatsapp,
          };
        }
      }

      const enrollmentCode = await uniqueEnrollmentCode((code) =>
        tx.student.findUnique({ where: { enrollmentCode: code } }).then((found) => found !== null),
      );

      // "Student manda": todo aluno nasce vinculado a um lead, ja na etapa do
      // CRM que corresponde ao tipo (matriculado -> matriculado, experimental
      // -> experimental_agendada). Sem isto o cadastro direto nascia fora do
      // funil e nunca aparecia no Kanban. Reaproveita um lead existente do
      // mesmo whatsapp que ainda nao virou aluno, em vez de duplicar.
      const targetStage = await getLeadStageBySlug(enrollmentStageSlug(input.type), tx);
      const reusableLead = whatsappDigits
        ? await tx.lead.findFirst({
            where: { whatsapp: whatsappDigits, student: { is: null } },
            select: { id: true },
          })
        : null;
      const leadId = reusableLead
        ? (
            await tx.lead.update({
              where: { id: reusableLead.id },
              data: { stageId: targetStage.id },
              select: { id: true },
            })
          ).id
        : (
            await tx.lead.create({
              data: {
                name: input.name,
                whatsapp: whatsappDigits,
                email: input.email,
                unitInterest: unit.name,
                source: 'cadastro_direto',
                stageId: targetStage.id,
              },
              select: { id: true },
            })
          ).id;

      const student = await tx.student.create({
        data: {
          name: input.name,
          whatsapp: whatsappDigits,
          email: input.email,
          cpfHash: cpfHashValue,
          cpfMasked: cpfMaskedValue,
          enrollmentCode,
          unitId: input.unitId,
          type: input.type,
          packageName,
          creditBalance,
          active: true,
          leadId,
        },
        include: { unit: { select: { name: true } } },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: req.user!.id,
          actorType: 'user',
          entityType: 'student',
          entityId: student.id,
          action: 'student.created',
          after: { enrollmentCode, type: input.type, packageName, unitId: input.unitId },
        },
      });

      return { ok: true as const, student };
    }));

    if (!result.ok) {
      const map: Record<string, { status: number; message: string }> = {
        unit_not_found: { status: 404, message: 'Unidade nao encontrada.' },
        package_not_found: { status: 404, message: 'Pacote nao encontrado.' },
        cpf_already_used: { status: 409, message: 'Ja existe um aluno com este CPF.' },
        whatsapp_already_used: {
          status: 409,
          message: 'Ja existe um aluno ativo com este WhatsApp.',
        },
      };
      const mapped = map[result.error];
      throw new ApiError(mapped.status, result.error, mapped.message, {
        ...(result.error === 'whatsapp_already_used' && 'existing' in result
          ? { existing: result.existing }
          : {}),
      });
    }

    res.status(201).json({
      data: {
        id: result.student.id,
        name: result.student.name,
        type: result.student.type,
        enrollmentCode: result.student.enrollmentCode,
        unitId: result.student.unitId,
        unitName: result.student.unit?.name ?? null,
        packageName: result.student.packageName,
        creditBalance: result.student.creditBalance,
        tags: result.student.tags,
      },
    });
  }),
);

const SearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(80),
});

// Busca de alunos por nome ou matricula — usada para agendar alunos em aulas
// (pagina de Presenca). Acessivel tambem ao professor. Registrada antes de
// "/:studentId" para nao ser capturada como id.
router.get(
  '/search',
  requireAuth,
  requireRole('diretor', 'coordenacao', 'professor'),
  asyncHandler(async (req, res) => {
    const parsed = SearchQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.json({ data: [] });
      return;
    }

    const students = await prisma.student.findMany({
      where: {
        active: true,
        OR: [
          { name: { contains: parsed.data.q, mode: 'insensitive' } },
          { enrollmentCode: { contains: parsed.data.q, mode: 'insensitive' } },
        ],
      },
      orderBy: { name: 'asc' },
      take: 20,
      select: {
        id: true,
        name: true,
        type: true,
        enrollmentCode: true,
        creditBalance: true,
        unit: { select: { name: true } },
      },
    });

    res.json({
      data: students.map((student) => ({
        id: student.id,
        name: student.name,
        type: student.type,
        enrollmentCode: student.enrollmentCode,
        creditBalance: student.creditBalance,
        unitName: student.unit?.name ?? null,
      })),
    });
  }),
);

router.get(
  '/:studentId',
  requireAuth,
  requireRole(...VIEW_ROLES),
  asyncHandler(async (req, res) => {
    const unitScope = resolveUnitScope({ roles: req.user!.roles, unitId: req.user!.unitId });

    const student = await prisma.student.findUnique({
      where: { id: req.params.studentId },
      include: {
        unit: { select: { id: true, name: true } },
        lead: { select: { campaign: true, source: true, stage: { select: { slug: true } } } },
        bookings: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: {
            classSession: {
              select: {
                startsAt: true,
                isGuest: true,
                subject: { select: { name: true } },
                unit: { select: { name: true } },
              },
            },
          },
        },
        attendances: {
          orderBy: { markedAt: 'desc' },
          take: 20,
          include: {
            classSession: {
              select: {
                startsAt: true,
                isGuest: true,
                subject: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    if (!student) throw new ApiError(404, 'student_not_found', 'Aluno nao encontrado.');
    if (unitScope && student.unitId !== unitScope) {
      throw new ApiError(403, 'unit_scope', 'Aluno fora da sua unidade.');
    }

    const classLabel = (session: { isGuest: boolean; subject: { name: string } | null }) =>
      session.isGuest ? 'Professor convidado' : (session.subject?.name ?? 'Sem materia');

    res.json({
      data: {
        id: student.id,
        name: student.name,
        type: student.type,
        enrollmentCode: student.enrollmentCode,
        // WhatsApp sem mascara na FICHA do aluno: so diretor/coordenacao
        // acessam esta tela e precisam do numero pra contatar. CPF segue
        // mascarado (cpfMasked). Lista e demais respostas continuam mascaradas.
        whatsapp: student.whatsapp,
        email: student.email ?? undefined,
        cpf: student.cpfMasked ?? undefined,
        unitId: student.unitId,
        unitName: student.unit?.name ?? null,
        packageName: student.packageName,
        creditBalance: student.creditBalance,
        tags: student.tags,
        status: student.active ? 'ativo' : 'inativo',
        origin: student.lead
          ? {
              campaign: student.lead.campaign ?? undefined,
              source: student.lead.source,
              stage: student.lead.stage.slug,
            }
          : undefined,
        bookings: student.bookings.map((booking) => ({
          id: booking.id,
          status: booking.status,
          type: booking.type,
          classLabel: classLabel(booking.classSession),
          unit: booking.classSession.unit?.name ?? null,
          startsAt: booking.classSession.startsAt.toISOString(),
        })),
        attendances: student.attendances.map((attendance) => ({
          id: attendance.id,
          status: attendance.status,
          creditConsumed: attendance.creditConsumed,
          classLabel: classLabel(attendance.classSession),
          startsAt: attendance.classSession.startsAt.toISOString(),
          markedAt: attendance.markedAt.toISOString(),
        })),
      },
    });
  }),
);

const HistoryQuerySchema = z.object({
  since: z.string().datetime().optional(),
});

// 730 dias (~2 anos): cobre o backfill historico das planilhas (aulas de
// 2024/2025). A aba Historico pode pedir uma janela menor via `?since=`.
const HISTORY_DEFAULT_WINDOW_DAYS = 730;
const HISTORY_MAX_EVENTS_PER_TYPE = 500;

// Historico individual do aluno: KPIs (janela configuravel, default 90 dias)
// + timeline unificada (cadastro, lead, agendamentos, presencas, renovacoes).
// Renovacoes vem do AuditLog (`student.renewed`), nao ha schema dedicado.
router.get(
  '/:studentId/history',
  requireAuth,
  requireRole(...VIEW_ROLES),
  asyncHandler(async (req, res) => {
    const query = HistoryQuerySchema.parse(req.query);
    const unitScope = resolveUnitScope({ roles: req.user!.roles, unitId: req.user!.unitId });
    const now = new Date();
    const since = query.since
      ? new Date(query.since)
      : new Date(now.getTime() - HISTORY_DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const windowDays = Math.max(
      1,
      Math.ceil((now.getTime() - since.getTime()) / (24 * 60 * 60 * 1000)),
    );

    const student = await prisma.student.findUnique({
      where: { id: req.params.studentId },
      include: {
        lead: { select: { createdAt: true, campaign: true, source: true } },
      },
    });

    if (!student) throw new ApiError(404, 'student_not_found', 'Aluno nao encontrado.');
    if (unitScope && student.unitId !== unitScope) {
      throw new ApiError(403, 'unit_scope', 'Aluno fora da sua unidade.');
    }

    const sessionInclude = {
      classSession: {
        select: {
          startsAt: true,
          isGuest: true,
          subject: { select: { name: true } },
        },
      },
    } as const;

    const [
      bookingsInWindow,
      attendancesInWindow,
      lifetimePresentCount,
      lastAttendance,
      nextBooking,
      renewalLogs,
    ] = await Promise.all([
      prisma.classBooking.findMany({
        where: {
          studentId: student.id,
          OR: [{ createdAt: { gte: since } }, { canceledAt: { gte: since } }],
        },
        orderBy: { createdAt: 'desc' },
        take: HISTORY_MAX_EVENTS_PER_TYPE,
        include: sessionInclude,
      }),
      prisma.attendance.findMany({
        where: { studentId: student.id, markedAt: { gte: since } },
        orderBy: { markedAt: 'desc' },
        take: HISTORY_MAX_EVENTS_PER_TYPE,
        include: sessionInclude,
      }),
      prisma.attendance.count({
        where: { studentId: student.id, status: 'presente' },
      }),
      prisma.attendance.findFirst({
        where: { studentId: student.id },
        orderBy: { markedAt: 'desc' },
        select: { markedAt: true },
      }),
      prisma.classBooking.findFirst({
        where: {
          studentId: student.id,
          status: 'agendado',
          classSession: { startsAt: { gte: now }, canceledAt: null },
        },
        orderBy: { classSession: { startsAt: 'asc' } },
        select: { classSession: { select: { startsAt: true } } },
      }),
      prisma.auditLog.findMany({
        where: {
          entityType: 'student',
          entityId: student.id,
          action: 'student.renewed',
          createdAt: { gte: since },
        },
        orderBy: { createdAt: 'desc' },
        take: HISTORY_MAX_EVENTS_PER_TYPE,
        select: { createdAt: true, after: true },
      }),
    ]);

    const classLabel = (session: { isGuest: boolean; subject: { name: string } | null }) =>
      session.isGuest ? 'Professor convidado' : (session.subject?.name ?? 'Sem materia');

    const bookings: BookingSnapshot[] = bookingsInWindow.map((booking) => ({
      id: booking.id,
      createdAt: booking.createdAt,
      canceledAt: booking.canceledAt,
      type: booking.type,
      classLabel: classLabel(booking.classSession),
      classStartsAt: booking.classSession.startsAt,
    }));

    const attendances: AttendanceSnapshot[] = attendancesInWindow.map((attendance) => ({
      id: attendance.id,
      markedAt: attendance.markedAt,
      status: attendance.status,
      creditConsumed: attendance.creditConsumed,
      classLabel: classLabel(attendance.classSession),
      classStartsAt: attendance.classSession.startsAt,
    }));

    const renewals: RenewalSnapshot[] = renewalLogs.map((log) => {
      const after = (log.after ?? {}) as { packageName?: string | null; classesAdded?: number };
      return {
        at: log.createdAt,
        packageName: after.packageName ?? null,
        classesAdded: typeof after.classesAdded === 'number' ? after.classesAdded : 0,
      };
    });

    const kpis = computeStudentKpis({
      now,
      windowDays,
      attendancesInWindow: attendancesInWindow.map((a) => ({
        markedAt: a.markedAt,
        status: a.status,
      })),
      lastAttendanceAt: lastAttendance?.markedAt ?? null,
      lifetimePresentCount,
      nextBookingAt: nextBooking?.classSession.startsAt ?? null,
    });

    const timeline = buildStudentTimeline({
      now,
      student: { createdAt: student.createdAt },
      lead: student.lead
        ? {
            createdAt: student.lead.createdAt,
            campaign: student.lead.campaign,
            source: student.lead.source,
          }
        : null,
      bookings,
      attendances,
      renewals,
    });

    res.json({
      data: {
        windowDays,
        since: since.toISOString(),
        kpis,
        timeline,
      },
    });
  }),
);

/**
 * Edicao dos dados cadastrais do aluno — nome, WhatsApp, e-mail e unidade.
 * O CPF NAO e editavel (chave de identidade). Quem opera: diretor e
 * coordenacao; a coordenacao so edita/move alunos dentro da sua unidade.
 */
router.patch(
  '/:studentId',
  requireAuth,
  requireRole(...VIEW_ROLES),
  asyncHandler(async (req, res) => {
    const input = UpdateStudentSchema.parse(req.body);
    const unitScope = resolveUnitScope({ roles: req.user!.roles, unitId: req.user!.unitId });

    const result = await prisma.$transaction(async (tx) => {
      const student = await tx.student.findFirst({
        where: { id: req.params.studentId, active: true },
      });
      if (!student) return { ok: false as const, error: 'student_not_found' as const };
      if (unitScope && student.unitId !== unitScope) {
        return { ok: false as const, error: 'unit_scope' as const };
      }

      // Troca de unidade: destino precisa existir/estar ativo, e a coordenacao
      // so consegue mover o aluno para dentro da propria unidade.
      if (input.unitId && input.unitId !== student.unitId) {
        if (unitScope && unitScope !== input.unitId) {
          return { ok: false as const, error: 'unit_scope_target' as const };
        }
        const unit = await tx.unit.findFirst({ where: { id: input.unitId, active: true } });
        if (!unit) return { ok: false as const, error: 'unit_not_found' as const };
      }

      const data: Prisma.StudentUpdateInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.whatsapp !== undefined) data.whatsapp = input.whatsapp.replace(/\D/g, '');
      if (input.email !== undefined) data.email = input.email === '' ? null : input.email;
      if (input.unitId !== undefined) data.unit = { connect: { id: input.unitId } };

      const updated = await tx.student.update({
        where: { id: student.id },
        data,
        include: { unit: { select: { name: true } } },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: req.user!.id,
          actorType: 'user',
          entityType: 'student',
          entityId: student.id,
          action: 'student.updated',
          before: {
            name: student.name,
            whatsapp: student.whatsapp,
            email: student.email,
            unitId: student.unitId,
          },
          after: {
            name: updated.name,
            whatsapp: updated.whatsapp,
            email: updated.email,
            unitId: updated.unitId,
          },
        },
      });

      return { ok: true as const, student: updated };
    });

    if (!result.ok) {
      const map: Record<string, { status: number; message: string }> = {
        student_not_found: { status: 404, message: 'Aluno nao encontrado.' },
        unit_scope: { status: 403, message: 'Aluno fora da sua unidade.' },
        unit_scope_target: {
          status: 403,
          message: 'Voce so pode mover alunos para a sua unidade.',
        },
        unit_not_found: { status: 404, message: 'Unidade nao encontrada.' },
      };
      const mapped = map[result.error];
      throw new ApiError(mapped.status, result.error, mapped.message);
    }

    res.json({
      data: {
        id: result.student.id,
        name: result.student.name,
        enrollmentCode: result.student.enrollmentCode,
        whatsapp: maskPhone(result.student.whatsapp),
        email: result.student.email ?? undefined,
        cpf: result.student.cpfMasked ?? undefined,
        unitId: result.student.unitId,
        unitName: result.student.unit?.name ?? null,
        packageName: result.student.packageName,
        creditBalance: result.student.creditBalance,
        tags: result.student.tags,
        status: result.student.active ? 'ativo' : 'inativo',
      },
    });
  }),
);

/**
 * Renovacao de pacote (Transcricao 1:08:30): nao e "adicionar pontos avulsos"
 * — e registrar uma nova venda de pacote pro aluno existente.
 *
 * Soma classCount do pacote ao saldo atual e atualiza packageName para o
 * pacote ativo mais recente. Pagamento e a fora do sistema (caixa, PIX,
 * cartao) — o cliente confirmou "a gente recebe tudo antes" (1:08:50).
 * Quem opera vendas e coordenacao + diretor.
 */
router.post(
  '/:studentId/renew',
  requireAuth,
  requireRole('diretor', 'coordenacao'),
  asyncHandler(async (req, res) => {
    const input = RenewSchema.parse(req.body);
    const unitScope = resolveUnitScope({ roles: req.user!.roles, unitId: req.user!.unitId });

    const result = await prisma.$transaction(async (tx) => {
      const student = await tx.student.findFirst({
        where: { id: req.params.studentId, active: true },
      });
      if (!student) return { ok: false as const, error: 'student_not_found' as const };
      if (unitScope && student.unitId !== unitScope) {
        return { ok: false as const, error: 'unit_scope' as const };
      }

      const pkg = await tx.package.findFirst({ where: { id: input.packageId, active: true } });
      if (!pkg) return { ok: false as const, error: 'package_not_found' as const };

      const updated = await tx.student.update({
        where: { id: student.id },
        data: {
          creditBalance: { increment: pkg.classCount },
          packageName: pkg.name,
        },
        include: { unit: { select: { name: true } } },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: req.user!.id,
          actorType: 'user',
          entityType: 'student',
          entityId: student.id,
          action: 'student.renewed',
          before: {
            packageName: student.packageName,
            creditBalance: student.creditBalance,
          },
          after: {
            packageId: pkg.id,
            packageName: updated.packageName,
            creditBalance: updated.creditBalance,
            classesAdded: pkg.classCount,
          },
        },
      });

      return { ok: true as const, student: updated };
    });

    if (!result.ok) {
      const map: Record<string, { status: number; message: string }> = {
        student_not_found: { status: 404, message: 'Aluno nao encontrado.' },
        unit_scope: { status: 403, message: 'Aluno fora da sua unidade.' },
        package_not_found: { status: 404, message: 'Pacote nao encontrado.' },
      };
      const mapped = map[result.error];
      throw new ApiError(mapped.status, result.error, mapped.message);
    }

    res.json({
      data: {
        id: result.student.id,
        name: result.student.name,
        unitName: result.student.unit?.name ?? null,
        packageName: result.student.packageName,
        creditBalance: result.student.creditBalance,
      },
    });
  }),
);

/**
 * Promove um aluno experimental pra matriculado. Atalho direto da ficha
 * do aluno: o operador escolhe o pacote (obrigatorio), opcionalmente CPF
 * e escola, e o aluno e atualizado de uma vez. O Lead vinculado vai
 * automaticamente pra etapa 'matriculado' (Student manda).
 */
router.post(
  '/:studentId/enroll',
  requireAuth,
  requireRole('diretor', 'coordenacao'),
  asyncHandler(async (req, res) => {
    const input = EnrollSchema.parse(req.body);
    const unitScope = resolveUnitScope({ roles: req.user!.roles, unitId: req.user!.unitId });

    let cpfDigits: string | null = null;
    if (input.cpf) {
      cpfDigits = normalizeCpf(input.cpf);
      if (cpfDigits.length !== 11) {
        throw new ApiError(400, 'invalid_cpf', 'CPF deve ter 11 digitos.');
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const student = await tx.student.findFirst({
        where: { id: req.params.studentId, active: true },
        include: { lead: { select: { id: true } } },
      });
      if (!student) return { ok: false as const, error: 'student_not_found' as const };
      if (student.type !== 'experimental') {
        return { ok: false as const, error: 'student_not_experimental' as const };
      }
      if (unitScope && student.unitId !== unitScope) {
        return { ok: false as const, error: 'unit_scope' as const };
      }

      const pkg = await tx.package.findFirst({ where: { id: input.packageId, active: true } });
      if (!pkg) return { ok: false as const, error: 'package_not_found' as const };

      // Troca de unidade: a coordenacao so pode mover dentro do proprio
      // escopo. Sem unitId no payload, mantem a unidade atual.
      let targetUnitId = student.unitId;
      if (input.unitId && input.unitId !== student.unitId) {
        if (unitScope && unitScope !== input.unitId) {
          return { ok: false as const, error: 'unit_scope_target' as const };
        }
        const unit = await tx.unit.findFirst({ where: { id: input.unitId, active: true } });
        if (!unit) return { ok: false as const, error: 'unit_not_found' as const };
        targetUnitId = input.unitId;
      }

      // CPF: dedup contra outros alunos ativos (exceto ele mesmo).
      let cpfHashValue: string | null = student.cpfHash;
      let cpfMaskedValue: string | null = student.cpfMasked;
      if (cpfDigits) {
        cpfHashValue = hashCpf(cpfDigits);
        const existing = await tx.student.findFirst({
          where: { cpfHash: cpfHashValue, id: { not: student.id }, active: true },
        });
        if (existing) return { ok: false as const, error: 'cpf_already_used' as const };
        cpfMaskedValue = maskCpf(cpfDigits) ?? null;
      }

      const updated = await tx.student.update({
        where: { id: student.id },
        data: {
          type: 'matriculado',
          packageName: pkg.name,
          creditBalance: { increment: pkg.classCount },
          unitId: targetUnitId,
          cpfHash: cpfHashValue,
          cpfMasked: cpfMaskedValue,
        },
        include: { unit: { select: { name: true } } },
      });

      // Lead vinculado vai pra 'matriculado' (etapa sistemica final).
      if (student.lead) {
        const matriculadoStage = await tx.leadStage.findUnique({
          where: { slug: 'matriculado' },
        });
        if (matriculadoStage) {
          await tx.lead.update({
            where: { id: student.lead.id },
            data: { stageId: matriculadoStage.id },
          });
        }
      }

      await tx.auditLog.create({
        data: {
          actorUserId: req.user!.id,
          actorType: 'user',
          entityType: 'student',
          entityId: student.id,
          action: 'student.enrolled',
          before: {
            type: student.type,
            packageName: student.packageName,
            creditBalance: student.creditBalance,
          },
          after: {
            type: updated.type,
            packageId: pkg.id,
            packageName: updated.packageName,
            priceCents: pkg.priceCents,
            classesAdded: pkg.classCount,
            creditBalance: updated.creditBalance,
          },
        },
      });

      return { ok: true as const, student: updated };
    });

    if (!result.ok) {
      const map: Record<string, { status: number; message: string }> = {
        student_not_found: { status: 404, message: 'Aluno nao encontrado.' },
        student_not_experimental: {
          status: 409,
          message: 'Aluno ja esta matriculado. Use renovacao em vez de matricula.',
        },
        unit_scope: { status: 403, message: 'Aluno fora da sua unidade.' },
        unit_scope_target: {
          status: 403,
          message: 'Voce so pode matricular alunos na sua unidade.',
        },
        unit_not_found: { status: 404, message: 'Unidade nao encontrada.' },
        package_not_found: { status: 404, message: 'Pacote nao encontrado.' },
        cpf_already_used: { status: 409, message: 'CPF ja cadastrado em outro aluno.' },
      };
      const mapped = map[result.error];
      throw new ApiError(mapped.status, result.error, mapped.message);
    }

    res.json({
      data: {
        id: result.student.id,
        name: result.student.name,
        type: result.student.type,
        enrollmentCode: result.student.enrollmentCode,
        unitId: result.student.unitId,
        unitName: result.student.unit?.name ?? null,
        packageName: result.student.packageName,
        creditBalance: result.student.creditBalance,
      },
    });
  }),
);

/**
 * Gera um link magico de acesso ao portal para a equipe interna repassar ao
 * aluno (WhatsApp, e-mail, presencial). Util quando o numero do aluno nao
 * esta no BotConversa (cadastro avulso) ou quando ele perdeu o link.
 *
 * Diferente de POST /api/portal/magic-links, este NAO envia nada — devolve
 * a URL para o operador logado copiar. Exige sessao interna (diretor ou
 * coordenacao); o token continua sendo de uso unico e expira em 15 min.
 */
router.post(
  '/:studentId/magic-link',
  requireAuth,
  requireRole(...VIEW_ROLES),
  asyncHandler(async (req, res) => {
    const unitScope = resolveUnitScope({ roles: req.user!.roles, unitId: req.user!.unitId });

    const student = await prisma.student.findFirst({
      where: { id: req.params.studentId, active: true },
    });
    if (!student) throw new ApiError(404, 'student_not_found', 'Aluno nao encontrado.');
    if (unitScope && student.unitId !== unitScope) {
      throw new ApiError(403, 'unit_scope', 'Aluno fora da sua unidade.');
    }

    const { link } = await createMagicLink(student.id);

    await prisma.auditLog.create({
      data: {
        actorUserId: req.user!.id,
        actorType: 'user',
        entityType: 'student',
        entityId: student.id,
        action: 'student.magic_link_generated',
      },
    });

    res.json({
      data: { link, expiresInMinutes: MAGIC_LINK_TTL_SECONDS / 60 },
    });
  }),
);

export default router;
