import { Router } from 'express';
import bcrypt from 'bcryptjs';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { ApiError, asyncHandler } from '../lib/http.js';
import { checkUserUpdateGuard } from '../domain/users.js';
import {
  buildTeacherTimeline,
  computeTeacherKpis,
  type ClassSessionSnapshot,
  type PunctualityDelay,
  type TeacherAttendanceSnapshot,
} from '../domain/teacher-history.js';

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

const TeachingHistoryQuerySchema = z.object({
  since: z.string().datetime().optional(),
});

const TEACHING_HISTORY_DEFAULT_WINDOW_DAYS = 30;
const TEACHING_HISTORY_MAX_ITEMS = 500;

// Perfil do professor (KPIs + timeline). O endpoint vive em /api/users porque
// professor e um User com role 'professor' — evita criar um router paralelo
// duplicando autenticacao. Devolve 404 se o usuario nao for professor.
router.get(
  '/:userId/teaching-history',
  requireAuth,
  requireRole('diretor', 'coordenacao'),
  asyncHandler(async (req, res) => {
    const query = TeachingHistoryQuerySchema.parse(req.query);
    const now = new Date();
    const since = query.since
      ? new Date(query.since)
      : new Date(now.getTime() - TEACHING_HISTORY_DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const windowDays = Math.max(
      1,
      Math.ceil((now.getTime() - since.getTime()) / (24 * 60 * 60 * 1000)),
    );

    const teacher = await prisma.user.findUnique({
      where: { id: req.params.userId },
      select: publicUserSelect,
    });

    if (!teacher || !teacher.roles.includes('professor')) {
      throw new ApiError(404, 'teacher_not_found', 'Professor nao encontrado.');
    }

    const [sessions, attendances, punctuality, nextSession] = await Promise.all([
      prisma.classSession.findMany({
        where: { teacherUserId: teacher.id, startsAt: { gte: since } },
        orderBy: { startsAt: 'desc' },
        take: TEACHING_HISTORY_MAX_ITEMS,
        select: {
          id: true,
          startsAt: true,
          endsAt: true,
          canceledAt: true,
          capacity: true,
          subject: { select: { name: true } },
          unit: { select: { name: true } },
        },
      }),
      prisma.attendance.findMany({
        where: {
          markedAt: { gte: since },
          classSession: { teacherUserId: teacher.id },
        },
        orderBy: { markedAt: 'desc' },
        take: TEACHING_HISTORY_MAX_ITEMS,
        select: {
          studentId: true,
          classSessionId: true,
          status: true,
          markedAt: true,
        },
      }),
      prisma.attendance.findMany({
        where: { markedByUserId: teacher.id, markedAt: { gte: since } },
        orderBy: { markedAt: 'desc' },
        take: TEACHING_HISTORY_MAX_ITEMS,
        select: { markedAt: true, classSession: { select: { endsAt: true } } },
      }),
      prisma.classSession.findFirst({
        where: {
          teacherUserId: teacher.id,
          canceledAt: null,
          startsAt: { gte: now },
        },
        orderBy: { startsAt: 'asc' },
        select: { startsAt: true },
      }),
    ]);

    const sessionsInWindow: ClassSessionSnapshot[] = sessions.map((s) => ({
      id: s.id,
      subjectName: s.subject?.name ?? null,
      unitName: s.unit?.name ?? null,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      canceledAt: s.canceledAt,
      capacity: s.capacity,
    }));

    const attendancesInWindow: TeacherAttendanceSnapshot[] = attendances.map((a) => ({
      studentId: a.studentId,
      sessionId: a.classSessionId,
      status: a.status,
      markedAt: a.markedAt,
    }));

    const punctualityDelays: PunctualityDelay[] = punctuality.map((p) => ({
      markedAt: p.markedAt,
      sessionEndsAt: p.classSession.endsAt,
    }));

    const kpis = computeTeacherKpis({
      now,
      windowDays,
      sessionsInWindow,
      attendancesInWindow,
      punctualityDelays,
      nextSessionAt: nextSession?.startsAt ?? null,
    });

    const timeline = buildTeacherTimeline({
      now,
      sessions: sessionsInWindow,
      attendancesBySession: attendancesInWindow,
    });

    res.json({
      data: {
        teacher,
        windowDays,
        since: since.toISOString(),
        kpis,
        timeline,
      },
    });
  }),
);

export default router;
