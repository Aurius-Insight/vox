import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { ApiError, asyncHandler } from '../lib/http.js';

const router = Router();

const CreatePackageSchema = z.object({
  name: z.string().min(2).max(120),
  classCount: z.number().int().min(1).max(1000),
  priceCents: z.number().int().min(0).max(100_000_000),
  validityDays: z.number().int().min(0).max(3650),
});

// O PATCH edita o pacote no lugar: nome, quantidade de aulas, preco, validade
// e status. Editar o preco aqui sobrescreve o registro — para preservar o
// historico de precos, cria-se um pacote novo via POST.
const UpdatePackageSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    classCount: z.number().int().min(1).max(1000).optional(),
    priceCents: z.number().int().min(0).max(100_000_000).optional(),
    validityDays: z.number().int().min(0).max(3650).optional(),
    active: z.boolean().optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'Informe ao menos um campo para atualizar.',
  });

// Coordenacao le o catalogo (precisa dele para converter lead em aluno);
// criar e editar pacote/preco continua exclusivo do diretor.
router.get(
  '/',
  requireAuth,
  requireRole('diretor', 'coordenacao'),
  asyncHandler(async (_req, res) => {
    const packages = await prisma.package.findMany({
      orderBy: [{ active: 'desc' }, { effectiveFrom: 'desc' }],
    });
    res.json({ data: packages });
  }),
);

router.post(
  '/',
  requireAuth,
  requireRole('diretor'),
  asyncHandler(async (req, res) => {
    const input = CreatePackageSchema.parse(req.body);

    // Alteracao de preco cria um novo pacote vigente a partir de agora;
    // o historico anterior nao e reescrito.
    const created = await prisma.package.create({
      data: {
        name: input.name,
        classCount: input.classCount,
        priceCents: input.priceCents,
        validityDays: input.validityDays,
        effectiveFrom: new Date(),
      },
    });

    res.status(201).json({ data: created });
  }),
);

router.patch(
  '/:packageId',
  requireAuth,
  requireRole('diretor'),
  asyncHandler(async (req, res) => {
    const input = UpdatePackageSchema.parse(req.body);

    const before = await prisma.package.findUnique({ where: { id: req.params.packageId } });
    if (!before) throw new ApiError(404, 'package_not_found', 'Pacote nao encontrado.');

    const data: Prisma.PackageUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.classCount !== undefined) data.classCount = input.classCount;
    if (input.priceCents !== undefined) data.priceCents = input.priceCents;
    if (input.validityDays !== undefined) data.validityDays = input.validityDays;
    if (input.active !== undefined) data.active = input.active;

    const updated = await prisma.package.update({
      where: { id: req.params.packageId },
      data,
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: req.user!.id,
        actorType: 'user',
        entityType: 'package',
        entityId: updated.id,
        action: 'package.updated',
        before,
        after: updated,
      },
    });

    res.json({ data: updated });
  }),
);

// Exclusao definitiva. A pedido do produto, qualquer pacote pode ser apagado —
// inclusive os ja usados por alunos (Student guarda o nome do pacote como texto,
// entao nao ha quebra de integridade). O auditLog preserva o registro removido.
router.delete(
  '/:packageId',
  requireAuth,
  requireRole('diretor'),
  asyncHandler(async (req, res) => {
    const before = await prisma.package.findUnique({ where: { id: req.params.packageId } });
    if (!before) throw new ApiError(404, 'package_not_found', 'Pacote nao encontrado.');

    await prisma.package.delete({ where: { id: req.params.packageId } });

    await prisma.auditLog.create({
      data: {
        actorUserId: req.user!.id,
        actorType: 'user',
        entityType: 'package',
        entityId: before.id,
        action: 'package.deleted',
        before,
      },
    });

    res.json({ data: { id: before.id } });
  }),
);

export default router;
