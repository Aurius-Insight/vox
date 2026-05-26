import { Router } from 'express';
import type { LeadStage } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { ApiError, asyncHandler } from '../lib/http.js';
import {
  resolveStageArchive,
  validateStageReorder,
  type LeadStageSlug,
  type StageConfigInput,
} from '../domain/stage-config.js';

const router = Router();

const stageEnumValues: LeadStage[] = [
  'novo_lead',
  'em_atendimento',
  'pre_agendamento',
  'experimental_agendada',
  'matriculado',
  'perdido',
];
const stageEnumSchema = z.enum(stageEnumValues as [LeadStage, ...LeadStage[]]);

const UpdateStageSchema = z
  .object({
    label: z.string().min(1).max(80).optional(),
    color: z.string().regex(/^#[0-9a-f]{6}$/i).nullable().optional(),
    visible: z.boolean().optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'Informe ao menos um campo para atualizar.',
  });

const ArchiveStageSchema = z.object({
  moveLeadsTo: stageEnumSchema.optional(),
});

const ReorderSchema = z.object({
  order: z.array(z.object({ stage: stageEnumSchema, order: z.number().int().min(1) })).min(1),
});

function toDto(row: {
  stage: LeadStage;
  label: string;
  color: string | null;
  order: number;
  visible: boolean;
  systemic: boolean;
}) {
  return {
    stage: row.stage,
    label: row.label,
    color: row.color,
    order: row.order,
    visible: row.visible,
    systemic: row.systemic,
  };
}

function toDomainInput(row: {
  stage: LeadStage;
  label: string;
  color: string | null;
  order: number;
  visible: boolean;
  systemic: boolean;
}): StageConfigInput {
  return {
    stage: row.stage as LeadStageSlug,
    label: row.label,
    color: row.color,
    order: row.order,
    visible: row.visible,
    systemic: row.systemic,
  };
}

// Lista publica (diretor + coordenacao + professor leem; sao usadas no
// Kanban e em selects). So diretor escreve — endpoints PATCH/POST exigem.
router.get(
  '/',
  requireAuth,
  requireRole('diretor', 'coordenacao', 'professor'),
  asyncHandler(async (_req, res) => {
    const stages = await prisma.stageConfig.findMany({
      orderBy: { order: 'asc' },
    });
    res.json({ data: stages.map(toDto) });
  }),
);

router.patch(
  '/:stage',
  requireAuth,
  requireRole('diretor'),
  asyncHandler(async (req, res) => {
    const stageParam = stageEnumSchema.parse(req.params.stage);
    const input = UpdateStageSchema.parse(req.body);

    const before = await prisma.stageConfig.findUnique({ where: { stage: stageParam } });
    if (!before) throw new ApiError(404, 'stage_not_found', 'Etapa nao encontrada.');

    if (input.visible === false && before.systemic) {
      throw new ApiError(
        400,
        'systemic_stage',
        'Etapa sistemica nao pode ser ocultada. Use o endpoint de archive.',
      );
    }

    const updated = await prisma.stageConfig.update({
      where: { stage: stageParam },
      data: {
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.visible !== undefined ? { visible: input.visible } : {}),
      },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: req.user!.id,
        actorType: 'user',
        entityType: 'stage_config',
        entityId: stageParam,
        action: 'stage.updated',
        before: { label: before.label, color: before.color, visible: before.visible },
        after: { label: updated.label, color: updated.color, visible: updated.visible },
      },
    });

    res.json({ data: toDto(updated) });
  }),
);

// Arquiva (oculta) uma etapa. Se houver leads, exige `moveLeadsTo` no
// body — bulk move + flag em transacao. Sistemicos bloqueados.
router.post(
  '/:stage/archive',
  requireAuth,
  requireRole('diretor'),
  asyncHandler(async (req, res) => {
    const stageParam = stageEnumSchema.parse(req.params.stage);
    const input = ArchiveStageSchema.parse(req.body);

    const result = await prisma.$transaction(async (tx) => {
      const target = await tx.stageConfig.findUnique({ where: { stage: stageParam } });
      if (!target) return { ok: false as const, error: 'stage_not_found' as const };

      const leadsInStage = await tx.lead.count({ where: { stage: stageParam } });

      const destinationConfig = input.moveLeadsTo
        ? await tx.stageConfig.findUnique({ where: { stage: input.moveLeadsTo } })
        : null;

      const decision = resolveStageArchive({
        target: toDomainInput(target),
        leadsInStage,
        destination: (input.moveLeadsTo ?? null) as LeadStageSlug | null,
        destinationConfig: destinationConfig ? toDomainInput(destinationConfig) : null,
      });

      if (!decision.ok) return { ok: false as const, error: decision.reason };

      let movedCount = 0;
      if (decision.moveLeads) {
        const moveResult = await tx.lead.updateMany({
          where: { stage: stageParam },
          data: { stage: decision.destination as LeadStage },
        });
        movedCount = moveResult.count;
      }

      const updated = await tx.stageConfig.update({
        where: { stage: stageParam },
        data: { visible: false },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: req.user!.id,
          actorType: 'user',
          entityType: 'stage_config',
          entityId: stageParam,
          action: 'stage.archived',
          before: { visible: true, leadsInStage },
          after: {
            visible: false,
            movedTo: decision.moveLeads ? decision.destination : null,
            movedCount,
          },
        },
      });

      return { ok: true as const, updated, movedCount };
    });

    if (!result.ok) {
      const map: Record<string, { status: number; message: string }> = {
        stage_not_found: { status: 404, message: 'Etapa nao encontrada.' },
        systemic_stage: { status: 400, message: 'Etapa sistemica nao pode ser arquivada.' },
        destination_required: {
          status: 400,
          message: 'A etapa tem leads — informe `moveLeadsTo` para mover os leads.',
        },
        destination_not_found: { status: 404, message: 'Etapa de destino nao encontrada.' },
        destination_archived: { status: 400, message: 'Etapa de destino esta arquivada.' },
        destination_same_as_source: {
          status: 400,
          message: 'Destino nao pode ser a propria etapa que sera arquivada.',
        },
      };
      const mapped = map[result.error] ?? { status: 400, message: 'Operacao invalida.' };
      throw new ApiError(mapped.status, result.error, mapped.message);
    }

    res.json({ data: { ...toDto(result.updated), movedCount: result.movedCount } });
  }),
);

router.post(
  '/:stage/restore',
  requireAuth,
  requireRole('diretor'),
  asyncHandler(async (req, res) => {
    const stageParam = stageEnumSchema.parse(req.params.stage);

    const updated = await prisma.stageConfig.update({
      where: { stage: stageParam },
      data: { visible: true },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: req.user!.id,
        actorType: 'user',
        entityType: 'stage_config',
        entityId: stageParam,
        action: 'stage.restored',
        after: { visible: true },
      },
    });

    res.json({ data: toDto(updated) });
  }),
);

router.post(
  '/reorder',
  requireAuth,
  requireRole('diretor'),
  asyncHandler(async (req, res) => {
    const input = ReorderSchema.parse(req.body);

    const current = await prisma.stageConfig.findMany({ orderBy: { order: 'asc' } });

    const check = validateStageReorder({
      current: current.map(toDomainInput),
      newOrder: input.order.map((o) => ({ stage: o.stage as LeadStageSlug, order: o.order })),
    });
    if (!check.ok) {
      const map: Record<string, string> = {
        incomplete: 'A lista nao cobre todas as etapas.',
        duplicate_order: 'Ha ordens duplicadas na lista.',
        unknown_stage: 'Etapa desconhecida na lista.',
      };
      throw new ApiError(400, check.reason, map[check.reason] ?? 'Reorder invalido.');
    }

    // Postgres exige ordens unicas. Pra evitar colisao no @@unique([order]),
    // primeiro joga todas pra um espaco negativo, depois reposiciona.
    await prisma.$transaction(async (tx) => {
      let temp = -1;
      for (const stage of current) {
        await tx.stageConfig.update({
          where: { stage: stage.stage },
          data: { order: temp },
        });
        temp -= 1;
      }
      for (const item of input.order) {
        await tx.stageConfig.update({
          where: { stage: item.stage as LeadStage },
          data: { order: item.order },
        });
      }
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: req.user!.id,
        actorType: 'user',
        entityType: 'stage_config',
        entityId: 'reorder',
        action: 'stage.reordered',
        after: { order: input.order },
      },
    });

    const updated = await prisma.stageConfig.findMany({ orderBy: { order: 'asc' } });
    res.json({ data: updated.map(toDto) });
  }),
);

export default router;
