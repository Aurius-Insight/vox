import { afterEach, describe, expect, it, vi } from 'vitest';
import { BotConversaError, getSubscriberByPhone, sendMessageByPhone } from './botconversa.js';

// Os testes da suite rodam com BOTCONVERSA_API_KEY ausente; setamos por teste
// quando precisamos simular "configurado".
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.BOTCONVERSA_API_KEY;
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

describe('sendMessageByPhone', () => {
  it('devolve false quando BOTCONVERSA_API_KEY nao esta configurada', async () => {
    const sent = await sendMessageByPhone('21999998888', 'oi');
    expect(sent).toBe(false);
  });

  it('devolve false quando o contato nao existe (lookup 404)', async () => {
    process.env.BOTCONVERSA_API_KEY = 'k';
    stubFetch({ status: 404 });
    const sent = await sendMessageByPhone('21999998888', 'oi');
    expect(sent).toBe(false);
  });

  it('devolve true quando entrega a mensagem', async () => {
    process.env.BOTCONVERSA_API_KEY = 'k';
    // Primeiro o lookup (200 com subscriber); depois o send (200 sem body).
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: 42, phone: '21999998888' }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const sent = await sendMessageByPhone('21999998888', 'oi');
    expect(sent).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('propaga erro generico (ex: 500)', async () => {
    process.env.BOTCONVERSA_API_KEY = 'k';
    stubFetch({ status: 500 });
    await expect(sendMessageByPhone('21999998888', 'oi')).rejects.toBeInstanceOf(BotConversaError);
  });
});

describe('getSubscriberByPhone', () => {
  it('normaliza o telefone removendo nao-digitos antes da chamada', async () => {
    process.env.BOTCONVERSA_API_KEY = 'k';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: 1, phone: '21999998888' }),
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await getSubscriberByPhone('(21) 99999-8888');
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/subscriber/get_by_phone/21999998888/');
  });
});
