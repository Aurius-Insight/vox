import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import type { Lead, LeadStage, Role } from '@prisma/client';
import { prisma } from '../db/client.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { ApiError, asyncHandler, maskCpf, maskPhone, parsePagination } from '../lib/http.js';
import { hashCpf, normalizeCpf } from '../lib/cpf.js';
import { canConvertLead, uniqueEnrollmentCode } from '../domain/enrollment.js';
import { resolveUnitScope } from '../domain/access.js';

const router = Router();

const stages: LeadStage[] = [
  'novo_lead',
  'em_atendimento',
  'pre_agendamento',
  'experimental_agendada',
  'matriculado',
  'perdido',
];

const ListQuerySchema = z.object({
  stage: z.enum(stages as [LeadStage, ...LeadStage[]]).optional(),
  search: z.string().max(80).optional(),
  // Match exato em Lead.unitInterest (que e texto livre). Usado pelo Kanban.
  unit: z.string().max(80).optional(),
  page: z.string().optional(),
  pageSize: z.string().optional(),
});

const CreateLeadSchema = z.object({
  name: z.string().min(2).max(120),
  whatsapp: z.string().min(8).max(30),
  unitInterest: z.string().min(2).max(80),
  campaign: z.string().max(120).optional(),
  source: z.string().min(2).max(80),
});

const UpdateStageSchema = z.object({
  stage: z.enum(stages as [LeadStage, ...LeadStage[]]),
});

const ConvertLeadSchema = z.object({
  cpf: z.string().min(11).max(14),
  unitId: z.string().min(1),
  packageId: z.string().min(1),
});

const conversionErrorMap: Record<string, { status: number; message: string }> = {
  lead_not_found: { status: 404, message: 'Lead nao encontrado.' },
  already_enrolled: { status: 409, message: 'Este lead ja foi convertido em aluno.' },
  package_not_found: { status: 404, message: 'Pacote nao encontrado.' },
  unit_not_found: { status: 404, message: 'Unidade nao encontrada.' },
  cpf_already_used: { status: 409, message: 'Ja existe um aluno com este CPF.' },
};

// Diretor e coordenacao operam o pipeline e precisam do contato real do lead
// (a coordenacao dispara a conversa no WhatsApp a partir dele).
function canViewSensitiveLeadData(roles: Role[]) {
  return roles.includes('diretor') || roles.includes('coordenacao');
}

function toLeadDto(lead: Lead, canViewSensitive: boolean) {
  return {
    id: lead.id,
    name: lead.name,
    whatsapp: canViewSensitive ? lead.whatsapp : maskPhone(lead.whatsapp),
    unitInterest: lead.unitInterest,
    campaign: lead.campaign ?? undefined,
    source: lead.source,
    stage: lead.stage,
    createdAt: lead.createdAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString(),
  };
}

// Coordenacao opera o pipeline junto com o diretor: ler, criar, mover etapa e
// converter. Gestao de pacotes/precos e que continua exclusiva do diretor.
router.get(
  '/',
  requireAuth,
  requireRole('diretor', 'coordenacao'),
  asyncHandler(async (req, res) => {
    const query = ListQuerySchema.parse(req.query);
    const { page, pageSize, offset } = parsePagination(req.query);

    const where: Prisma.LeadWhereInput = {
      ...(query.stage ? { stage: query.stage } : {}),
      ...(query.unit ? { unitInterest: query.unit } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { whatsapp: { contains: query.search.replace(/\D/g, '') } },
              { unitInterest: { contains: query.search, mode: 'insensitive' } },
              { campaign: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: offset,
        take: pageSize,
      }),
      prisma.lead.count({ where }),
    ]);

    const canViewSensitive = canViewSensitiveLeadData(req.user?.roles ?? []);

    res.json({
      data: items.map((lead) => toLeadDto(lead, canViewSensitive)),
      page,
      pageSize,
      total,
    });
  }),
);

router.post(
  '/',
  requireAuth,
  requireRole('diretor', 'coordenacao'),
  asyncHandler(async (req, res) => {
    const input = CreateLeadSchema.parse(req.body);
    const lead = await prisma.lead.create({
      data: {
        name: input.name,
        whatsapp: input.whatsapp.replace(/\D/g, ''),
        unitInterest: input.unitInterest,
        campaign: input.campaign,
        source: input.source,
        stage: 'novo_lead',
      },
    });
    res.status(201).json({ data: toLeadDto(lead, true) });
  }),
);

router.patch(
  '/:leadId/stage',
  requireAuth,
  requireRole('diretor', 'coordenacao'),
  asyncHandler(async (req, res) => {
    const input = UpdateStageSchema.parse(req.body);

    try {
      const lead = await prisma.lead.update({
        where: { id: req.params.leadId },
        data: { stage: input.stage },
      });
      res.json({ data: toLeadDto(lead, true) });
    } catch (error) {
      // P2025: registro nao encontrado. Qualquer outro erro deve propagar como 500.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ApiError(404, 'lead_not_found', 'Lead nao encontrado.');
      }
      throw error;
    }
  }),
);

// Conversao lead -> aluno: o coracao do funil. Gera o aluno a partir do lead,
// vincula o pacote (saldo = quantidade de aulas), cria o codigo de matricula
// e marca o lead como matriculado. O CPF e pedido so nesse momento.
router.post(
  '/:leadId/convert',
  requireAuth,
  requireRole('diretor', 'coordenacao'),
  asyncHandler(async (req, res) => {
    const input = ConvertLeadSchema.parse(req.body);
    const cpfDigits = normalizeCpf(input.cpf);
    if (cpfDigits.length !== 11) {
      throw new ApiError(400, 'invalid_cpf', 'CPF deve ter 11 digitos.');
    }

    const unitScope = resolveUnitScope({ roles: req.user!.roles, unitId: req.user!.unitId });
    if (unitScope && unitScope !== input.unitId) {
      throw new ApiError(403, 'unit_scope', 'Voce so pode matricular alunos na sua unidade.');
    }

    const result = await prisma.$transaction(async (tx) => {
      const lead = await tx.lead.findUnique({
        where: { id: req.params.leadId },
        include: { student: { select: { id: true } } },
      });
      if (!lead) return { ok: false as const, error: 'lead_not_found' as const };

      const check = canConvertLead({ hasStudent: Boolean(lead.student) });
      if (!check.ok) return { ok: false as const, error: check.reason };

      const unit = await tx.unit.findFirst({ where: { id: input.unitId, active: true } });
      if (!unit) return { ok: false as const, error: 'unit_not_found' as const };

      const pkg = await tx.package.findFirst({ where: { id: input.packageId, active: true } });
      if (!pkg) return { ok: false as const, error: 'package_not_found' as const };

      const cpfHashValue = hashCpf(cpfDigits);
      const existingByCpf = await tx.student.findFirst({ where: { cpfHash: cpfHashValue } });
      if (existingByCpf) return { ok: false as const, error: 'cpf_already_used' as const };

      const enrollmentCode = await uniqueEnrollmentCode((code) =>
        tx.student.findUnique({ where: { enrollmentCode: code } }).then((found) => found !== null),
      );

      const student = await tx.student.create({
        data: {
          leadId: lead.id,
          name: lead.name,
          whatsapp: lead.whatsapp,
          email: lead.email,
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

      const updatedLead = await tx.lead.update({
        where: { id: lead.id },
        data: { stage: 'matriculado' },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: req.user!.id,
          actorType: 'user',
          entityType: 'student',
          entityId: student.id,
          action: 'lead.converted',
          before: { leadId: lead.id, stage: lead.stage },
          after: { studentId: student.id, enrollmentCode, packageName: pkg.name },
        },
      });

      return { ok: true as const, student, lead: updatedLead };
    });

    if (!result.ok) {
      const mapped = conversionErrorMap[result.error] ?? {
        status: 409,
        message: 'Nao foi possivel converter o lead.',
      };
      throw new ApiError(mapped.status, result.error, mapped.message);
    }

    res.status(201).json({
      data: {
        student: {
          id: result.student.id,
          name: result.student.name,
          enrollmentCode: result.student.enrollmentCode,
          unitId: result.student.unitId,
          unitName: result.student.unit?.name ?? null,
          packageName: result.student.packageName,
          creditBalance: result.student.creditBalance,
        },
        lead: toLeadDto(result.lead, true),
      },
    });
  }),
);

export default router;
