import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import type { Lead, LeadStage, Role, StudentType } from '@prisma/client';
import { prisma } from '../db/client.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { ApiError, asyncHandler, maskCpf, maskPhone, parsePagination } from '../lib/http.js';
import { hashCpf, normalizeCpf } from '../lib/cpf.js';
import { canConvertLead, uniqueEnrollmentCode } from '../domain/enrollment.js';
import { resolveUnitScope } from '../domain/access.js';
import { leadSearchConditions } from '../domain/lead-search.js';
import { getLeadStageBySlug } from '../lib/lead-stage-cache.js';
import { withEnrollmentCodeRetry } from '../lib/enrollment-retry.js';

const router = Router();

// stage agora aceita slug livre (etapas custom criadas pela UI). A validacao
// do slug existir no banco e feita no handler que escreve.
const ListQuerySchema = z.object({
  stage: z.string().max(40).optional(),
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
  // Trim + colapsa whitespace pra evitar duplicatas no dashboard agrupado.
  campaign: z
    .string()
    .max(120)
    .transform((v) => v.trim().replace(/\s+/g, ' '))
    .refine((v) => v.length > 0, { message: 'Campanha vazia.' })
    .optional(),
  source: z.string().min(2).max(80),
});

const UpdateStageSchema = z.object({
  stage: z.string().min(1).max(40),
});

// Conversao termina em aluno matriculado (vende pacote, lead sai do funil)
// ou experimental (cria aluno sem pacote, lead vai pra experimental_agendada).
// CPF e opcional — alguns operadores cadastram antes de ter o documento e
// completam depois pela edicao. Sem CPF, perde-se dedup por cpfHash. Aceita
// string vazia/whitespace como "nao informado" (front pode mandar `cpf: ""`).
const ConvertLeadSchema = z
  .object({
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
        message: 'Pacote e obrigatorio para matricular.',
      });
    }
  });

const conversionErrorMap: Record<string, { status: number; message: string }> = {
  lead_not_found: { status: 404, message: 'Lead nao encontrado.' },
  already_enrolled: { status: 409, message: 'Este lead ja foi convertido em aluno.' },
  package_not_found: { status: 404, message: 'Pacote nao encontrado.' },
  unit_not_found: { status: 404, message: 'Unidade nao encontrada.' },
  cpf_already_used: { status: 409, message: 'Ja existe um aluno com este CPF.' },
  whatsapp_already_used: {
    status: 409,
    message: 'Ja existe um aluno ativo com este WhatsApp.',
  },
};

// Diretor e coordenacao operam o pipeline e precisam do contato real do lead
// (a coordenacao dispara a conversa no WhatsApp a partir dele).
function canViewSensitiveLeadData(roles: Role[]) {
  return roles.includes('diretor') || roles.includes('coordenacao');
}

type LeadWithRelations = Lead & {
  stage?: LeadStage;
  student?: { type: StudentType } | null;
};

function toLeadDto(lead: LeadWithRelations, canViewSensitive: boolean) {
  return {
    id: lead.id,
    name: lead.name,
    whatsapp: canViewSensitive ? lead.whatsapp : maskPhone(lead.whatsapp),
    unitInterest: lead.unitInterest,
    campaign: lead.campaign ?? undefined,
    source: lead.source,
    // Front recebe slug — interface estavel. Quando o include nao traz o
    // stage, busca via cache (raro nos endpoints atuais, mas seguro).
    stage: lead.stage?.slug ?? '',
    // Quando o lead ja virou aluno, o tipo do aluno aparece aqui pro front
    // saber que aquele card e "travado pelo aluno" (Student manda) e mostrar
    // o modal de confirmacao antes de mover. null = lead puro, sem aluno.
    studentType: lead.student?.type ?? null,
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
      ...(query.stage ? { stage: { slug: query.stage } } : {}),
      ...(query.unit ? { unitInterest: query.unit } : {}),
      ...(query.search ? { OR: leadSearchConditions(query.search) } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: offset,
        take: pageSize,
        include: { stage: true, student: { select: { type: true } } },
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
    const novoLeadStage = await getLeadStageBySlug('novo_lead');
    const lead = await prisma.lead.create({
      data: {
        name: input.name,
        whatsapp: input.whatsapp.replace(/\D/g, ''),
        unitInterest: input.unitInterest,
        campaign: input.campaign,
        source: input.source,
        stageId: novoLeadStage.id,
      },
      include: { stage: true, student: { select: { type: true } } },
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
      const lead = await withEnrollmentCodeRetry(() => prisma.$transaction(async (tx) => {
        const targetStage = await tx.leadStage.findUnique({ where: { slug: input.stage } });
        if (!targetStage) {
          throw new ApiError(404, 'stage_not_found', 'Etapa nao encontrada.');
        }

        const updated = await tx.lead.update({
          where: { id: req.params.leadId },
          data: { stageId: targetStage.id },
          include: {
            student: { select: { id: true, type: true, cpfHash: true } },
            stage: true,
          },
        });

        // Ao agendar a aula experimental, o lead vira um aluno experimental
        // (sem pacote/saldo). Se ja existe aluno vinculado, nada a fazer.
        if (input.stage === 'experimental_agendada' && !updated.student) {
          const enrollmentCode = await uniqueEnrollmentCode((code) =>
            tx.student
              .findUnique({ where: { enrollmentCode: code } })
              .then((found) => found !== null),
          );
          const matchedUnit = await tx.unit.findFirst({
            where: { name: updated.unitInterest, active: true },
            select: { id: true },
          });
          await tx.student.create({
            data: {
              leadId: updated.id,
              name: updated.name,
              whatsapp: updated.whatsapp,
              email: updated.email,
              unitId: matchedUnit?.id ?? null,
              enrollmentCode,
              type: 'experimental',
              creditBalance: 0,
            },
          });
        }

        // Recolhimento do experimental orfao: se o lead esta voltando atras
        // (deixou `experimental_agendada` e nao foi pra `matriculado`), e o
        // student vinculado e experimental SEM CPF (sinal de que foi criado
        // automaticamente pelo proprio fluxo), deletamos. Mantemos se ja
        // teve operacao real em cima (CPF preenchido = operador trabalhou).
        const movedAwayFromExperimental =
          input.stage !== 'experimental_agendada' && input.stage !== 'matriculado';
        if (
          movedAwayFromExperimental &&
          updated.student &&
          updated.student.type === 'experimental' &&
          !updated.student.cpfHash
        ) {
          await tx.student.delete({ where: { id: updated.student.id } });
          await tx.auditLog.create({
            data: {
              actorUserId: req.user!.id,
              actorType: 'user',
              entityType: 'student',
              entityId: updated.student.id,
              action: 'student.experimental_recalled',
              before: { leadId: updated.id, fromStage: 'experimental_agendada' },
              after: { toStage: input.stage, reason: 'lead_moved_back' },
            },
          });
        }

        return updated;
      }));
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

    // CPF e opcional: se veio, valida 11 digitos; se nao, persiste sem hash.
    let cpfDigits: string | null = null;
    if (input.cpf) {
      cpfDigits = normalizeCpf(input.cpf);
      if (cpfDigits.length !== 11) {
        throw new ApiError(400, 'invalid_cpf', 'CPF deve ter 11 digitos.');
      }
    }

    const unitScope = resolveUnitScope({ roles: req.user!.roles, unitId: req.user!.unitId });
    if (unitScope && unitScope !== input.unitId) {
      throw new ApiError(403, 'unit_scope', 'Voce so pode matricular alunos na sua unidade.');
    }

    const result = await withEnrollmentCodeRetry(() => prisma.$transaction(async (tx) => {
      const lead = await tx.lead.findUnique({
        where: { id: req.params.leadId },
        include: { student: { select: { id: true, type: true } }, stage: true },
      });
      if (!lead) return { ok: false as const, error: 'lead_not_found' as const };

      const check = canConvertLead({ studentType: lead.student?.type ?? null });
      if (!check.ok) return { ok: false as const, error: check.reason };

      const unit = await tx.unit.findFirst({ where: { id: input.unitId, active: true } });
      if (!unit) return { ok: false as const, error: 'unit_not_found' as const };

      // Pacote e cobrado e creditBalance sobe so na conversao para matriculado.
      // Conversao para experimental cria/atualiza o aluno sem pacote/saldo.
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
        const existingByCpf = await tx.student.findFirst({
          where: { cpfHash: cpfHashValue },
        });
        // Permite reusar o CPF se ja existe um aluno ligado ao MESMO lead
        // (operador apertando converter de novo); caso contrario, dedup.
        if (existingByCpf && existingByCpf.id !== (lead.student?.id ?? null)) {
          return { ok: false as const, error: 'cpf_already_used' as const };
        }
        cpfMaskedValue = maskCpf(cpfDigits) ?? null;
      }

      // Dedup por whatsapp: so se vamos CRIAR student novo (lead nao tem
      // student vinculado). Se ja existe outro student ativo com o mesmo
      // whatsapp, bloqueia — provavel duplicata.
      if (!lead.student) {
        const existingByWhatsapp = await tx.student.findFirst({
          where: { whatsapp: lead.whatsapp, active: true },
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

      // Atualiza o aluno-experimental existente (criado em "experimental_agendada")
      // OU cria do zero se o lead pulou a etapa.
      const enrollmentData = {
        cpfHash: cpfHashValue,
        cpfMasked: cpfMaskedValue,
        unitId: input.unitId,
        type: input.type,
        packageName,
        creditBalance,
        active: true,
      };

      const student = lead.student
        ? await tx.student.update({
            where: { id: lead.student.id },
            data: enrollmentData,
            include: { unit: { select: { name: true } } },
          })
        : await tx.student.create({
            data: {
              leadId: lead.id,
              name: lead.name,
              whatsapp: lead.whatsapp,
              email: lead.email,
              enrollmentCode: await uniqueEnrollmentCode((code) =>
                tx.student
                  .findUnique({ where: { enrollmentCode: code } })
                  .then((found) => found !== null),
              ),
              ...enrollmentData,
            },
            include: { unit: { select: { name: true } } },
          });

      // Stage do lead acompanha o desfecho: matriculado sai do funil,
      // experimental fica em experimental_agendada (continua no pipeline
      // pra ser matriculado depois).
      const nextSlug = input.type === 'matriculado' ? 'matriculado' : 'experimental_agendada';
      const nextStage = await getLeadStageBySlug(nextSlug, tx);
      const previousStageSlug = lead.stage.slug;
      const updatedLead = await tx.lead.update({
        where: { id: lead.id },
        data: { stageId: nextStage.id },
        include: { stage: true, student: { select: { type: true } } },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: req.user!.id,
          actorType: 'user',
          entityType: 'student',
          entityId: student.id,
          action: lead.student ? 'student.enrolled' : 'lead.converted',
          before: { leadId: lead.id, stage: previousStageSlug },
          after: {
            studentId: student.id,
            enrollmentCode: student.enrollmentCode,
            type: input.type,
            packageName,
          },
        },
      });

      return { ok: true as const, student, lead: updatedLead };
    }));

    if (!result.ok) {
      const mapped = conversionErrorMap[result.error] ?? {
        status: 409,
        message: 'Nao foi possivel converter o lead.',
      };
      throw new ApiError(mapped.status, result.error, mapped.message, {
        ...(result.error === 'whatsapp_already_used' && 'existing' in result
          ? { existing: result.existing }
          : {}),
      });
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
