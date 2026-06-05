import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { env } from '../config/env.js';
import { prisma } from '../db/client.js';
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
import { createMagicLink, consumeMagicLink } from '../lib/magic-link.js';
import { logger, serializeError } from '../lib/logger.js';

const router = Router();

const SERIALIZATION_FAILURE_CODE = 'P2034';
const MAX_BOOKING_RETRIES = 3;

/**
 * Roda uma transacao com isolation `Serializable` e relenta caso o Postgres
 * aborte por conflito de serializacao (codigo Prisma `P2034`). Necessario
 * para impedir over-booking quando dois alunos disputam a ultima vaga.
 */
async function withSerializableRetry<T>(
  run: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_BOOKING_RETRIES; attempt++) {
    try {
      return await prisma.$transaction(run, { isolationLevel: 'Serializable' });
    } catch (error) {
      lastError = error;
      const isSerializationFailure =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === SERIALIZATION_FAILURE_CODE;
      if (!isSerializationFailure || attempt === MAX_BOOKING_RETRIES - 1) throw error;
      // Backoff curto pra dar tempo do "vencedor" commitar antes da retentativa.
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
  throw lastError;
}

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
        // O portal e exclusivo de alunos matriculados.
        type: 'matriculado',
      },
    });

    if (!student) {
      return res.json({ sent: true });
    }

    const { link } = await createMagicLink(student.id);

    // Sem whatsapp, nao da pra enviar magic link. Devolve a mesma resposta
    // generica (sent:true) pra nao vazar quem ta cadastrado ou nao.
    if (!student.whatsapp) {
      return res.json({ sent: true });
    }

    // Tenta entregar via BotConversa. Falha de envio nao deve revelar nada
    // ao caller (poderia enumerar alunos), mas precisa ficar nos logs.
    try {
      await sendMessageByPhone(
        student.whatsapp,
        `Vox RJ — seu link de acesso ao portal (valido por 1 hora): ${link}`,
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

    // Uso unico e atomico do link magico (GETDEL no Redis).
    const studentId = await consumeMagicLink(input.token);
    if (!studentId) {
      throw new ApiError(401, 'invalid_magic_link', 'Link invalido ou expirado.');
    }

    // Defesa em profundidade: o portal e exclusivo de alunos matriculados.
    const student = await prisma.student.findFirst({
      where: { id: studentId, active: true, type: 'matriculado' },
      select: { id: true },
    });
    if (!student) {
      throw new ApiError(
        403,
        'portal_unavailable',
        'Portal disponivel apenas para alunos matriculados.',
      );
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
        whatsapp: student.whatsapp ?? undefined,
        email: student.email ?? undefined,
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

// O proprio aluno edita seus dados de contato (nome/whatsapp/email). Nao
// mexe em tipo, saldo, CPF ou unidade.
const UpdateMeSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  whatsapp: z.string().trim().min(8).max(30).optional(),
  email: z
    .string()
    .trim()
    .email()
    .optional()
    .or(z.literal('').transform(() => undefined)),
});

router.patch(
  '/me',
  requirePortalStudent,
  asyncHandler(async (req, res) => {
    const input = UpdateMeSchema.parse(req.body);
    const data: Prisma.StudentUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.whatsapp !== undefined) data.whatsapp = input.whatsapp.replace(/\D/g, '');
    if (input.email !== undefined) data.email = input.email ?? null;

    const updated = await prisma.student.update({
      where: { id: req.student!.id },
      data,
      select: { name: true, whatsapp: true, email: true },
    });
    res.json({
      data: {
        name: updated.name,
        whatsapp: updated.whatsapp ?? undefined,
        email: updated.email ?? undefined,
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
        canceledAt: null,
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

    // Agendamentos ativos do aluno (com horario), usados para detectar overlap
    // contra cada aula candidata em memoria — evita N+1 consultas.
    const studentBookings = await prisma.classBooking.findMany({
      where: { studentId: student.id, status: 'agendado' },
      include: { classSession: { select: { id: true, startsAt: true, endsAt: true } } },
    });

    const upcoming = classSessions.map((classSession) => {
      const bookedCount = classSession.bookings.length;
      const isBooked = classSession.bookings.some((booking) => booking.studentId === student.id);
      // Dois intervalos [A1,A2] e [B1,B2] se sobrepoem quando A1 < B2 e B1 < A2.
      const hasOverlap = studentBookings.some(
        (booking) =>
          booking.classSession.id !== classSession.id &&
          booking.classSession.startsAt < classSession.endsAt &&
          booking.classSession.endsAt > classSession.startsAt,
      );
      const bookable = canBookClass({
        creditBalance: student.creditBalance,
        bookedCount,
        capacity: classSession.capacity,
        isBooked,
        hasOverlap,
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

// Historico do aluno: aulas que ja aconteceram (ou estao no passado) onde o
// aluno tinha agendamento ou teve a presenca marcada. Inclui no-show pra que
// o aluno entenda o consumo de saldo. So matriculas (portal e exclusivo de
// matriculado, mesma regra do /me).
router.get(
  '/history',
  requirePortalStudent,
  asyncHandler(async (req, res) => {
    const studentId = req.student!.id;
    const now = new Date();

    // Pega tudo que esta no passado e que se vincula ao aluno por Attendance
    // OU por ClassBooking. Attendance e a fonte de verdade (presente/no_show);
    // ClassBooking captura aulas onde o aluno se inscreveu mas o professor
    // ainda nao marcou (vai aparecer com status "sem registro"). Tudo no mesmo
    // SELECT pra evitar two-trip + merge em memoria.
    const sessions = await prisma.classSession.findMany({
      where: {
        startsAt: { lt: now },
        canceledAt: null,
        OR: [
          { attendances: { some: { studentId } } },
          { bookings: { some: { studentId, status: { in: ['agendado', 'cancelado'] } } } },
        ],
      },
      orderBy: { startsAt: 'desc' },
      take: 200,
      include: {
        subject: { select: { name: true } },
        unit: { select: { name: true } },
        teacher: { select: { name: true } },
        attendances: {
          where: { studentId },
          select: { status: true, creditConsumed: true },
        },
        bookings: {
          where: { studentId },
          select: { status: true },
        },
      },
    });

    const data = sessions.map((session) => {
      const attendance = session.attendances[0];
      const booking = session.bookings[0];
      // Status do ponto de vista do aluno:
      //  presente / no_show  → presenca marcada pelo professor
      //  cancelado           → aluno cancelou antes
      //  sem_registro        → estava agendado mas ninguem marcou (raro)
      const status: 'presente' | 'no_show' | 'cancelado' | 'sem_registro' =
        attendance?.status ?? (booking?.status === 'cancelado' ? 'cancelado' : 'sem_registro');

      return {
        id: session.id,
        startsAt: session.startsAt.toISOString(),
        endsAt: session.endsAt.toISOString(),
        // Aulas legadas absorvidas das planilhas nao tem subject — mostramos
        // como "Aula registrada". Aula de convidado idem (sem detalhe).
        displayName: session.isGuest
          ? 'Professor convidado'
          : (session.subject?.name ?? 'Aula registrada'),
        unit: session.unit?.name ?? null,
        teacher: session.isGuest ? null : (session.teacher?.name ?? null),
        status,
        creditConsumed: attendance?.creditConsumed ?? false,
      };
    });

    res.json({ data });
  }),
);

const bookingErrorMap: Record<string, { status: number; code: string; message: string }> = {
  no_credit: { status: 409, code: 'no_credit', message: 'Sem saldo de creditos para agendar.' },
  class_full: { status: 409, code: 'class_full', message: 'Aula sem vagas disponiveis.' },
  already_booked: { status: 409, code: 'already_booked', message: 'Voce ja esta agendado nesta aula.' },
  class_started: { status: 409, code: 'class_started', message: 'Aula ja iniciada ou encerrada.' },
  time_conflict: {
    status: 409,
    code: 'time_conflict',
    message: 'Voce ja tem uma aula agendada nesse horario.',
  },
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

    const result = await withSerializableRetry(async (tx) => {
      const student = await tx.student.findFirst({ where: { id: studentId, active: true } });
      if (!student) return { ok: false as const, error: 'student_not_found' as const };

      const classSession = await tx.classSession.findUnique({
        where: { id: classId },
        include: {
          bookings: { where: { status: 'agendado' }, select: { studentId: true } },
        },
      });
      // Aula inexistente OU cancelada: trata como "nao encontrada" do ponto de
      // vista do aluno (evita enumeracao).
      if (!classSession || classSession.canceledAt) {
        return { ok: false as const, error: 'class_not_found' as const };
      }

      // Procura agendamento ativo do aluno em outra aula com horario sobreposto.
      const overlapping = await tx.classBooking.findFirst({
        where: {
          studentId,
          status: 'agendado',
          classSessionId: { not: classId },
          classSession: {
            startsAt: { lt: classSession.endsAt },
            endsAt: { gt: classSession.startsAt },
          },
        },
        select: { id: true },
      });

      const isBooked = classSession.bookings.some((booking) => booking.studentId === studentId);
      const check = canBookClass({
        creditBalance: student.creditBalance,
        bookedCount: classSession.bookings.length,
        capacity: classSession.capacity,
        isBooked,
        hasOverlap: overlapping !== null,
        startsAt: classSession.startsAt,
      });
      if (!check.ok) return { ok: false as const, error: check.reason };

      // Upsert para reativar um agendamento previamente cancelado mantendo
      // a chave (classSessionId, studentId). Credito nao e tocado aqui — so
      // na presenca confirmada pelo professor (decisao da Transcricao).
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

// Cancelamento pelo aluno regular: a Transcricao prevê expressamente que o
// aluno "vai lá mesmo no sistema e desmarca" (1:09). Sem janela de
// "cancelamento tardio" — esta foi explicitamente adiada para fase futura.
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
