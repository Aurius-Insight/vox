import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db/client.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { ApiError, asyncHandler, maskPhone } from '../lib/http.js';
import { isProfessorScoped, resolveUnitScope } from '../domain/access.js';

const router = Router();

const AttendanceSchema = z.object({
  studentId: z.string().min(1),
  status: z.enum(['presente', 'no_show']),
});

const CreateClassSchema = z.object({
  isGuest: z.boolean().default(false),
  subjectId: z.string().optional(),
  teacherUserId: z.string().optional(),
  unitId: z.string().min(1),
  room: z.string().min(1).max(80),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  capacity: z.number().int().min(1).max(200),
});

const classInclude = {
  subject: { select: { id: true, name: true } },
  unit: { select: { id: true, name: true } },
  teacher: { select: { id: true, name: true } },
  bookings: {
    where: { status: 'agendado' },
    include: { student: true },
  },
} satisfies Prisma.ClassSessionInclude;

type ClassWithRelations = Prisma.ClassSessionGetPayload<{ include: typeof classInclude }>;

async function listClasses(filter: { teacherUserId?: string; unitId?: string }) {
  return prisma.classSession.findMany({
    where: {
      ...(filter.teacherUserId ? { teacherUserId: filter.teacherUserId } : {}),
      ...(filter.unitId ? { unitId: filter.unitId } : {}),
    },
    orderBy: { startsAt: 'asc' },
    include: classInclude,
  });
}

// Decisao da reuniao: a agenda e por materia. Aula de convidado aparece como
// "Professor convidado" e nao revela o nome do professor no app.
function classDisplayName(classSession: ClassWithRelations) {
  if (classSession.isGuest) return 'Professor convidado';
  return classSession.subject?.name ?? 'Sem materia';
}

function toClassDto(classSession: ClassWithRelations) {
  const bookedStudents = classSession.bookings
    .filter((booking) => booking.student)
    .map((booking) => ({
      id: booking.student!.id,
      name: booking.student!.name,
      whatsapp: maskPhone(booking.student!.whatsapp),
      enrollmentCode: booking.student!.enrollmentCode,
      creditBalance: booking.student!.creditBalance,
      bookingType: booking.type,
    }));

  return {
    id: classSession.id,
    subjectId: classSession.subjectId,
    subjectName: classSession.subject?.name ?? null,
    isGuest: classSession.isGuest,
    displayName: classDisplayName(classSession),
    unitId: classSession.unitId,
    unitName: classSession.unit?.name ?? null,
    room: classSession.room,
    teacherUserId: classSession.teacherUserId,
    teacherName: classSession.isGuest ? null : (classSession.teacher?.name ?? null),
    startsAt: classSession.startsAt.toISOString(),
    endsAt: classSession.endsAt.toISOString(),
    capacity: classSession.capacity,
    bookedCount: classSession.bookings.length,
    bookedStudents,
  };
}

router.get(
  '/',
  requireAuth,
  requireRole('diretor', 'coordenacao', 'professor'),
  asyncHandler(async (req, res) => {
    const unitScope = resolveUnitScope({ roles: req.user!.roles, unitId: req.user!.unitId });
    const classSessions = await listClasses({
      teacherUserId: isProfessorScoped(req.user!.roles) ? req.user!.id : undefined,
      unitId: unitScope ?? undefined,
    });
    res.json({ data: classSessions.map(toClassDto) });
  }),
);

router.post(
  '/',
  requireAuth,
  requireRole('diretor', 'coordenacao'),
  asyncHandler(async (req, res) => {
    const input = CreateClassSchema.parse(req.body);
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);

    if (endsAt <= startsAt) {
      throw new ApiError(400, 'invalid_class_window', 'Horario de termino deve ser depois do inicio.');
    }

    const unitScope = resolveUnitScope({ roles: req.user!.roles, unitId: req.user!.unitId });
    if (unitScope && unitScope !== input.unitId) {
      throw new ApiError(403, 'unit_scope', 'Voce so pode criar aulas na sua unidade.');
    }

    const unit = await prisma.unit.findFirst({ where: { id: input.unitId, active: true } });
    if (!unit) {
      throw new ApiError(404, 'unit_not_found', 'Unidade nao encontrada.');
    }

    let subjectId: string | null = null;
    let teacherUserId: string | null = null;

    // Aula regular: precisa de materia + professor, e o professor tem que
    // lecionar aquela materia. Aula de convidado nao tem nem materia nem
    // professor vinculado.
    if (!input.isGuest) {
      if (!input.subjectId) {
        throw new ApiError(400, 'subject_required', 'Selecione a materia da aula.');
      }
      if (!input.teacherUserId) {
        throw new ApiError(400, 'teacher_required', 'Selecione o professor da aula.');
      }

      const subject = await prisma.subject.findFirst({
        where: { id: input.subjectId, active: true },
      });
      if (!subject) {
        throw new ApiError(404, 'subject_not_found', 'Materia nao encontrada.');
      }

      const teacher = await prisma.user.findFirst({
        where: { id: input.teacherUserId, active: true, roles: { has: 'professor' } },
      });
      if (!teacher) {
        throw new ApiError(404, 'teacher_not_found', 'Professor nao encontrado.');
      }
      if (teacher.subjectId !== input.subjectId) {
        throw new ApiError(
          400,
          'teacher_subject_mismatch',
          'O professor selecionado nao leciona essa materia.',
        );
      }

      subjectId = input.subjectId;
      teacherUserId = input.teacherUserId;
    }

    const classSession = await prisma.classSession.create({
      data: {
        subjectId,
        unitId: input.unitId,
        isGuest: input.isGuest,
        room: input.room,
        teacherUserId,
        startsAt,
        endsAt,
        capacity: input.capacity,
      },
      include: classInclude,
    });

    res.status(201).json({ data: toClassDto(classSession) });
  }),
);

router.post(
  '/:classId/attendance',
  requireAuth,
  requireRole('diretor', 'coordenacao', 'professor'),
  asyncHandler(async (req, res) => {
    const input = AttendanceSchema.parse(req.body);
    const professorScoped = isProfessorScoped(req.user!.roles);
    const unitScope = resolveUnitScope({ roles: req.user!.roles, unitId: req.user!.unitId });

    const result = await prisma.$transaction(async (tx) => {
      const classSession = await tx.classSession.findUnique({
        where: { id: req.params.classId },
        select: { id: true, teacherUserId: true, unitId: true },
      });
      if (!classSession) return { error: 'class_not_found' as const };

      if (professorScoped && classSession.teacherUserId !== req.user!.id) {
        return { error: 'not_class_owner' as const };
      }
      if (unitScope && classSession.unitId !== unitScope) {
        return { error: 'not_class_unit' as const };
      }

      const booking = await tx.classBooking.findFirst({
        where: {
          classSessionId: req.params.classId,
          studentId: input.studentId,
          status: 'agendado',
        },
        include: {
          student: true,
        },
      });

      if (!booking || !booking.student) return { error: 'not_booked' as const };

      const existing = await tx.attendance.findUnique({
        where: {
          classSessionId_studentId: {
            classSessionId: req.params.classId,
            studentId: input.studentId,
          },
        },
      });

      // Decisao do MVP: o credito ja foi descontado no agendamento. A marcacao
      // de presenca NAO mexe em saldo (presente nao desconta, no-show nao
      // estorna). `creditConsumed` permanece apenas como flag informacional
      // ("essa aula era cobravel e o aluno compareceu").
      const creditConsumed = booking.consumesCredit && input.status === 'presente';

      const attendance = await tx.attendance.upsert({
        where: {
          classSessionId_studentId: {
            classSessionId: req.params.classId,
            studentId: input.studentId,
          },
        },
        update: {
          status: input.status,
          creditConsumed,
          markedByUserId: req.user!.id,
          markedAt: new Date(),
        },
        create: {
          classSessionId: req.params.classId,
          studentId: input.studentId,
          status: input.status,
          creditConsumed,
          markedByUserId: req.user!.id,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: req.user!.id,
          actorType: 'user',
          entityType: 'attendance',
          entityId: attendance.id,
          action: existing ? 'attendance.updated' : 'attendance.created',
          before: existing ?? undefined,
          after: attendance,
        },
      });

      return { attendance, student: booking.student };
    });

    if ('error' in result) {
      if (result.error === 'class_not_found') {
        throw new ApiError(404, 'class_not_found', 'Aula nao encontrada.');
      }
      if (result.error === 'not_class_owner') {
        throw new ApiError(403, 'not_class_owner', 'Voce so pode marcar presenca das suas aulas.');
      }
      if (result.error === 'not_class_unit') {
        throw new ApiError(403, 'not_class_unit', 'Aula fora da sua unidade.');
      }
      throw new ApiError(409, 'student_not_booked', 'Aluno nao esta agendado nesta aula.');
    }

    res.json({
      data: {
        attendance: result.attendance,
        student: {
          id: result.student.id,
          name: result.student.name,
          creditBalance: result.student.creditBalance,
        },
      },
    });
  }),
);

export default router;
