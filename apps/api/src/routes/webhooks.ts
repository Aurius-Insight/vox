import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { env } from '../config/env.js';
import { prisma } from '../db/client.js';
import { webhookLimiter } from '../middleware/rateLimit.js';
import { ApiError, asyncHandler } from '../lib/http.js';
import { getLeadStageIdBySlug } from '../lib/lead-stage-cache.js';

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
      campaign: z.string().max(120).optional(),
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

export default router;
