import { Router } from 'express';
import type { LeadStage, LeadStageKind } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { ApiError, asyncHandler } from '../lib/http.js';
import { invalidateLeadStageCache } from '../lib/lead-stage-cache.js';
import {
  resolveStageArchive,
  resolveStageCreate,
  resolveStageDelete,
  validateStageReorder,
} from '../domain/stage-config.js';

const router = Router();

const SLUG_REGEX = /^[a-z0-9_]+$/;
const COLOR_REGEX = /^#[0-9a-f]{6}$/i;
const KIND_VALUES: LeadStageKind[] = ['active', 'won', 'lost'];

const CreateStageSchema = z.object({
  label: z.string().min(1).max(80),
  slug: z.string().min(1).max(40).regex(SLUG_REGEX).optional(),
  color: z.string().regex(COLOR_REGEX).nullable().optional(),
  kind: z.enum(KIND_VALUES as [LeadStageKind, ...LeadStageKind[]]).optional(),
  order: z.number().int().min(1).optional(),
});

const UpdateStageSchema = z
  .object({
    label: z.string().min(1).max(80).optional(),
    color: z.string().regex(COLOR_REGEX).nullable().optional(),
    visible: z.boolean().optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'Informe ao menos um campo para atualizar.',
  });

const ArchiveStageSchema = z.object({
  moveLeadsTo: z.string().optional(),
});

const ReorderSchema = z.object({
  order: z.array(z.object({ id: z.string(), order: z.number().int().min(1) })).min(1),
});

function toDto(row: LeadStage) {
  return {
    id: row.id,
    slug: row.slug,
    label: row.label,
    color: row.color,
    order: row.order,
    kind: row.kind,
    systemic: row.systemic,
    archived: row.archived,
    // Mantem `visible` no DTO pro front continuar usando o nome conhecido
    // (apresentacao). archived=true -> visible=false e vice-versa.
    visible: !row.archived,
  };
}

function slugify(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

router.get(
  '/',
  requireAuth,
  requireRole('diretor', 'coordenacao', 'professor'),
  asyncHandler(async (_req, res) => {
    const stages = await prisma.leadStage.findMany({ orderBy: { order: 'asc' } });
    res.json({ data: stages.map(toDto) });
  }),
);

router.post(
  '/',
  requireAuth,
  requireRole('diretor'),
  asyncHandler(async (req, res) => {
    const input = CreateStageSchema.parse(req.body);

    const result = await prisma.$transaction(async (tx) => {
      const all = await tx.leadStage.findMany({ orderBy: { order: 'asc' } });
      const baseSlug = input.slug ?? slugify(input.label);
      if (!baseSlug) return { ok: false as const, error: 'invalid_slug' as const };

      const decision = resolveStageCreate({
        label: input.label,
        slug: baseSlug,
        existingSlugs: all.map((s) => s.slug),
        existingOrders: all.map((s) => s.order),
        kind: input.kind ?? 'active',
      });
      if (!decision.ok) return { ok: false as const, error: decision.reason };

      const nextOrder = input.order ?? Math.max(0, ...all.map((s) => s.order)) + 1;
      // Se o usuario pediu order explicita que ja existe, abre espaco.
      if (input.order !== undefined && all.some((s) => s.order === input.order)) {
        await openOrderSpace(tx, input.order);
      }

      const created = await tx.leadStage.create({
        data: {
          slug: baseSlug,
          label: input.label,
          color: input.color ?? null,
          order: nextOrder,
          kind: input.kind ?? 'active',
          systemic: false,
          archived: false,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: req.user!.id,
          actorType: 'user',
          entityType: 'lead_stage',
          entityId: created.id,
          action: 'stage.created',
          after: { slug: created.slug, label: created.label, kind: created.kind, order: created.order },
        },
      });

      return { ok: true as const, created };
    });

    if (!result.ok) {
      const map: Record<string, { status: number; message: string }> = {
        invalid_slug: { status: 400, message: 'Slug invalido (use letras, numeros e _).' },
        slug_taken: { status: 409, message: 'Ja existe etapa com esse slug.' },
        invalid_label: { status: 400, message: 'Nome da etapa invalido.' },
      };
      const mapped = map[result.error] ?? { status: 400, message: 'Nao foi possivel criar a etapa.' };
      throw new ApiError(mapped.status, result.error, mapped.message);
    }

    invalidateLeadStageCache();
    res.status(201).json({ data: toDto(result.created) });
  }),
);

router.patch(
  '/:idOrSlug',
  requireAuth,
  requireRole('diretor'),
  asyncHandler(async (req, res) => {
    const input = UpdateStageSchema.parse(req.body);
    const target = await findByIdOrSlug(req.params.idOrSlug);
    if (!target) throw new ApiError(404, 'stage_not_found', 'Etapa nao encontrada.');

    if (input.visible === false && target.systemic) {
      throw new ApiError(
        400,
        'systemic_stage',
        'Etapa sistemica nao pode ser ocultada. Use o endpoint de archive.',
      );
    }

    const updated = await prisma.leadStage.update({
      where: { id: target.id },
      data: {
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.visible !== undefined ? { archived: !input.visible } : {}),
      },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: req.user!.id,
        actorType: 'user',
        entityType: 'lead_stage',
        entityId: target.id,
        action: 'stage.updated',
        before: { label: target.label, color: target.color, archived: target.archived },
        after: { label: updated.label, color: updated.color, archived: updated.archived },
      },
    });

    invalidateLeadStageCache();
    res.json({ data: toDto(updated) });
  }),
);

router.post(
  '/:idOrSlug/archive',
  requireAuth,
  requireRole('diretor'),
  asyncHandler(async (req, res) => {
    const input = ArchiveStageSchema.parse(req.body);

    const result = await prisma.$transaction(async (tx) => {
      const target = await findByIdOrSlug(req.params.idOrSlug, tx);
      if (!target) return { ok: false as const, error: 'stage_not_found' as const };

      const leadsInStage = await tx.lead.count({ where: { stageId: target.id } });

      const destination = input.moveLeadsTo
        ? await findByIdOrSlug(input.moveLeadsTo, tx)
        : null;

      const decision = resolveStageArchive({
        target: { slug: target.slug, systemic: target.systemic, archived: target.archived },
        leadsInStage,
        destination: destination ? { id: destination.id, archived: destination.archived } : null,
        sameStage: destination?.id === target.id,
      });
      if (!decision.ok) return { ok: false as const, error: decision.reason };

      let movedCount = 0;
      if (decision.moveLeads) {
        const moveResult = await tx.lead.updateMany({
          where: { stageId: target.id },
          data: { stageId: decision.destinationId },
        });
        movedCount = moveResult.count;
      }

      const updated = await tx.leadStage.update({
        where: { id: target.id },
        data: { archived: true, archivedAt: new Date() },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: req.user!.id,
          actorType: 'user',
          entityType: 'lead_stage',
          entityId: target.id,
          action: 'stage.archived',
          before: { archived: false, leadsInStage },
          after: {
            archived: true,
            movedTo: decision.moveLeads ? decision.destinationId : null,
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
          message: 'A etapa tem leads — informe `moveLeadsTo`.',
        },
        destination_not_found: { status: 404, message: 'Etapa de destino nao encontrada.' },
        destination_archived: { status: 400, message: 'Etapa de destino esta arquivada.' },
        destination_same_as_source: {
          status: 400,
          message: 'Destino nao pode ser a propria etapa que sera arquivada.',
        },
        already_archived: { status: 400, message: 'Etapa ja esta arquivada.' },
      };
      const mapped = map[result.error] ?? { status: 400, message: 'Operacao invalida.' };
      throw new ApiError(mapped.status, result.error, mapped.message);
    }

    invalidateLeadStageCache();
    res.json({ data: { ...toDto(result.updated), movedCount: result.movedCount } });
  }),
);

router.post(
  '/:idOrSlug/restore',
  requireAuth,
  requireRole('diretor'),
  asyncHandler(async (req, res) => {
    const target = await findByIdOrSlug(req.params.idOrSlug);
    if (!target) throw new ApiError(404, 'stage_not_found', 'Etapa nao encontrada.');

    const updated = await prisma.leadStage.update({
      where: { id: target.id },
      data: { archived: false, archivedAt: null },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: req.user!.id,
        actorType: 'user',
        entityType: 'lead_stage',
        entityId: target.id,
        action: 'stage.restored',
        after: { archived: false },
      },
    });

    invalidateLeadStageCache();
    res.json({ data: toDto(updated) });
  }),
);

router.delete(
  '/:idOrSlug',
  requireAuth,
  requireRole('diretor'),
  asyncHandler(async (req, res) => {
    const input = ArchiveStageSchema.parse(req.query.moveLeadsTo ? req.query : req.body ?? {});

    const result = await prisma.$transaction(async (tx) => {
      const target = await findByIdOrSlug(req.params.idOrSlug, tx);
      if (!target) return { ok: false as const, error: 'stage_not_found' as const };

      const leadsInStage = await tx.lead.count({ where: { stageId: target.id } });
      const destination = input.moveLeadsTo ? await findByIdOrSlug(input.moveLeadsTo, tx) : null;

      const decision = resolveStageDelete({
        target: { slug: target.slug, systemic: target.systemic },
        leadsInStage,
        destination: destination ? { id: destination.id, archived: destination.archived } : null,
        sameStage: destination?.id === target.id,
      });
      if (!decision.ok) return { ok: false as const, error: decision.reason };

      let movedCount = 0;
      if (decision.moveLeads) {
        const moveResult = await tx.lead.updateMany({
          where: { stageId: target.id },
          data: { stageId: decision.destinationId },
        });
        movedCount = moveResult.count;
      }

      await tx.leadStage.delete({ where: { id: target.id } });

      await tx.auditLog.create({
        data: {
          actorUserId: req.user!.id,
          actorType: 'user',
          entityType: 'lead_stage',
          entityId: target.id,
          action: 'stage.deleted',
          before: { slug: target.slug, label: target.label, leadsInStage },
          after: { movedTo: decision.moveLeads ? decision.destinationId : null, movedCount },
        },
      });

      return { ok: true as const, movedCount };
    });

    if (!result.ok) {
      const map: Record<string, { status: number; message: string }> = {
        stage_not_found: { status: 404, message: 'Etapa nao encontrada.' },
        systemic_stage: { status: 400, message: 'Etapa sistemica nao pode ser excluida.' },
        destination_required: {
          status: 400,
          message: 'A etapa tem leads — informe `moveLeadsTo`.',
        },
        destination_not_found: { status: 404, message: 'Etapa de destino nao encontrada.' },
        destination_archived: { status: 400, message: 'Etapa de destino esta arquivada.' },
        destination_same_as_source: {
          status: 400,
          message: 'Destino nao pode ser a propria etapa que sera excluida.',
        },
      };
      const mapped = map[result.error] ?? { status: 400, message: 'Operacao invalida.' };
      throw new ApiError(mapped.status, result.error, mapped.message);
    }

    invalidateLeadStageCache();
    res.json({ data: { movedCount: result.movedCount } });
  }),
);

router.post(
  '/reorder',
  requireAuth,
  requireRole('diretor'),
  asyncHandler(async (req, res) => {
    const input = ReorderSchema.parse(req.body);
    const current = await prisma.leadStage.findMany({ orderBy: { order: 'asc' } });

    const check = validateStageReorder({
      currentIds: current.map((s) => s.id),
      newOrder: input.order,
    });
    if (!check.ok) {
      const map: Record<string, string> = {
        incomplete: 'A lista nao cobre todas as etapas.',
        duplicate_order: 'Ha ordens duplicadas.',
        unknown_stage: 'Etapa desconhecida na lista.',
      };
      throw new ApiError(400, check.reason, map[check.reason] ?? 'Reorder invalido.');
    }

    await prisma.$transaction(async (tx) => {
      // 1a passada: joga todos pra ordens negativas (evita colisao @@unique).
      let temp = -1;
      for (const stage of current) {
        await tx.leadStage.update({ where: { id: stage.id }, data: { order: temp } });
        temp -= 1;
      }
      // 2a passada: aplica a ordem nova.
      for (const item of input.order) {
        await tx.leadStage.update({ where: { id: item.id }, data: { order: item.order } });
      }
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: req.user!.id,
        actorType: 'user',
        entityType: 'lead_stage',
        entityId: 'reorder',
        action: 'stage.reordered',
        after: { order: input.order },
      },
    });

    invalidateLeadStageCache();
    const updated = await prisma.leadStage.findMany({ orderBy: { order: 'asc' } });
    res.json({ data: updated.map(toDto) });
  }),
);

// Helpers internos -----------------------------------------------------------

type TxLike = Pick<typeof prisma, 'leadStage'>;

async function findByIdOrSlug(idOrSlug: string, tx?: TxLike): Promise<LeadStage | null> {
  const db = tx ?? prisma;
  // Tenta por slug primeiro (mais legivel/comum nos PATCH); cai pra id se nao
  // encontrar. Slugs sao unicos, ids tambem — sem ambiguidade.
  const bySlug = await db.leadStage.findUnique({ where: { slug: idOrSlug } });
  if (bySlug) return bySlug;
  return db.leadStage.findUnique({ where: { id: idOrSlug } });
}

async function openOrderSpace(
  tx: { leadStage: { findMany: typeof prisma.leadStage.findMany; update: typeof prisma.leadStage.update } },
  startingOrder: number,
): Promise<void> {
  const toShift = await tx.leadStage.findMany({
    where: { order: { gte: startingOrder } },
    orderBy: { order: 'desc' },
  });
  let temp = -1;
  for (const stage of toShift) {
    await tx.leadStage.update({ where: { id: stage.id }, data: { order: temp } });
    temp -= 1;
  }
  for (const stage of toShift) {
    await tx.leadStage.update({ where: { id: stage.id }, data: { order: stage.order + 1 } });
  }
}

export default router;
