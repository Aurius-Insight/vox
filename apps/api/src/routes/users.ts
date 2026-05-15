import { Router } from 'express';
import bcrypt from 'bcryptjs';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { ApiError, asyncHandler } from '../lib/http.js';
import { checkUserUpdateGuard } from '../domain/users.js';

const router = Router();

const roleValues = ['diretor', 'coordenacao', 'professor'] as const;

const ListQuerySchema = z.object({
  role: z.enum(roleValues).optional(),
});

const CreateUserSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().max(160),
  password: z.string().min(12).max(200),
  roles: z.array(z.enum(roleValues)).min(1),
  subjectId: z.string().optional(),
  unitId: z.string().optional(),
});

const UpdateUserSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    password: z.string().min(12).max(200).optional(),
    roles: z.array(z.enum(roleValues)).min(1).optional(),
    active: z.boolean().optional(),
    subjectId: z.string().nullable().optional(),
    unitId: z.string().nullable().optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'Informe ao menos um campo para atualizar.',
  });

const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  roles: true,
  active: true,
  subjectId: true,
  subject: { select: { id: true, name: true } },
  unitId: true,
  unit: { select: { id: true, name: true } },
  createdAt: true,
} satisfies Prisma.UserSelect;

async function assertSubjectExists(subjectId: string) {
  const subject = await prisma.subject.findFirst({ where: { id: subjectId, active: true } });
  if (!subject) {
    throw new ApiError(404, 'subject_not_found', 'Materia nao encontrada.');
  }
}

async function assertUnitExists(unitId: string) {
  const unit = await prisma.unit.findFirst({ where: { id: unitId, active: true } });
  if (!unit) {
    throw new ApiError(404, 'unit_not_found', 'Unidade nao encontrada.');
  }
}

router.get(
  '/',
  requireAuth,
  requireRole('diretor', 'coordenacao'),
  asyncHandler(async (req, res) => {
    const query = ListQuerySchema.parse(req.query);

    // Com filtro de papel (ex.: dropdown de professores) so traz ativos;
    // sem filtro (tela de gestao) traz todos para permitir reativar.
    const users = await prisma.user.findMany({
      where: query.role ? { roles: { has: query.role }, active: true } : {},
      orderBy: { name: 'asc' },
      select: publicUserSelect,
    });

    res.json({ data: users });
  }),
);

router.post(
  '/',
  requireAuth,
  requireRole('diretor'),
  asyncHandler(async (req, res) => {
    const input = CreateUserSchema.parse(req.body);
    const email = input.email.toLowerCase();

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ApiError(409, 'email_taken', 'Ja existe um usuario com este e-mail.');
    }

    // Decisao da reuniao: "cada professor tem uma materia". Outros papeis
    // nao recebem materia.
    const isProfessor = input.roles.includes('professor');
    let subjectId: string | null = null;
    if (isProfessor) {
      if (!input.subjectId) {
        throw new ApiError(400, 'subject_required', 'Professor precisa de uma materia vinculada.');
      }
      await assertSubjectExists(input.subjectId);
      subjectId = input.subjectId;
    }

    // Unidade vinculada e opcional: define o escopo de permissao por unidade.
    let unitId: string | null = null;
    if (input.unitId) {
      await assertUnitExists(input.unitId);
      unitId = input.unitId;
    }

    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await prisma.user.create({
      data: {
        name: input.name,
        email,
        passwordHash,
        roles: input.roles,
        active: true,
        subjectId,
        unitId,
      },
      select: publicUserSelect,
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: req.user!.id,
        actorType: 'user',
        entityType: 'user',
        entityId: user.id,
        action: 'user.created',
        after: user,
      },
    });

    res.status(201).json({ data: user });
  }),
);

router.patch(
  '/:userId',
  requireAuth,
  requireRole('diretor'),
  asyncHandler(async (req, res) => {
    const input = UpdateUserSchema.parse(req.body);
    const { userId } = req.params;

    const before = await prisma.user.findUnique({
      where: { id: userId },
      select: publicUserSelect,
    });
    if (!before) throw new ApiError(404, 'user_not_found', 'Usuario nao encontrado.');

    const guard = checkUserUpdateGuard({
      isSelf: userId === req.user!.id,
      nextActive: input.active,
      nextRoles: input.roles,
    });
    if (!guard.ok) {
      if (guard.reason === 'self_deactivation') {
        throw new ApiError(400, 'self_deactivation', 'Voce nao pode desativar a propria conta.');
      }
      throw new ApiError(400, 'self_diretor_removal', 'Voce nao pode remover o proprio papel de diretor.');
    }

    const data: Prisma.UserUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.roles !== undefined) data.roles = input.roles;
    if (input.active !== undefined) data.active = input.active;
    if (input.password !== undefined) data.passwordHash = await bcrypt.hash(input.password, 12);
    if (input.subjectId !== undefined) {
      if (input.subjectId === null) {
        data.subject = { disconnect: true };
      } else {
        await assertSubjectExists(input.subjectId);
        data.subject = { connect: { id: input.subjectId } };
      }
    }
    if (input.unitId !== undefined) {
      if (input.unitId === null) {
        data.unit = { disconnect: true };
      } else {
        await assertUnitExists(input.unitId);
        data.unit = { connect: { id: input.unitId } };
      }
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data,
      select: publicUserSelect,
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: req.user!.id,
        actorType: 'user',
        entityType: 'user',
        entityId: user.id,
        action: 'user.updated',
        before,
        after: user,
      },
    });

    res.json({ data: user });
  }),
);

export default router;
