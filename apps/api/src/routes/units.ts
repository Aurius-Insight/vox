import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { ApiError, asyncHandler } from '../lib/http.js';

const router = Router();

const VIEW_ROLES = ['diretor', 'coordenacao'] as const;
const MANAGE_ROLES = ['diretor', 'coordenacao'] as const;

// Address e phone tolerantes a string vazia = "nao preenchido" — operador
// cadastra com so o nome e completa depois pela UI.
const CreateUnitSchema = z.object({
  name: z.string().min(2).max(120),
  address: z.string().max(200).optional().default(''),
  phone: z.string().max(40).optional(),
  capacity: z.number().int().min(0).max(10_000).optional().default(0),
});

const UpdateUnitSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    address: z.string().max(200).optional(),
    phone: z.string().max(40).nullable().optional(),
    capacity: z.number().int().min(0).max(10_000).optional(),
    active: z.boolean().optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'Informe ao menos um campo para atualizar.',
  });

router.get(
  '/',
  requireAuth,
  requireRole(...VIEW_ROLES),
  asyncHandler(async (_req, res) => {
    const units = await prisma.unit.findMany({ orderBy: { name: 'asc' } });
    res.json({ data: units });
  }),
);

router.post(
  '/',
  requireAuth,
  requireRole(...MANAGE_ROLES),
  asyncHandler(async (req, res) => {
    const input = CreateUnitSchema.parse(req.body);
    const unit = await prisma.unit.create({ data: input });
    res.status(201).json({ data: unit });
  }),
);

router.patch(
  '/:unitId',
  requireAuth,
  requireRole(...MANAGE_ROLES),
  asyncHandler(async (req, res) => {
    const input = UpdateUnitSchema.parse(req.body);

    try {
      const unit = await prisma.unit.update({
        where: { id: req.params.unitId },
        data: input,
      });
      res.json({ data: unit });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ApiError(404, 'unit_not_found', 'Unidade nao encontrada.');
      }
      throw error;
    }
  }),
);

export default router;
