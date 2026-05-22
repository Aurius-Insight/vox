import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { ApiError, asyncHandler, maskCpf, maskPhone } from '../lib/http.js';
import { hashCpf, normalizeCpf } from '../lib/cpf.js';
import { uniqueEnrollmentCode } from '../domain/enrollment.js';
import { resolveUnitScope } from '../domain/access.js';
import { createMagicLink, MAGIC_LINK_TTL_SECONDS } from '../lib/magic-link.js';

const router = Router();

const VIEW_ROLES = ['diretor', 'coordenacao'] as const;

const CreateStudentSchema = z.object({
  name: z.string().min(2).max(120),
  whatsapp: z.string().min(8).max(30),
  email: z.string().email().max(160).optional(),
  cpf: z.string().min(11).max(14),
  unitId: z.string().min(1),
  packageId: z.string().min(1),
});

const RenewSchema = z.object({
  packageId: z.string().min(1),
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
    const cpfDigits = normalizeCpf(input.cpf);
    if (cpfDigits.length !== 11) {
      throw new ApiError(400, 'invalid_cpf', 'CPF deve ter 11 digitos.');
    }

    const unitScope = resolveUnitScope({ roles: req.user!.roles, unitId: req.user!.unitId });
    if (unitScope && unitScope !== input.unitId) {
      throw new ApiError(403, 'unit_scope', 'Voce so pode cadastrar alunos na sua unidade.');
    }

    const result = await prisma.$transaction(async (tx) => {
      const unit = await tx.unit.findFirst({ where: { id: input.unitId, active: true } });
      if (!unit) return { ok: false as const, error: 'unit_not_found' as const };

      const pkg = await tx.package.findFirst({ where: { id: input.packageId, active: true } });
      if (!pkg) return { ok: false as const, error: 'package_not_found' as const };

      const cpfHashValue = hashCpf(cpfDigits);
      const existing = await tx.student.findFirst({ where: { cpfHash: cpfHashValue } });
      if (existing) return { ok: false as const, error: 'cpf_already_used' as const };

      const enrollmentCode = await uniqueEnrollmentCode((code) =>
        tx.student.findUnique({ where: { enrollmentCode: code } }).then((found) => found !== null),
      );

      const student = await tx.student.create({
        data: {
          name: input.name,
          whatsapp: input.whatsapp.replace(/\D/g, ''),
          email: input.email,
          cpfHash: cpfHashValue,
          cpfMasked: maskCpf(cpfDigits),
          enrollmentCode,
          unitId: input.unitId,
          packageName: pkg.name,
          creditBalance: pkg.classCount,
          active: true,
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
          after: { enrollmentCode, packageName: pkg.name, unitId: input.unitId },
        },
      });

      return { ok: true as const, student };
    });

    if (!result.ok) {
      const map: Record<string, { status: number; message: string }> = {
        unit_not_found: { status: 404, message: 'Unidade nao encontrada.' },
        package_not_found: { status: 404, message: 'Pacote nao encontrado.' },
        cpf_already_used: { status: 409, message: 'Ja existe um aluno com este CPF.' },
      };
      const mapped = map[result.error];
      throw new ApiError(mapped.status, result.error, mapped.message);
    }

    res.status(201).json({
      data: {
        id: result.student.id,
        name: result.student.name,
        enrollmentCode: result.student.enrollmentCode,
        unitId: result.student.unitId,
        unitName: result.student.unit?.name ?? null,
        packageName: result.student.packageName,
        creditBalance: result.student.creditBalance,
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
        lead: { select: { campaign: true, source: true, stage: true } },
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
        whatsapp: maskPhone(student.whatsapp),
        email: student.email ?? undefined,
        cpf: student.cpfMasked ?? undefined,
        unitId: student.unitId,
        unitName: student.unit?.name ?? null,
        packageName: student.packageName,
        creditBalance: student.creditBalance,
        status: student.active ? 'ativo' : 'inativo',
        origin: student.lead
          ? {
              campaign: student.lead.campaign ?? undefined,
              source: student.lead.source,
              stage: student.lead.stage,
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
