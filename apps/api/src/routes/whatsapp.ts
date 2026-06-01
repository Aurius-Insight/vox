import { Router } from 'express';
import { z } from 'zod';
import type { Conversation, Message } from '@prisma/client';
import { prisma } from '../db/client.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { ApiError, asyncHandler, maskPhone, parsePagination } from '../lib/http.js';
import { logger } from '../lib/logger.js';
import { normalizePhone } from '../lib/phone.js';
import { isWindowOpen } from '../lib/whatsapp-ingest.js';
import {
  invalidateAccountCache,
  resolveCredentials,
  sendText,
  sendTemplate,
  WhatsAppError,
} from '../lib/whatsapp.js';
import { publishChatEvent, subscribeChatEvents } from '../lib/whatsapp-events.js';

const router = Router();

// Acesso ao Atendimento: diretor + coordenacao e o papel `revisor` (analista da
// Meta no App Review — restrito ao Atendimento, sem dados reais de aluno/lead).
const guard = [requireAuth, requireRole('diretor', 'coordenacao', 'revisor')] as const;
// Conectar o numero oficial: diretor + revisor (revisor consegue abrir o
// Embedded Signup p/ demonstrar o Facebook Login; o POST real fica no diretor).
const adminGuard = [requireAuth, requireRole('diretor', 'revisor')] as const;
const GRAPH = 'https://graph.facebook.com';

type ConversationWithLast = Conversation & { messages: Message[] };

function toConversationDto(c: ConversationWithLast, canViewSensitive: boolean) {
  const last = c.messages[0];
  return {
    id: c.id,
    name: c.name,
    phone: canViewSensitive ? c.phone : maskPhone(c.phone),
    leadId: c.leadId,
    studentId: c.studentId,
    unreadCount: c.unreadCount,
    windowOpen: isWindowOpen(c.lastInboundAt),
    lastMessageAt: c.lastMessageAt,
    lastMessagePreview: last ? { direction: last.direction, body: last.body, type: last.type } : null,
  };
}

function toMessageDto(m: Message) {
  return {
    id: m.id,
    direction: m.direction,
    type: m.type,
    body: m.body,
    templateName: m.templateName,
    status: m.status,
    sentByUserId: m.sentByUserId,
    createdAt: m.createdAt,
  };
}

// GET /api/whatsapp/conversations?search=&page=&pageSize=
router.get(
  '/conversations',
  ...guard,
  asyncHandler(async (req, res) => {
    const search = z.string().max(80).optional().parse(req.query.search);
    const { page, pageSize, offset } = parsePagination(req.query);
    const canViewSensitive = req.user!.roles.includes('diretor');

    const where = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { phone: { contains: normalizePhone(search) || search } },
          ],
        }
      : {};

    const [items, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        orderBy: { lastMessageAt: 'desc' },
        skip: offset,
        take: pageSize,
        include: { messages: { take: 1, orderBy: { createdAt: 'desc' } } },
      }),
      prisma.conversation.count({ where }),
    ]);

    res.json({ data: items.map((c) => toConversationDto(c, canViewSensitive)), page, pageSize, total });
  }),
);

// GET /api/whatsapp/conversations/:id/messages — ultimas N em ordem cronologica
router.get(
  '/conversations/:id/messages',
  ...guard,
  asyncHandler(async (req, res) => {
    const { pageSize } = parsePagination(req.query);
    const conversation = await prisma.conversation.findUnique({ where: { id: req.params.id } });
    if (!conversation) throw new ApiError(404, 'not_found', 'Conversa nao encontrada.');

    const [latest, total] = await Promise.all([
      prisma.message.findMany({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: 'desc' },
        take: pageSize,
      }),
      prisma.message.count({ where: { conversationId: conversation.id } }),
    ]);

    res.json({
      data: latest.reverse().map(toMessageDto),
      windowOpen: isWindowOpen(conversation.lastInboundAt),
      total,
    });
  }),
);

const SendSchema = z
  .object({
    text: z.string().min(1).max(4096).optional(),
    templateName: z.string().min(1).max(120).optional(),
    languageCode: z.string().min(2).max(10).optional(),
  })
  .refine((d) => Boolean(d.text) || Boolean(d.templateName), {
    message: 'Informe `text` (janela aberta) ou `templateName`.',
  });

// POST /api/whatsapp/conversations/:id/messages — envia texto ou template
router.post(
  '/conversations/:id/messages',
  ...guard,
  asyncHandler(async (req, res) => {
    const input = SendSchema.parse(req.body);
    const conversation = await prisma.conversation.findUnique({ where: { id: req.params.id } });
    if (!conversation) throw new ApiError(404, 'not_found', 'Conversa nao encontrada.');

    const isTemplate = Boolean(input.templateName);
    // Texto livre so dentro da janela de 24h; fora dela, exige template.
    if (!isTemplate && !isWindowOpen(conversation.lastInboundAt)) {
      throw new ApiError(422, 'window_closed', 'Janela de 24h fechada — envie um template aprovado.');
    }

    let result;
    try {
      result = isTemplate
        ? await sendTemplate(conversation.phone, input.templateName!, input.languageCode ?? 'pt_BR')
        : await sendText(conversation.phone, input.text!);
    } catch (error) {
      const reason = error instanceof WhatsAppError ? error.message : 'erro desconhecido';
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          direction: 'outbound',
          type: isTemplate ? 'template' : 'text',
          body: input.text ?? null,
          templateName: input.templateName ?? null,
          status: 'failed',
          sentByUserId: req.user!.id,
          errorReason: reason,
        },
      });
      logger.error('whatsapp_send_failed', { conversationId: conversation.id });
      throw new ApiError(502, 'send_failed', 'Falha ao enviar a mensagem pelo WhatsApp.');
    }

    if (!result) throw new ApiError(503, 'whatsapp_not_configured', 'WhatsApp nao configurado.');

    const now = new Date();
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        waMessageId: result.messageId || null,
        direction: 'outbound',
        type: isTemplate ? 'template' : 'text',
        body: input.text ?? null,
        templateName: input.templateName ?? null,
        status: 'sent',
        sentByUserId: req.user!.id,
      },
    });
    const updated = await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: now },
    });

    publishChatEvent({ type: 'message.created', conversationId: conversation.id, message });
    publishChatEvent({ type: 'conversation.updated', conversationId: conversation.id, conversation: updated });

    res.status(201).json({ data: toMessageDto(message) });
  }),
);

// POST /api/whatsapp/conversations/:id/read — zera o contador de nao-lidas
router.post(
  '/conversations/:id/read',
  ...guard,
  asyncHandler(async (req, res) => {
    const conversation = await prisma.conversation.findUnique({ where: { id: req.params.id } });
    if (!conversation) throw new ApiError(404, 'not_found', 'Conversa nao encontrada.');

    const updated = await prisma.conversation.update({
      where: { id: conversation.id },
      data: { unreadCount: 0 },
    });
    publishChatEvent({ type: 'conversation.updated', conversationId: conversation.id, conversation: updated });
    res.json({ data: { id: updated.id, unreadCount: updated.unreadCount } });
  }),
);

// GET /api/whatsapp/templates — templates aprovados (cache em memoria, 5min)
type TemplateDto = { name: string; language: string; category?: string };
let templateCache: { at: number; data: TemplateDto[] } | null = null;
const TEMPLATE_TTL_MS = 5 * 60 * 1000;

router.get(
  '/templates',
  ...guard,
  asyncHandler(async (_req, res) => {
    if (templateCache && Date.now() - templateCache.at < TEMPLATE_TTL_MS) {
      res.json({ data: templateCache.data });
      return;
    }

    const creds = await resolveCredentials();
    const wabaId = creds?.wabaId;
    const token = creds?.accessToken;
    const version = process.env.WHATSAPP_API_VERSION ?? 'v23.0';
    const fallback: TemplateDto[] = [{ name: 'hello_world', language: 'en_US' }];

    if (!wabaId || !token) {
      res.json({ data: fallback });
      return;
    }

    try {
      const url = `${GRAPH}/${version}/${wabaId}/message_templates?fields=name,status,language,category&limit=100`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`graph ${response.status}`);
      const json = (await response.json()) as {
        data?: Array<{ name: string; status: string; language: string; category?: string }>;
      };
      const data = (json.data ?? [])
        .filter((t) => t.status === 'APPROVED')
        .map((t) => ({ name: t.name, language: t.language, category: t.category }));
      templateCache = { at: Date.now(), data };
      res.json({ data });
    } catch (error) {
      logger.error('whatsapp_templates_fetch_failed', {});
      res.json({ data: fallback });
    }
  }),
);

// --- Embedded Signup (conexao do numero real via CoEx) ---

// GET /api/whatsapp/connect/config — dados publicos p/ o FB.login no frontend
router.get(
  '/connect/config',
  ...guard,
  asyncHandler(async (_req, res) => {
    res.json({
      data: {
        appId: process.env.WHATSAPP_APP_ID ?? process.env.APP_ID ?? null,
        configId: process.env.WHATSAPP_ES_CONFIG_ID ?? null,
        featureType: process.env.WHATSAPP_ES_FEATURE_TYPE ?? 'whatsapp_business_app_onboarding',
        graphVersion: process.env.WHATSAPP_API_VERSION ?? 'v23.0',
      },
    });
  }),
);

// GET /api/whatsapp/connect/status — qual numero esta conectado
router.get(
  '/connect/status',
  ...guard,
  asyncHandler(async (_req, res) => {
    const account = await prisma.whatsAppAccount.findFirst({ orderBy: { updatedAt: 'desc' } });
    res.json({
      data: account
        ? { connected: true, wabaId: account.wabaId, phoneNumberId: account.phoneNumberId, displayPhone: account.displayPhone }
        : { connected: false },
    });
  }),
);

const ConnectSchema = z.object({
  code: z.string().min(1),
  wabaId: z.string().min(1),
  phoneNumberId: z.string().min(1),
});

// POST /api/whatsapp/connect — troca o code por token, inscreve o webhook e
// persiste a conta. So diretor. (Requer Advanced Access aprovado para o numero real.)
router.post(
  '/connect',
  ...adminGuard,
  asyncHandler(async (req, res) => {
    const input = ConnectSchema.parse(req.body);
    const appId = process.env.WHATSAPP_APP_ID ?? process.env.APP_ID;
    const appSecret = process.env.WHATSAPP_APP_SECRET;
    const version = process.env.WHATSAPP_API_VERSION ?? 'v23.0';
    if (!appId || !appSecret) {
      throw new ApiError(503, 'not_configured', 'App ID/Secret do WhatsApp ausentes.');
    }

    // 1) Troca o code por um token de System User.
    const tokenUrl = `${GRAPH}/${version}/oauth/access_token?client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(appSecret)}&code=${encodeURIComponent(input.code)}`;
    const tokenRes = await fetch(tokenUrl, { signal: AbortSignal.timeout(8000) });
    const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: { message?: string } };
    if (!tokenRes.ok || !tokenJson.access_token) {
      logger.error('whatsapp_connect_exchange_failed', { status: tokenRes.status });
      throw new ApiError(502, 'exchange_failed', 'Falha ao trocar o code por token.');
    }
    const accessToken = tokenJson.access_token;

    // 2) Inscreve o app no webhook da WABA conectada.
    try {
      await fetch(`${GRAPH}/${version}/${input.wabaId}/subscribed_apps`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      logger.warn('whatsapp_connect_subscribe_failed', { wabaId: input.wabaId });
    }

    // 3) Persiste a conta (upsert por WABA) e invalida o cache do cliente.
    const account = await prisma.whatsAppAccount.upsert({
      where: { wabaId: input.wabaId },
      create: {
        wabaId: input.wabaId,
        phoneNumberId: input.phoneNumberId,
        accessToken,
        connectedByUserId: req.user!.id,
      },
      update: { phoneNumberId: input.phoneNumberId, accessToken, connectedByUserId: req.user!.id },
    });
    invalidateAccountCache();

    logger.info('whatsapp_connected', { wabaId: account.wabaId, phoneNumberId: account.phoneNumberId });
    res.status(201).json({ data: { connected: true, wabaId: account.wabaId, phoneNumberId: account.phoneNumberId } });
  }),
);

// GET /api/whatsapp/stream — SSE com eventos do chat em tempo real
router.get('/stream', ...guard, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');

  const unsubscribe = subscribeChatEvents((event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });
  // Heartbeat para manter a conexao viva atraves de proxies.
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

export default router;
