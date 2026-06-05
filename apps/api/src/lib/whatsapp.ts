import { createHmac, timingSafeEqual } from 'node:crypto';
import { isProduction } from '../config/env.js';
import { prisma } from '../db/client.js';
import { brazilSendNumber } from './phone.js';
import { logger } from './logger.js';

// Cliente fino da WhatsApp Cloud API (modo Coexistence/CoEx). Espelha o padrao
// de src/lib/botconversa.ts: le `process.env` direto (os testes trocam os
// valores em runtime), timeout via AbortSignal e falha silenciosa quando ainda
// nao configurado — permite subir o deploy antes de ligar o numero e ativar
// depois sem trocar codigo.
//
// Setup, endpoints e decisoes em docs/PLANO_CHAT_COEX.md.

const GRAPH_HOST = 'https://graph.facebook.com';
const REQUEST_TIMEOUT_MS = 5000;

function apiVersion(): string {
  return process.env.WHATSAPP_API_VERSION ?? 'v23.0';
}

function accessToken(): string | undefined {
  // Aceita o nome de prod (`WHATSAPP_ACCESS_TOKEN`) e o temporario de sandbox
  // (`WHATSAPP_TEMP_TOKEN`) — facilita os primeiros testes sem renomear nada.
  const token = process.env.WHATSAPP_ACCESS_TOKEN ?? process.env.WHATSAPP_TEMP_TOKEN;
  return token && token.length > 0 ? token : undefined;
}

function phoneNumberId(): string | undefined {
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID;
  return id && id.length > 0 ? id : undefined;
}

export class WhatsAppError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'WhatsAppError';
  }
}

/** `true` quando ha token e phone_number_id — caso contrario o envio e no-op. */
export function isConfigured(): boolean {
  return Boolean(accessToken() && phoneNumberId());
}

export type SendResult = { messageId: string } | null;

export type WhatsAppCredentials = { phoneNumberId: string; accessToken: string; wabaId?: string };

// Cache curto da conta conectada (Embedded Signup). Quando existe, ela tem
// prioridade sobre as envs de teste.
let accountCache: { at: number; creds: WhatsAppCredentials | null } | null = null;
const ACCOUNT_TTL_MS = 30_000;

export function invalidateAccountCache(): void {
  accountCache = null;
}

/** Conta conectada (DB) > envs de teste. `null` se nada configurado. */
export async function resolveCredentials(): Promise<WhatsAppCredentials | null> {
  if (!accountCache || Date.now() - accountCache.at >= ACCOUNT_TTL_MS) {
    let creds: WhatsAppCredentials | null = null;
    try {
      const row = await prisma.whatsAppAccount.findFirst({ orderBy: { updatedAt: 'desc' } });
      if (row) creds = { phoneNumberId: row.phoneNumberId, accessToken: row.accessToken, wabaId: row.wabaId };
    } catch {
      // Sem DB (ex.: testes puros) — cai para as envs.
    }
    accountCache = { at: Date.now(), creds };
  }
  if (accountCache.creds) return accountCache.creds;

  const token = accessToken();
  const fromId = phoneNumberId();
  if (token && fromId) {
    return { phoneNumberId: fromId, accessToken: token, wabaId: process.env.WHATSAPP_WABA_ID };
  }
  return null;
}

async function postMessage(body: Record<string, unknown>): Promise<SendResult> {
  const creds = await resolveCredentials();
  if (!creds) {
    logger.warn('whatsapp_not_configured', { event: 'send_skipped' });
    return null;
  }
  const { phoneNumberId: fromId, accessToken: token } = creds;

  const response = await fetch(`${GRAPH_HOST}/${apiVersion()}/${fromId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new WhatsAppError(`WhatsApp retornou ${response.status} em /messages`, response.status);
  }
  const json = text ? (JSON.parse(text) as { messages?: Array<{ id?: string }> }) : {};
  return { messageId: json.messages?.[0]?.id ?? '' };
}

/** Texto livre — so entrega dentro da janela de atendimento de 24h. */
export async function sendText(toPhone: string, text: string): Promise<SendResult> {
  return postMessage({
    to: brazilSendNumber(toPhone),
    type: 'text',
    text: { preview_url: false, body: text },
  });
}

/** Template aprovado — usado para iniciar conversa fora da janela de 24h. */
export async function sendTemplate(
  toPhone: string,
  name: string,
  languageCode = 'pt_BR',
  components?: unknown[],
): Promise<SendResult> {
  return postMessage({
    to: brazilSendNumber(toPhone),
    type: 'template',
    template: {
      name,
      language: { code: languageCode },
      ...(components ? { components } : {}),
    },
  });
}

/**
 * Valida a assinatura `X-Hub-Signature-256` do webhook contra o App Secret.
 * Fora de producao retorna `true` para nao travar os eventos de teste do
 * painel da Meta. Em producao, exige assinatura valida quando ha App Secret;
 * sem App Secret, loga aviso e deixa passar (config a corrigir, nao ataque).
 */
export function verifyWebhookSignature(rawBody: Buffer, signatureHeader?: string): boolean {
  if (!isProduction) return true;

  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) {
    logger.warn('whatsapp_signature_skipped', { reason: 'no_app_secret' });
    return true;
  }
  if (!signatureHeader?.startsWith('sha256=')) return false;

  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const received = signatureHeader.slice('sha256='.length);
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
