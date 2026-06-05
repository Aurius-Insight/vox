import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { Role } from '@prisma/client';
import { prisma } from '../db/client.js';
import { env } from '../config/env.js';
import { ApiError, asyncHandler, maskCpf } from '../lib/http.js';
import { hashCpf, normalizeCpf } from '../lib/cpf.js';
import { enrollmentStageSlug, uniqueEnrollmentCode } from '../domain/enrollment.js';
import { getLeadStageBySlug } from '../lib/lead-stage-cache.js';
import { withEnrollmentCodeRetry } from '../lib/enrollment-retry.js';
import { rateLimit } from '../middleware/rateLimit.js';
import {
  createPortalSession,
  requireAuth,
  requireRole,
  setPortalSessionCookie,
} from '../middleware/auth.js';

const router = Router();

type SignupType = 'matriculado' | 'experimental';

// Auto-cadastro publico e sensivel: limite agressivo por IP.
const signupLimiter = rateLimit({ keyPrefix: 'public_signup', windowMs: 60_000, max: 8 });

// --- Helper compartilhado: cria aluno + lead na etapa do CRM ---------------
type StudentSignupResult =
  | { ok: false; error: 'unit_not_found' }
  | { ok: true; duplicate: true }
  | { ok: true; duplicate: false; studentId: string };

async function registerStudentSignup(
  tipo: SignupType,
  input: {
    name: string;
    whatsappDigits: string;
    unitId: string;
    email?: string;
    cpfDigits: string | null;
  },
): Promise<StudentSignupResult> {
  return withEnrollmentCodeRetry(() =>
    prisma.$transaction(async (tx) => {
      const unit = await tx.unit.findFirst({ where: { id: input.unitId, active: true } });
      if (!unit) return { ok: false as const, error: 'unit_not_found' as const };

      // Dedup silencioso por whatsapp/cpf: nao duplica, sucesso generico.
      const existing = await tx.student.findFirst({
        where: { whatsapp: input.whatsappDigits, active: true },
        select: { id: true },
      });
      if (existing) return { ok: true as const, duplicate: true as const };

      let cpfHashValue: string | null = null;
      let cpfMaskedValue: string | null = null;
      if (input.cpfDigits) {
        cpfHashValue = hashCpf(input.cpfDigits);
        const byCpf = await tx.student.findFirst({ where: { cpfHash: cpfHashValue } });
        if (byCpf) return { ok: true as const, duplicate: true as const };
        cpfMaskedValue = maskCpf(input.cpfDigits) ?? null;
      }

      // Matriculado entra com o pacote padrao (saldo cheio); experimental sem.
      let packageName: string | null = null;
      let creditBalance = 0;
      if (tipo === 'matriculado') {
        const pkg = await tx.package.findFirst({
          where: { active: true },
          orderBy: { classCount: 'desc' },
        });
        if (pkg) {
          packageName = pkg.name;
          creditBalance = pkg.classCount;
        }
      }

      // "Student manda": nasce vinculado a um lead na etapa do tipo, com a
      // origem do canal. Reaproveita lead existente do mesmo whatsapp.
      const targetStage = await getLeadStageBySlug(enrollmentStageSlug(tipo), tx);
      const reusableLead = await tx.lead.findFirst({
        where: { whatsapp: input.whatsappDigits, student: { is: null } },
        select: { id: true },
      });
      const leadId = reusableLead
        ? (
            await tx.lead.update({
              where: { id: reusableLead.id },
              data: { stageId: targetStage.id },
              select: { id: true },
            })
          ).id
        : (
            await tx.lead.create({
              data: {
                name: input.name,
                whatsapp: input.whatsappDigits,
                email: input.email,
                unitInterest: unit.name,
                source: 'cadastro_publico',
                stageId: targetStage.id,
              },
              select: { id: true },
            })
          ).id;

      const enrollmentCode = await uniqueEnrollmentCode((code) =>
        tx.student.findUnique({ where: { enrollmentCode: code } }).then((found) => found !== null),
      );

      const student = await tx.student.create({
        data: {
          name: input.name,
          whatsapp: input.whatsappDigits,
          email: input.email,
          cpfHash: cpfHashValue,
          cpfMasked: cpfMaskedValue,
          enrollmentCode,
          unitId: unit.id,
          type: tipo,
          packageName,
          creditBalance,
          active: true,
          leadId,
        },
        select: { id: true },
      });

      await tx.auditLog.create({
        data: {
          actorType: 'system',
          entityType: 'student',
          entityId: student.id,
          action: 'student.public_signup',
          after: { type: tipo, enrollmentCode, source: 'cadastro_publico' },
        },
      });

      return { ok: true as const, duplicate: false as const, studentId: student.id };
    }),
  );
}

// --- Links com TOKEN secreto (aluno matriculado/experimental) --------------
function resolveSignupType(token: string): SignupType | null {
  if (env.PUBLIC_SIGNUP_TOKEN_MATRICULADO && token === env.PUBLIC_SIGNUP_TOKEN_MATRICULADO) {
    return 'matriculado';
  }
  if (env.PUBLIC_SIGNUP_TOKEN_EXPERIMENTAL && token === env.PUBLIC_SIGNUP_TOKEN_EXPERIMENTAL) {
    return 'experimental';
  }
  return null;
}

const TokenSignupSchema = z.object({
  name: z.string().trim().min(2).max(120),
  whatsapp: z.string().trim().min(8).max(30),
  unitId: z.string().min(1),
  email: z
    .string()
    .trim()
    .email()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  // CPF obrigatorio: e o login do portal (matriculado cai direto nas aulas).
  cpf: z.string().trim().min(11).max(14),
});

router.get(
  '/signup/:token',
  asyncHandler(async (req, res) => {
    const tipo = resolveSignupType(req.params.token);
    if (!tipo) throw new ApiError(404, 'invalid_token', 'Link invalido ou expirado.');
    const units = await prisma.unit.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    res.json({ data: { tipo, units } });
  }),
);

router.post(
  '/signup/:token',
  signupLimiter,
  asyncHandler(async (req, res) => {
    const tipo = resolveSignupType(req.params.token);
    if (!tipo) throw new ApiError(404, 'invalid_token', 'Link invalido ou expirado.');

    const input = TokenSignupSchema.parse(req.body);
    const cpfDigits = normalizeCpf(input.cpf);
    if (cpfDigits.length !== 11) {
      throw new ApiError(400, 'invalid_cpf', 'CPF deve ter 11 digitos.');
    }

    const result = await registerStudentSignup(tipo, {
      name: input.name,
      whatsappDigits: input.whatsapp.replace(/\D/g, ''),
      unitId: input.unitId,
      email: input.email,
      cpfDigits,
    });
    if (!result.ok) throw new ApiError(404, 'unit_not_found', 'Unidade nao encontrada.');

    // Matriculado recem-criado cai direto na selecao de aulas (sessao de portal).
    let portal = false;
    if (!result.duplicate && tipo === 'matriculado') {
      const sessionId = await createPortalSession(result.studentId);
      setPortalSessionCookie(res, sessionId);
      portal = true;
    }
    res.status(201).json({ data: { ok: true, portal } });
  }),
);

// --- Links PADRONIZADOS por papel (/cadastro-<papel>) ----------------------
// ATENCAO: contas de staff (professor/coordenacao/administrador) nascem ATIVAS
// a pedido do operador. Risco aceito pelo dono do sistema.
type PapelConfig =
  | { kind: 'student' }
  | { kind: 'staff'; role: Role; needsSubject?: boolean };

const PAPEL_CONFIG: Record<string, PapelConfig> = {
  alunos: { kind: 'student' },
  professor: { kind: 'staff', role: 'professor', needsSubject: true },
  coordenacao: { kind: 'staff', role: 'coordenacao' },
  administrador: { kind: 'staff', role: 'diretor' },
};

const StudentCadastroSchema = z.object({
  name: z.string().trim().min(2).max(120),
  whatsapp: z.string().trim().min(8).max(30),
  unitId: z.string().min(1),
  email: z
    .string()
    .trim()
    .email()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  cpf: z
    .string()
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v : undefined))
    .pipe(z.string().min(11).max(14).optional()),
});

const StaffCadastroSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  password: z.string().min(12).max(200),
  unitId: z.string().optional(),
  subjectId: z.string().optional(),
});

router.get(
  '/cadastro/:papel',
  asyncHandler(async (req, res) => {
    const cfg = PAPEL_CONFIG[req.params.papel];
    if (!cfg) throw new ApiError(404, 'invalid_papel', 'Cadastro nao encontrado.');

    const units = await prisma.unit.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    const needsSubject = cfg.kind === 'staff' && Boolean(cfg.needsSubject);
    const subjects = needsSubject
      ? await prisma.subject.findMany({
          where: { active: true },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        })
      : [];

    res.json({
      data: {
        papel: req.params.papel,
        kind: cfg.kind,
        needsSubject,
        units,
        subjects,
      },
    });
  }),
);

router.post(
  '/cadastro/:papel',
  signupLimiter,
  asyncHandler(async (req, res) => {
    const cfg = PAPEL_CONFIG[req.params.papel];
    if (!cfg) throw new ApiError(404, 'invalid_papel', 'Cadastro nao encontrado.');

    if (cfg.kind === 'student') {
      const input = StudentCadastroSchema.parse(req.body);
      let cpfDigits: string | null = null;
      if (input.cpf) {
        cpfDigits = normalizeCpf(input.cpf);
        if (cpfDigits.length !== 11) {
          throw new ApiError(400, 'invalid_cpf', 'CPF deve ter 11 digitos.');
        }
      }
      // Link aberto cria aluno experimental (sem saldo). Matricula real e
      // confirmada no app.
      const result = await registerStudentSignup('experimental', {
        name: input.name,
        whatsappDigits: input.whatsapp.replace(/\D/g, ''),
        unitId: input.unitId,
        email: input.email,
        cpfDigits,
      });
      if (!result.ok) throw new ApiError(404, 'unit_not_found', 'Unidade nao encontrada.');
      res.status(201).json({ data: { ok: true } });
      return;
    }

    // Staff: cria User ativo com o papel do link.
    const input = StaffCadastroSchema.parse(req.body);
    if (cfg.needsSubject && !input.subjectId) {
      throw new ApiError(400, 'subject_required', 'Selecione a materia.');
    }

    const email = input.email.toLowerCase();
    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) throw new ApiError(409, 'email_in_use', 'Ja existe uma conta com este e-mail.');

    let subjectId: string | null = null;
    if (input.subjectId) {
      const subject = await prisma.subject.findFirst({
        where: { id: input.subjectId, active: true },
      });
      if (!subject) throw new ApiError(404, 'subject_not_found', 'Materia nao encontrada.');
      subjectId = subject.id;
    }
    let unitId: string | null = null;
    if (input.unitId) {
      const unit = await prisma.unit.findFirst({ where: { id: input.unitId, active: true } });
      if (!unit) throw new ApiError(404, 'unit_not_found', 'Unidade nao encontrada.');
      unitId = unit.id;
    }

    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await prisma.user.create({
      data: {
        name: input.name,
        email,
        passwordHash,
        roles: [cfg.role],
        active: true,
        subjectId,
        unitId,
      },
      select: { id: true },
    });
    await prisma.auditLog.create({
      data: {
        actorType: 'system',
        entityType: 'user',
        entityId: user.id,
        action: 'user.public_signup',
        after: { roles: [cfg.role], email, source: 'cadastro_publico' },
      },
    });
    res.status(201).json({ data: { ok: true } });
  }),
);

// Endpoint da EQUIPE (autenticado): tokens dos links de aluno para copiar.
router.get(
  '/signup-links',
  requireAuth,
  requireRole('diretor', 'coordenacao'),
  asyncHandler(async (_req, res) => {
    res.json({
      data: {
        matriculado: env.PUBLIC_SIGNUP_TOKEN_MATRICULADO ?? null,
        experimental: env.PUBLIC_SIGNUP_TOKEN_EXPERIMENTAL ?? null,
      },
    });
  }),
);

export default router;
