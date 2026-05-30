import { Prisma } from '@prisma/client';
import { prisma } from '../db/client.js';
import { logger } from './logger.js';
import { brazilPhoneCandidates, normalizePhone, MIN_PHONE_DIGITS } from './phone.js';
import { getLeadStageIdBySlug } from './lead-stage-cache.js';
import { publishChatEvent } from './whatsapp-events.js';

// Ingestao do webhook do WhatsApp: transforma o payload cru em Conversation/
// Message persistidos, vinculando ao Lead/Student por telefone. Idempotente
// por `Message.waMessageId`. Ver docs/PLANO_CHAT_COEX.md.

// Janela de atendimento do WhatsApp: 24h desde a ultima mensagem do cliente.
export const WINDOW_MS = 24 * 60 * 60 * 1000;

export function isWindowOpen(lastInboundAt: Date | null | undefined, now: Date = new Date()): boolean {
  if (!lastInboundAt) return false;
  return now.getTime() - lastInboundAt.getTime() < WINDOW_MS;
}

type WaMessage = {
  id?: string;
  from?: string;
  type?: string;
  timestamp?: string;
  text?: { body?: string };
};
type WaStatus = { id?: string; status?: string; recipient_id?: string };
type WaContact = { wa_id?: string; profile?: { name?: string } };
type WaValue = {
  contacts?: WaContact[];
  messages?: WaMessage[];
  statuses?: WaStatus[];
  message_echoes?: WaMessage[];
};
type WaPayload = { entry?: Array<{ changes?: Array<{ field?: string; value?: WaValue }> }> };

export type ParsedEvent =
  | { kind: 'message'; externalEventId: string; phone: string; name?: string; waMessage: WaMessage }
  | { kind: 'echo'; externalEventId: string; phone: string; waMessage: WaMessage }
  | { kind: 'status'; externalEventId: string; waMessageId: string; status: string };

/** Extrai os eventos relevantes do payload do webhook (puro, testavel). */
export function collectEvents(body: unknown): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  const entries = (body as WaPayload)?.entry ?? [];
  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const contactName = value.contacts?.[0]?.profile?.name;
      const contactWaId = value.contacts?.[0]?.wa_id;

      for (const msg of value.messages ?? []) {
        const phone = normalizePhone(msg.from ?? contactWaId);
        if (msg.id && phone) {
          events.push({ kind: 'message', externalEventId: `wa:msg:${msg.id}`, phone, name: contactName, waMessage: msg });
        }
      }
      for (const echo of value.message_echoes ?? []) {
        // No echo, `from` e o numero do CLIENTE (destinatario da resposta da equipe).
        const phone = normalizePhone(echo.from ?? contactWaId);
        if (echo.id && phone) {
          events.push({ kind: 'echo', externalEventId: `wa:echo:${echo.id}`, phone, waMessage: echo });
        }
      }
      for (const st of value.statuses ?? []) {
        if (st.id && st.status) {
          events.push({ kind: 'status', externalEventId: `wa:status:${st.id}:${st.status}`, waMessageId: st.id, status: st.status });
        }
      }
    }
  }
  return events;
}

const STATUS_MAP: Record<string, 'sent' | 'delivered' | 'read' | 'failed'> = {
  sent: 'sent',
  delivered: 'delivered',
  read: 'read',
  failed: 'failed',
};

/** Acha o Lead vinculavel por telefone (cobre as formas com/sem o 9). */
async function findLeadIdByPhone(phone: string): Promise<string | null> {
  const lead = await prisma.lead.findFirst({
    where: { whatsapp: { in: brazilPhoneCandidates(phone) } },
    select: { id: true },
  });
  return lead?.id ?? null;
}

async function findStudent(phone: string): Promise<{ id: string; unitId: string | null } | null> {
  const student = await prisma.student.findFirst({
    where: { whatsapp: { in: brazilPhoneCandidates(phone) }, active: true },
    select: { id: true, unitId: true },
  });
  return student ?? null;
}

/**
 * Garante a Conversation do telefone, vinculando Lead/Student quando casa.
 * Se nenhum lead casar, cria um Lead novo (stage `novo_lead`) — mesmo
 * comportamento do webhook BotConversa, pra todo inbound virar lead no funil.
 */
async function ensureConversation(phone: string, name?: string): Promise<{ id: string; lastInboundAt: Date | null }> {
  const existing = await prisma.conversation.findUnique({
    where: { phone },
    select: { id: true, lastInboundAt: true },
  });
  if (existing) return existing;

  const student = await findStudent(phone);
  let leadId = await findLeadIdByPhone(phone);
  if (!leadId && !student) {
    const stageId = await getLeadStageIdBySlug('novo_lead');
    const lead = await prisma.lead.create({
      data: {
        name: name ?? 'Lead WhatsApp',
        whatsapp: phone,
        unitInterest: 'Nao informado',
        source: 'WhatsApp',
        stageId,
      },
      select: { id: true },
    });
    leadId = lead.id;
  }

  return prisma.conversation.create({
    data: {
      phone,
      name,
      leadId,
      studentId: student?.id,
      unitId: student?.unitId ?? null,
    },
    select: { id: true, lastInboundAt: true },
  });
}

/** Aplica um evento ja parseado ao banco. Idempotente; emite no event bus. */
async function applyEvent(event: ParsedEvent): Promise<void> {
  if (event.kind === 'status') {
    const mapped = STATUS_MAP[event.status];
    if (!mapped) return;
    const result = await prisma.message.updateMany({
      where: { waMessageId: event.waMessageId },
      data: { status: mapped },
    });
    if (result.count > 0) {
      const msg = await prisma.message.findUnique({
        where: { waMessageId: event.waMessageId },
        select: { conversationId: true },
      });
      if (msg) {
        publishChatEvent({ type: 'message.status', conversationId: msg.conversationId, waMessageId: event.waMessageId, status: mapped });
      }
    }
    return;
  }

  if (normalizePhone(event.phone).length < MIN_PHONE_DIGITS) return;

  const conversation = await ensureConversation(event.phone, event.kind === 'message' ? event.name : undefined);
  const isInbound = event.kind === 'message';
  const now = new Date();

  try {
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        waMessageId: event.waMessage.id,
        direction: isInbound ? 'inbound' : 'outbound',
        type: event.waMessage.type ?? 'text',
        body: event.waMessage.text?.body ?? null,
        status: isInbound ? 'received' : 'sent',
      },
    });

    const updated = await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: now,
        ...(isInbound ? { lastInboundAt: now, unreadCount: { increment: 1 } } : {}),
        ...(event.kind === 'message' && event.name ? { name: event.name } : {}),
      },
    });

    publishChatEvent({ type: 'message.created', conversationId: conversation.id, message });
    publishChatEvent({ type: 'conversation.updated', conversationId: conversation.id, conversation: updated });
  } catch (error) {
    // Unicidade do waMessageId = evento repetido (idempotente): ignora.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return;
    throw error;
  }
}

/** Processa o payload inteiro do webhook. Erros por evento nao derrubam os demais. */
export async function ingestWhatsAppPayload(body: unknown): Promise<void> {
  for (const event of collectEvents(body)) {
    try {
      await applyEvent(event);
    } catch (error) {
      logger.error('whatsapp_ingest_failed', { externalEventId: event.externalEventId });
    }
  }
}
