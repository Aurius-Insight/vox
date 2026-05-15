import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { env } from '../config/env.js';
import { prisma } from '../db/client.js';
import { redis } from '../db/redis.js';
import {
  clearPortalSession,
  createPortalSession,
  requirePortalStudent,
  setPortalSessionCookie,
} from '../middleware/auth.js';
import { portalLimiter } from '../middleware/rateLimit.js';
import { ApiError, asyncHandler } from '../lib/http.js';
import { hashCpf } from '../lib/cpf.js';
import { canBookClass, canCancelBooking } from '../domain/booking.js';
import { sendMessageByPhone } from '../lib/botconversa.js';
import { logger, serializeError } from '../lib/logger.js';

const router = Router();

const MAGIC_LINK_TTL_SECONDS = 15 * 60;
const magicLinkKey = (token: string) => `magic:${token}`;

const MagicLinkSchema = z.object({
  cpf: z.string().min(11).max(14),
});

const PortalSessionSchema = z.object({
  token: z.string().uuid(),
});

router.post(
  '/magic-links',
  portalLimiter,
  asyncHandler(async (req, res) => {
    const input = MagicLinkSchema.parse(req.body);
    const student = await prisma.student.findFirst({
      where: {
        cpfHash: hashCpf(input.cpf),
        active: true,
      },
    });

    if (!student) {
      return res.json({ sent: true });
    }

    const token = randomUUID();
    await redis.set(magicLinkKey(token), student.id, 'EX', MAGIC_LINK_TTL_SECONDS);
    const link = `${env.APP_ORIGIN}/portal/entrar?token=${token}`;

    // Tenta entregar via BotConversa. Falha de envio nao deve revelar nada
    // ao caller (poderia enumerar alunos), mas precisa ficar nos logs.
    try {
      await sendMessageByPhone(
        student.whatsapp,
        `Vox RJ — seu link de acesso ao portal (valido por 15 min): ${link}`,
      );
    } catch (error) {
      logger.error('magic_link_send_failed', {
        studentId: student.id,
        ...serializeError(error),
      });
    }

    return res.json({
      sent: true,
      // Em dev sempre devolve o link, para facilitar o teste sem precisar do
      // canal de envio configurado. Em prod, nunca.
      ...(env.NODE_ENV === 'development' ? { devMagicLink: link } : {}),
    });
  }),
);

router.post(
  '/sessions',
  portalLimiter,
  asyncHandler(async (req, res) => {
    const input = PortalSessionSchema.parse(req.body);

    // GETDEL garante uso unico do link magico de forma atomica.
    const studentId = await redis.getdel(magicLinkKey(input.token));
    if (!studentId) {
      throw new ApiError(401, 'invalid_magic_link', 'Link invalido ou expirado.');
    }

    const sessionId = await createPortalSession(studentId);
    setPortalSessionCookie(res, sessionId);

    res.json({ ok: true });
  }),
);

router.post(
  '/logout',
  requirePortalStudent,
  asyncHandler(async (req, res) => {
    await clearPortalSession(req, res);
    res.status(204).send();
  }),
);

router.get(
  '/me',
  requirePortalStudent,
  asyncHandler(async (req, res) => {
    const student = await prisma.student.findFirst({
      where: {
        id: req.student!.id,
        active: true,
      },
      include: { unit: { select: { name: true } } },
    });
    if (!student) throw new ApiError(404, 'student_not_found', 'Aluno nao encontrado.');

    // Decisao da reuniao: o aluno ve "aulas", nao "creditos". Mostramos
    // quantas aulas ele ja fez, de quais disciplinas e quantas faltam.
    const attendances = await prisma.attendance.findMany({
      where: { studentId: student.id, status: 'presente' },
      include: {
        classSession: { include: { subject: { select: { name: true } } } },
      },
    });

    const porDisciplinaMap = new Map<string, number>();
    for (const attendance of attendances) {
      const label = attendance.classSession.isGuest
        ? 'Professor convidado'
        : (attendance.classSession.subject?.name ?? 'Sem materia');
      porDisciplinaMap.set(label, (porDisciplinaMap.get(label) ?? 0) + 1);
    }
    const porDisciplina = [...porDisciplinaMap.entries()]
      .map(([disciplina, quantidade]) => ({ disciplina, quantidade }))
      .sort((a, b) => b.quantidade - a.quantidade);

    res.json({
      data: {
        id: student.id,
        name: student.name,
        cpf: student.cpfMasked ?? undefined,
        unit: student.unit?.name ?? null,
        packageName: student.packageName,
        aulasFeitas: attendances.length,
        aulasRestantes: student.creditBalance,
        porDisciplina,
        status: student.active ? 'ativo' : 'inativo',
      },
    });
  }),
);

router.get(
  '/classes',
  requirePortalStudent,
  asyncHandler(async (req, res) => {
    const student = await prisma.student.findFirst({
      where: {
        id: req.student!.id,
        active: true,
      },
    });
    if (!student) throw new ApiError(404, 'student_not_found', 'Aluno nao encontrado.');

    const classSessions = await prisma.classSession.findMany({
      where: {
        startsAt: { gte: new Date() },
      },
      orderBy: { startsAt: 'asc' },
      include: {
        subject: { select: { name: true } },
        unit: { select: { name: true } },
        bookings: {
          where: { status: 'agendado' },
          select: {
            id: true,
            studentId: true,
          },
        },
      },
    });

    const upcoming = classSessions.map((classSession) => {
      const bookedCount = classSession.bookings.length;
      const isBooked = classSession.bookings.some((booking) => booking.studentId === student.id);
      const bookable = canBookClass({
        creditBalance: student.creditBalance,
        bookedCount,
        capacity: classSession.capacity,
        isBooked,
        startsAt: classSession.startsAt,
      });

      return {
        id: classSession.id,
        // Aula de convidado nao revela o professor/materia no app.
        displayName: classSession.isGuest
          ? 'Professor convidado'
          : (classSession.subject?.name ?? 'Sem materia'),
        isGuest: classSession.isGuest,
        unit: classSession.unit?.name ?? null,
        room: classSession.room,
        startsAt: classSession.startsAt.toISOString(),
        endsAt: classSession.endsAt.toISOString(),
        capacity: classSession.capacity,
        bookedCount,
        isBooked,
        canBook: bookable.ok,
      };
    });

    res.json({ data: upcoming });
  }),
);

const bookingErrorMap: Record<string, { status: number; code: string; message: string }> = {
  no_credit: { status: 409, code: 'no_credit', message: 'Sem saldo de creditos para agendar.' },
  class_full: { status: 409, code: 'class_full', message: 'Aula sem vagas disponiveis.' },
  already_booked: { status: 409, code: 'already_booked', message: 'Voce ja esta agendado nesta aula.' },
  class_started: { status: 409, code: 'class_started', message: 'Aula ja iniciada ou encerrada.' },
  not_booked: { status: 409, code: 'not_booked', message: 'Voce nao tem agendamento nesta aula.' },
  class_not_found: { status: 404, code: 'class_not_found', message: 'Aula nao encontrada.' },
  student_not_found: { status: 404, code: 'student_not_found', message: 'Aluno nao encontrado.' },
};

function throwBookingError(reason: string): never {
  const mapped = bookingErrorMap[reason] ?? {
    status: 409,
    code: 'booking_failed',
    message: 'Nao foi possivel concluir a operacao.',
  };
  throw new ApiError(mapped.status, mapped.code, mapped.message);
}

router.post(
  '/classes/:classId/book',
  requirePortalStudent,
  asyncHandler(async (req, res) => {
    const studentId = req.student!.id;
    const { classId } = req.params;

    const result = await prisma.$transaction(async (tx) => {
      const student = await tx.student.findFirst({ where: { id: studentId, active: true } });
      if (!student) return { ok: false as const, error: 'student_not_found' as const };

      const classSession = await tx.classSession.findUnique({
        where: { id: classId },
        include: {
          bookings: { where: { status: 'agendado' }, select: { studentId: true } },
        },
      });
      if (!classSession) return { ok: false as const, error: 'class_not_found' as const };

      const isBooked = classSession.bookings.some((booking) => booking.studentId === studentId);
      const check = canBookClass({
        creditBalance: student.creditBalance,
        bookedCount: classSession.bookings.length,
        capacity: classSession.capacity,
        isBooked,
        startsAt: classSession.startsAt,
      });
      if (!check.ok) return { ok: false as const, error: check.reason };

      const booking = await tx.classBooking.upsert({
        where: {
          classSessionId_studentId: { classSessionId: classId, studentId },
        },
        update: {
          status: 'agendado',
          type: 'regular',
          consumesCredit: true,
          canceledAt: null,
        },
        create: {
          classSessionId: classId,
          studentId,
          type: 'regular',
          status: 'agendado',
          consumesCredit: true,
        },
      });

      await tx.auditLog.create({
        data: {
          actorType: 'student',
          entityType: 'class_booking',
          entityId: booking.id,
          action: 'booking.created',
          after: booking,
        },
      });

      return { ok: true as const, booking };
    });

    if (!result.ok) throwBookingError(result.error);

    res.status(201).json({
      data: { id: result.booking.id, status: result.booking.status },
    });
  }),
);

router.delete(
  '/classes/:classId/book',
  requirePortalStudent,
  asyncHandler(async (req, res) => {
    const studentId = req.student!.id;
    const { classId } = req.params;

    const result = await prisma.$transaction(async (tx) => {
      const classSession = await tx.classSession.findUnique({ where: { id: classId } });
      if (!classSession) return { ok: false as const, error: 'class_not_found' as const };

      const booking = await tx.classBooking.findUnique({
        where: {
          classSessionId_studentId: { classSessionId: classId, studentId },
        },
      });

      const check = canCancelBooking({
        hasActiveBooking: booking?.status === 'agendado',
        startsAt: classSession.startsAt,
      });
      if (!check.ok) return { ok: false as const, error: check.reason };

      const updated = await tx.classBooking.update({
        where: { id: booking!.id },
        data: { status: 'cancelado', canceledAt: new Date() },
      });

      await tx.auditLog.create({
        data: {
          actorType: 'student',
          entityType: 'class_booking',
          entityId: updated.id,
          action: 'booking.canceled',
          before: booking!,
          after: updated,
        },
      });

      return { ok: true as const, booking: updated };
    });

    if (!result.ok) throwBookingError(result.error);

    res.json({
      data: { id: result.booking.id, status: result.booking.status },
    });
  }),
);

export default router;
