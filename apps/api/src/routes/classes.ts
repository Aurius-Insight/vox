import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db/client.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { ApiError, asyncHandler, maskPhone } from '../lib/http.js';
import { resolveAttendanceCredit } from '../domain/attendance.js';
import { isProfessorScoped, resolveUnitScope } from '../domain/access.js';
import { canEditClass } from '../domain/class.js';

const router = Router();

const AttendanceSchema = z.object({
  studentId: z.string().min(1),
  status: z.enum(['presente', 'no_show']),
});

const UpdateClassSchema = z
  .object({
    capacity: z.number().int().min(1).max(200).optional(),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
    teacherUserId: z.string().optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'Informe ao menos um campo para atualizar.',
  });

const CreateClassSchema = z.object({
  isGuest: z.boolean().default(false),
  subjectId: z.string().optional(),
  teacherUserId: z.string().optional(),
  unitId: z.string().min(1),
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
      // Aulas canceladas saem da visao padrao da operacao.
      canceledAt: null,
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

      // Regra da Transcricao: o credito conta APENAS quando o professor marca
      // presente; no-show nao consome; correcao presente -> no-show estorna.
      const resolution = resolveAttendanceCredit({
        status: input.status,
        consumesCredit: booking.consumesCredit,
        alreadyConsumed: existing?.creditConsumed ?? false,
        creditBalance: booking.student.creditBalance,
      });

      if (!resolution.ok) return { error: resolution.reason };

      const student =
        resolution.creditDelta === 0
          ? booking.student
          : await tx.student.update({
              where: { id: booking.student.id },
              data: { creditBalance: { increment: resolution.creditDelta } },
            });

      const attendance = await tx.attendance.upsert({
        where: {
          classSessionId_studentId: {
            classSessionId: req.params.classId,
            studentId: input.studentId,
          },
        },
        update: {
          status: input.status,
          creditConsumed: resolution.willConsume,
          markedByUserId: req.user!.id,
          markedAt: new Date(),
        },
        create: {
          classSessionId: req.params.classId,
          studentId: input.studentId,
          status: input.status,
          creditConsumed: resolution.willConsume,
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

      return { attendance, student };
    });

    if ('error' in result) {
      if (result.error === 'insufficient_credit') {
        throw new ApiError(409, 'insufficient_credit', 'Aluno sem saldo para consumir credito.');
      }
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

const BookingSchema = z.object({
  studentId: z.string().min(1),
});

// Agenda um aluno numa aula pela equipe (pagina de Presenca). O tipo do
// agendamento segue o tipo do aluno — experimental nao consome credito.
router.post(
  '/:classId/bookings',
  requireAuth,
  requireRole('diretor', 'coordenacao', 'professor'),
  asyncHandler(async (req, res) => {
    const input = BookingSchema.parse(req.body);
    const professorScoped = isProfessorScoped(req.user!.roles);
    const unitScope = resolveUnitScope({ roles: req.user!.roles, unitId: req.user!.unitId });

    const result = await prisma.$transaction(async (tx) => {
      const classSession = await tx.classSession.findUnique({
        where: { id: req.params.classId },
        include: { bookings: { where: { status: 'agendado' }, select: { id: true } } },
      });
      if (!classSession || classSession.canceledAt) {
        return { ok: false as const, error: 'class_not_found' as const };
      }
      if (professorScoped && classSession.teacherUserId !== req.user!.id) {
        return { ok: false as const, error: 'not_class_owner' as const };
      }
      if (unitScope && classSession.unitId !== unitScope) {
        return { ok: false as const, error: 'not_class_unit' as const };
      }

      const student = await tx.student.findFirst({
        where: { id: input.studentId, active: true },
      });
      if (!student) return { ok: false as const, error: 'student_not_found' as const };

      const already = await tx.classBooking.findFirst({
        where: { classSessionId: classSession.id, studentId: student.id, status: 'agendado' },
        select: { id: true },
      });
      if (already) return { ok: false as const, error: 'already_booked' as const };

      if (classSession.bookings.length >= classSession.capacity) {
        return { ok: false as const, error: 'class_full' as const };
      }

      // Experimental nao consome credito; matriculado segue o fluxo regular.
      const isExperimental = student.type === 'experimental';
      const booking = await tx.classBooking.upsert({
        where: {
          classSessionId_studentId: {
            classSessionId: classSession.id,
            studentId: student.id,
          },
        },
        update: {
          status: 'agendado',
          type: isExperimental ? 'experimental' : 'regular',
          consumesCredit: !isExperimental,
          canceledAt: null,
        },
        create: {
          classSessionId: classSession.id,
          studentId: student.id,
          type: isExperimental ? 'experimental' : 'regular',
          status: 'agendado',
          consumesCredit: !isExperimental,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: req.user!.id,
          actorType: 'user',
          entityType: 'class_booking',
          entityId: booking.id,
          action: 'booking.created_by_staff',
          after: booking,
        },
      });

      return { ok: true as const, booking };
    });

    if (!result.ok) {
      const errors: Record<string, { status: number; message: string }> = {
        class_not_found: { status: 404, message: 'Aula nao encontrada.' },
        not_class_owner: { status: 403, message: 'Voce so pode agendar nas suas aulas.' },
        not_class_unit: { status: 403, message: 'Aula fora da sua unidade.' },
        student_not_found: { status: 404, message: 'Aluno nao encontrado.' },
        already_booked: { status: 409, message: 'Aluno ja esta agendado nesta aula.' },
        class_full: { status: 409, message: 'Aula sem vagas disponiveis.' },
      };
      const mapped = errors[result.error];
      throw new ApiError(mapped.status, result.error, mapped.message);
    }

    res.status(201).json({ data: { id: result.booking.id, status: result.booking.status } });
  }),
);

router.patch(
  '/:classId',
  requireAuth,
  requireRole('diretor', 'coordenacao'),
  asyncHandler(async (req, res) => {
    const input = UpdateClassSchema.parse(req.body);
    const unitScope = resolveUnitScope({ roles: req.user!.roles, unitId: req.user!.unitId });

    const existing = await prisma.classSession.findUnique({
      where: { id: req.params.classId },
      include: {
        bookings: { where: { status: 'agendado' }, select: { id: true } },
      },
    });
    if (!existing) throw new ApiError(404, 'class_not_found', 'Aula nao encontrada.');
    if (unitScope && existing.unitId !== unitScope) {
      throw new ApiError(403, 'unit_scope', 'Aula fora da sua unidade.');
    }

    // Se a janela esta sendo alterada, valida que termino > inicio com os
    // valores efetivos (mistura entre novos e os atuais).
    const nextStartsAt = input.startsAt ? new Date(input.startsAt) : existing.startsAt;
    const nextEndsAt = input.endsAt ? new Date(input.endsAt) : existing.endsAt;
    if (nextEndsAt <= nextStartsAt) {
      throw new ApiError(400, 'invalid_class_window', 'Horario de termino deve ser depois do inicio.');
    }

    // Resolve o professor proposto (se mudou) para alimentar `canEditClass`.
    let nextTeacher: { id: string; subjectId: string | null } | null = null;
    if (input.teacherUserId && input.teacherUserId !== existing.teacherUserId) {
      const teacher = await prisma.user.findFirst({
        where: { id: input.teacherUserId, active: true, roles: { has: 'professor' } },
        select: { id: true, subjectId: true },
      });
      if (!teacher) throw new ApiError(404, 'teacher_not_found', 'Professor nao encontrado.');
      nextTeacher = teacher;
    }

    const check = canEditClass({
      canceledAt: existing.canceledAt,
      bookedCount: existing.bookings.length,
      nextCapacity: input.capacity,
      isGuest: existing.isGuest,
      classSubjectId: existing.subjectId,
      nextTeacher,
    });
    if (!check.ok) {
      const map: Record<string, { status: number; code: string; message: string }> = {
        class_canceled: { status: 409, code: 'class_canceled', message: 'Aula ja cancelada — nao aceita edicao.' },
        capacity_below_booked: {
          status: 409,
          code: 'capacity_below_booked',
          message: 'A nova capacidade nao pode ser menor que a quantidade ja agendada.',
        },
        teacher_does_not_teach_subject: {
          status: 400,
          code: 'teacher_subject_mismatch',
          message: 'O professor selecionado nao leciona essa materia.',
        },
      };
      const err = map[check.reason];
      throw new ApiError(err.status, err.code, err.message);
    }

    const data: Prisma.ClassSessionUpdateInput = {};
    if (input.capacity !== undefined) data.capacity = input.capacity;
    if (input.startsAt !== undefined) data.startsAt = nextStartsAt;
    if (input.endsAt !== undefined) data.endsAt = nextEndsAt;
    if (nextTeacher) data.teacher = { connect: { id: nextTeacher.id } };

    const updated = await prisma.classSession.update({
      where: { id: existing.id },
      data,
      include: classInclude,
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: req.user!.id,
        actorType: 'user',
        entityType: 'class_session',
        entityId: updated.id,
        action: 'class.updated',
        before: { ...existing, bookings: undefined },
        after: { ...updated, bookings: undefined },
      },
    });

    res.json({ data: toClassDto(updated) });
  }),
);

router.delete(
  '/:classId',
  requireAuth,
  requireRole('diretor', 'coordenacao'),
  asyncHandler(async (req, res) => {
    const unitScope = resolveUnitScope({ roles: req.user!.roles, unitId: req.user!.unitId });

    const result = await prisma.$transaction(async (tx) => {
      const classSession = await tx.classSession.findUnique({
        where: { id: req.params.classId },
      });
      if (!classSession) return { ok: false as const, error: 'class_not_found' as const };
      if (unitScope && classSession.unitId !== unitScope) {
        return { ok: false as const, error: 'unit_scope' as const };
      }
      if (classSession.canceledAt) {
        return { ok: false as const, error: 'class_canceled' as const };
      }

      const now = new Date();

      // Cancela em cascata todos os agendamentos ativos.
      await tx.classBooking.updateMany({
        where: { classSessionId: classSession.id, status: 'agendado' },
        data: { status: 'cancelado', canceledAt: now },
      });

      // Estorno: presencas marcadas como 'presente' com creditConsumed=true
      // devem devolver 1 credito pro saldo do aluno. Sem isso, aluno paga
      // por aula que nao aconteceu. Marca a presenca como nao-mais-consumida
      // pra evitar estorno duplo se algum retry acontecer.
      const attendancesToRefund = await tx.attendance.findMany({
        where: {
          classSessionId: classSession.id,
          status: 'presente',
          creditConsumed: true,
        },
        select: { id: true, studentId: true },
      });
      let refundedCount = 0;
      for (const att of attendancesToRefund) {
        await tx.student.update({
          where: { id: att.studentId },
          data: { creditBalance: { increment: 1 } },
        });
        await tx.attendance.update({
          where: { id: att.id },
          data: { creditConsumed: false },
        });
        refundedCount += 1;
      }

      const updated = await tx.classSession.update({
        where: { id: classSession.id },
        data: { canceledAt: now },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: req.user!.id,
          actorType: 'user',
          entityType: 'class_session',
          entityId: updated.id,
          action: 'class.canceled',
          before: classSession,
          after: { ...updated, refundedCount },
        },
      });

      return { ok: true as const, classSession: updated, refundedCount };
    });

    if (!result.ok) {
      if (result.error === 'class_not_found') {
        throw new ApiError(404, 'class_not_found', 'Aula nao encontrada.');
      }
      if (result.error === 'unit_scope') {
        throw new ApiError(403, 'unit_scope', 'Aula fora da sua unidade.');
      }
      throw new ApiError(409, 'class_canceled', 'Aula ja estava cancelada.');
    }

    res.json({
      data: {
        id: result.classSession.id,
        canceledAt: result.classSession.canceledAt,
        refundedCount: result.refundedCount,
      },
    });
  }),
);

export default router;
