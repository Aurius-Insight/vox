import { Router } from 'express';
import { z } from 'zod';
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

// Resolve o token secreto para o tipo de aluno. Tokens diferentes por tipo:
// quem tem o link de experimental nao consegue cadastrar matriculado.
function resolveSignupType(token: string): SignupType | null {
  if (
    env.PUBLIC_SIGNUP_TOKEN_MATRICULADO &&
    token === env.PUBLIC_SIGNUP_TOKEN_MATRICULADO
  ) {
    return 'matriculado';
  }
  if (
    env.PUBLIC_SIGNUP_TOKEN_EXPERIMENTAL &&
    token === env.PUBLIC_SIGNUP_TOKEN_EXPERIMENTAL
  ) {
    return 'experimental';
  }
  return null;
}

const SignupSchema = z.object({
  name: z.string().trim().min(2).max(120),
  whatsapp: z.string().trim().min(8).max(30),
  unitId: z.string().min(1),
  email: z
    .string()
    .trim()
    .email()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  // CPF obrigatorio: e o login do portal (o aluno cai direto na selecao de
  // aulas apos cadastrar e volta depois pelo /portal/entrar com o CPF).
  cpf: z.string().trim().min(11).max(14),
});

// Valida o token e devolve o tipo + unidades ativas para montar o formulario.
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

// Cria o aluno (do tipo definido pelo token) ja vinculado a um lead na etapa
// correspondente do CRM (source = cadastro_publico). Matriculado entra com o
// pacote padrao cheio; experimental sem pacote/saldo.
router.post(
  '/signup/:token',
  signupLimiter,
  asyncHandler(async (req, res) => {
    const tipo = resolveSignupType(req.params.token);
    if (!tipo) throw new ApiError(404, 'invalid_token', 'Link invalido ou expirado.');

    const input = SignupSchema.parse(req.body);
    const whatsappDigits = input.whatsapp.replace(/\D/g, '');

    const cpfDigits = normalizeCpf(input.cpf);
    if (cpfDigits.length !== 11) {
      throw new ApiError(400, 'invalid_cpf', 'CPF deve ter 11 digitos.');
    }

    const result = await withEnrollmentCodeRetry(() =>
      prisma.$transaction(async (tx) => {
        const unit = await tx.unit.findFirst({ where: { id: input.unitId, active: true } });
        if (!unit) return { ok: false as const, error: 'unit_not_found' as const };

        // Dedup silencioso: se ja existe aluno ativo com esse whatsapp, nao
        // duplica. Resposta de sucesso generica (nao revela cadastro).
        const existing = await tx.student.findFirst({
          where: { whatsapp: whatsappDigits, active: true },
          select: { id: true },
        });
        if (existing) return { ok: true as const, duplicate: true as const };

        const cpfHashValue = hashCpf(cpfDigits);
        const byCpf = await tx.student.findFirst({ where: { cpfHash: cpfHashValue } });
        if (byCpf) return { ok: true as const, duplicate: true as const };
        const cpfMaskedValue = maskCpf(cpfDigits) ?? null;

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
          where: { whatsapp: whatsappDigits, student: { is: null } },
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
                  whatsapp: whatsappDigits,
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
            whatsapp: whatsappDigits,
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

    if (!result.ok) {
      throw new ApiError(404, 'unit_not_found', 'Unidade nao encontrada.');
    }

    // Matriculado recem-criado cai direto na selecao de aulas: cria a sessao de
    // portal (login automatico) e o front redireciona pra /portal. Experimental
    // e duplicados ficam na confirmacao — o portal e exclusivo de matriculado e
    // o trial do experimental e agendado pela equipe.
    let portal = false;
    if (!result.duplicate && tipo === 'matriculado') {
      const sessionId = await createPortalSession(result.studentId);
      setPortalSessionCookie(res, sessionId);
      portal = true;
    }
    res.status(201).json({ data: { ok: true, portal } });
  }),
);

// Endpoint da EQUIPE (autenticado): devolve os links completos para copiar e
// enviar. So diretor/coordenacao. Retorna null quando o token nao esta
// configurado no ambiente.
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
