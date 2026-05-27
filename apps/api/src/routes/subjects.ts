import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { ApiError, asyncHandler } from '../lib/http.js';

const router = Router();

const VIEW_ROLES = ['diretor', 'coordenacao'] as const;
const MANAGE_ROLES = ['diretor'] as const;

const CreateSubjectSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(2000).optional(),
});

const UpdateSubjectSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    description: z.string().max(2000).nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'Informe ao menos um campo para atualizar.',
  });

// GET aberto pra coordenacao tambem (precisa pra escolher materia ao criar
// aula). Por padrao traz so ativas; ?includeArchived=1 traz todas — usado
// no painel de Configuracoes.
router.get(
  '/',
  requireAuth,
  requireRole(...VIEW_ROLES),
  asyncHandler(async (req, res) => {
    const includeArchived = req.query.includeArchived === '1';
    const subjects = await prisma.subject.findMany({
      where: includeArchived ? {} : { active: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        description: true,
        active: true,
        createdAt: true,
      },
    });
    res.json({ data: subjects });
  }),
);

router.post(
  '/',
  requireAuth,
  requireRole(...MANAGE_ROLES),
  asyncHandler(async (req, res) => {
    const input = CreateSubjectSchema.parse(req.body);
    try {
      const subject = await prisma.subject.create({
        data: { name: input.name, description: input.description ?? null },
      });
      res.status(201).json({ data: subject });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApiError(409, 'subject_duplicate', 'Ja existe uma materia com esse nome.');
      }
      throw error;
    }
  }),
);

router.patch(
  '/:subjectId',
  requireAuth,
  requireRole(...MANAGE_ROLES),
  asyncHandler(async (req, res) => {
    const input = UpdateSubjectSchema.parse(req.body);
    const data: Prisma.SubjectUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.active !== undefined) data.active = input.active;

    try {
      const subject = await prisma.subject.update({
        where: { id: req.params.subjectId },
        data,
      });
      res.json({ data: subject });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') {
          throw new ApiError(404, 'subject_not_found', 'Materia nao encontrada.');
        }
        if (error.code === 'P2002') {
          throw new ApiError(409, 'subject_duplicate', 'Ja existe uma materia com esse nome.');
        }
      }
      throw error;
    }
  }),
);

// DELETE so e permitido quando nada depende da materia (professor vinculado
// ou ClassSession historica). No fluxo normal o operador arquiva (active=false)
// em vez de remover.
router.delete(
  '/:subjectId',
  requireAuth,
  requireRole(...MANAGE_ROLES),
  asyncHandler(async (req, res) => {
    const subjectId = req.params.subjectId;
    const [teacherCount, sessionCount] = await Promise.all([
      prisma.user.count({ where: { subjectId } }),
      prisma.classSession.count({ where: { subjectId } }),
    ]);
    if (teacherCount > 0 || sessionCount > 0) {
      throw new ApiError(
        409,
        'subject_in_use',
        `Materia em uso (professores=${teacherCount}, aulas=${sessionCount}). Arquive ao inves de excluir.`,
      );
    }
    try {
      await prisma.subject.delete({ where: { id: subjectId } });
      res.status(204).end();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ApiError(404, 'subject_not_found', 'Materia nao encontrada.');
      }
      throw error;
    }
  }),
);

export default router;
