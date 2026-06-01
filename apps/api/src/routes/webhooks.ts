import { Router } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { env } from '../config/env.js';
import { prisma } from '../db/client.js';
import { webhookLimiter } from '../middleware/rateLimit.js';
import { ApiError, asyncHandler } from '../lib/http.js';
import { getLeadStageIdBySlug } from '../lib/lead-stage-cache.js';
import { verifyWebhookSignature } from '../lib/whatsapp.js';
import { ingestWhatsAppPayload } from '../lib/whatsapp-ingest.js';
import { logger } from '../lib/logger.js';

const router = Router();

const BotConversaPayloadSchema = z.object({
  eventId: z.string().min(1).max(160),
  contact: z.object({
    id: z.string().min(1).max(160).optional(),
    name: z.string().min(1).max(120),
    whatsapp: z.string().min(8).max(30),
  }),
  fields: z
    .object({
      unitInterest: z.string().max(80).optional(),
      campaign: z
        .string()
        .max(120)
        .transform((v) => v.trim().replace(/\s+/g, ' '))
        .refine((v) => v.length > 0, { message: 'Campanha vazia.' })
        .optional(),
    })
    .optional(),
});

function hasValidWebhookSecret(secret?: string) {
  if (!secret) return false;
  const expected = Buffer.from(env.WEBHOOK_SECRET);
  const received = Buffer.from(secret);
  if (received.length !== expected.length) return false;
  return timingSafeEqual(received, expected);
}

router.post(
  '/botconversa',
  webhookLimiter,
  asyncHandler(async (req, res) => {
    const secret = req.get('X-VOX-Webhook-Secret');
    if (!hasValidWebhookSecret(secret)) {
      throw new ApiError(401, 'invalid_webhook_secret', 'Webhook nao autorizado.');
    }

    const payload = BotConversaPayloadSchema.parse(req.body);
    const whatsapp = payload.contact.whatsapp.replace(/\D/g, '');

    const result = await prisma.$transaction(async (tx) => {
      const existingEvent = await tx.integrationEvent.findUnique({
        where: { externalEventId: payload.eventId },
      });
      if (existingEvent) return { status: 'duplicated' as const, leadId: undefined };

      await tx.integrationEvent.create({
        data: {
          source: 'botconversa',
          externalEventId: payload.eventId,
          payload: payload as Prisma.InputJsonValue,
        },
      });

      const existingLead = await tx.lead.findFirst({
        where: { whatsapp },
      });

      if (existingLead) {
        const lead = await tx.lead.update({
          where: { id: existingLead.id },
          data: {
            name: payload.contact.name || existingLead.name,
            campaign: payload.fields?.campaign ?? existingLead.campaign,
            unitInterest: payload.fields?.unitInterest ?? existingLead.unitInterest,
            botconversaContactId: payload.contact.id ?? existingLead.botconversaContactId,
          },
        });
        return { status: 'updated' as const, leadId: lead.id };
      }

      const stageId = await getLeadStageIdBySlug('novo_lead', tx);
      const lead = await tx.lead.create({
        data: {
          name: payload.contact.name,
          whatsapp,
          unitInterest: payload.fields?.unitInterest ?? 'Nao informado',
          campaign: payload.fields?.campaign,
          source: 'BotConversa',
          stageId,
          botconversaContactId: payload.contact.id,
        },
      });

      return { status: 'created' as const, leadId: lead.id };
    });

    res.status(result.status === 'duplicated' ? 200 : 202).json({
      status: result.status,
      leadId: result.leadId,
    });
  }),
);

// --- WhatsApp Cloud API (CoEx) ---

// Verificacao do webhook (handshake da Meta): ela faz um GET com
// `hub.mode=subscribe`, `hub.verify_token` e `hub.challenge`. Se o token casar
// com o nosso, devolvemos o challenge cru em texto.
router.get('/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

  if (mode === 'subscribe' && expected && token === expected) {
    res.status(200).send(String(challenge ?? ''));
    return;
  }
  res.sendStatus(403);
});

router.post(
  '/whatsapp',
  webhookLimiter,
  asyncHandler(async (req, res) => {
    const rawBody = (req as { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    if (!verifyWebhookSignature(rawBody, req.get('X-Hub-Signature-256'))) {
      throw new ApiError(401, 'invalid_signature', 'Assinatura do webhook invalida.');
    }

    // Responde 200 cedo (a Meta exige < ~30s); persistir/ingerir depois.
    res.sendStatus(200);

    const body = req.body;

    // Auditoria: guarda o payload cru da entrega (idempotente por hash do corpo
    // — reentregas da Meta tem o mesmo corpo, entao deduplicam).
    const deliveryHash = createHash('sha256').update(rawBody).digest('hex');
    try {
      await prisma.integrationEvent.create({
        data: {
          source: 'whatsapp',
          externalEventId: `wa:delivery:${deliveryHash}`,
          payload: body as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
        logger.error('whatsapp_audit_persist_failed', { deliveryHash });
      }
    }

    // Ingestao: transforma em Conversation/Message e emite no event bus (SSE).
    await ingestWhatsAppPayload(body);
  }),
);

export default router;
