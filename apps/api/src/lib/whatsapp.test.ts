import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isConfigured, sendText, verifyWebhookSignature, WhatsAppError } from './whatsapp.js';

// Garante estado limpo: o `.env` real (carregado pelo config/env) pode trazer
// as WHATSAPP_* preenchidas — zeramos antes e depois de cada teste.
function clearWhatsAppEnv() {
  delete process.env.WHATSAPP_ACCESS_TOKEN;
  delete process.env.WHATSAPP_TEMP_TOKEN;
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  delete process.env.WHATSAPP_APP_SECRET;
}

beforeEach(clearWhatsAppEnv);
afterEach(() => {
  vi.unstubAllGlobals();
  clearWhatsAppEnv();
});

function stubFetch(response: { status: number; body?: unknown }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      text: async () => (response.body === undefined ? '' : JSON.stringify(response.body)),
    })) as unknown as typeof fetch,
  );
}

describe('isConfigured', () => {
  it('false sem token/phone_number_id', () => {
    expect(isConfigured()).toBe(false);
  });

  it('true com token e phone_number_id', () => {
    process.env.WHATSAPP_ACCESS_TOKEN = 't';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '123';
    expect(isConfigured()).toBe(true);
  });

  it('aceita o token temporario de sandbox', () => {
    process.env.WHATSAPP_TEMP_TOKEN = 't';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '123';
    expect(isConfigured()).toBe(true);
  });
});

describe('sendText', () => {
  it('devolve null (no-op) quando nao configurado', async () => {
    const result = await sendText('21999998888', 'oi');
    expect(result).toBeNull();
  });

  it('normaliza o telefone e devolve o messageId', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = 't';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '123';
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ messages: [{ id: 'wamid.ABC' }] }),
    }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const result = await sendText('(21) 99999-8888', 'oi');
    expect(result).toEqual({ messageId: 'wamid.ABC' });
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sentBody.to).toBe('21999998888');
    expect(sentBody.messaging_product).toBe('whatsapp');
  });

  it('lanca WhatsAppError em status nao-2xx', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = 't';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '123';
    stubFetch({ status: 401, body: { error: 'bad token' } });
    await expect(sendText('21999998888', 'oi')).rejects.toBeInstanceOf(WhatsAppError);
  });
});

describe('verifyWebhookSignature', () => {
  it('fora de producao deixa passar (sandbox)', () => {
    // NODE_ENV de teste != production -> retorna true sem checar.
    expect(verifyWebhookSignature(Buffer.from('{}'), 'sha256=qualquer')).toBe(true);
  });
});
