import { logger } from './logger.js';

// Le `process.env` direto (e nao o `env` parseado) porque os testes precisam
// alternar a chave em runtime; em prod e dev o valor e o mesmo.
function getApiKey(): string | undefined {
  const key = process.env.BOTCONVERSA_API_KEY;
  return key && key.length > 0 ? key : undefined;
}

// Cliente fino do BotConversa para envio de mensagens (magic link, futuros
// lembretes). Pensado para falhar de forma silenciosa quando a chave ainda
// nao foi configurada — permite subir o deploy antes do acesso ao painel
// e ligar depois sem trocar codigo.
//
// Endpoints documentados em docs/BOTCONVERSA_INTEGRACAO.md.

const BASE_URL = 'https://backend.botconversa.com.br/api/v1/webhook';
const REQUEST_TIMEOUT_MS = 5000;

export class BotConversaError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'BotConversaError';
  }
}

type Subscriber = {
  id: number;
  phone: string;
  first_name?: string;
  last_name?: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T | null> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new BotConversaError('BotConversa nao configurado.');
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'API-KEY': apiKey,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  // 404 e um "nao encontrado" legitimo (contato inexistente) — devolve null.
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new BotConversaError(`BotConversa retornou ${response.status} em ${path}`, response.status);
  }
  // O endpoint de send_message responde 200 sem body util; o de lookup tem JSON.
  const text = await response.text();
  return text ? (JSON.parse(text) as T) : (null as T | null);
}

/** Busca um contato pelo telefone (so digitos). `null` se nao existe. */
export async function getSubscriberByPhone(phone: string): Promise<Subscriber | null> {
  const digits = phone.replace(/\D/g, '');
  return request<Subscriber>(`/subscriber/get_by_phone/${digits}/`);
}

/** Envia uma mensagem de texto para um subscriber existente. */
export async function sendTextMessage(subscriberId: number | string, text: string): Promise<void> {
  await request(`/subscriber/${subscriberId}/send_message/`, {
    method: 'POST',
    body: JSON.stringify({ type: 'text', value: text }),
  });
}

/**
 * Envia mensagem para um telefone fazendo o lookup do subscriber antes.
 * Devolve `true` se entregou, `false` se:
 *   - a `BOTCONVERSA_API_KEY` nao esta configurada (logado como aviso), ou
 *   - o contato nao existe no BotConversa.
 * Erros genuinos (rede, 401, 5xx) sao lancados para o caller decidir.
 */
export async function sendMessageByPhone(phone: string, text: string): Promise<boolean> {
  const apiKey = getApiKey();
  if (!apiKey) {
    logger.warn('botconversa_not_configured', { event: 'send_skipped' });
    return false;
  }
  const subscriber = await getSubscriberByPhone(phone);
  if (!subscriber) return false;
  await sendTextMessage(subscriber.id, text);
  return true;
}
