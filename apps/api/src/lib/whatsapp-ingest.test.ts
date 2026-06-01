import { describe, expect, it } from 'vitest';
import { collectEvents, isWindowOpen, statusAdvances, WINDOW_MS } from './whatsapp-ingest.js';

describe('statusAdvances', () => {
  it('avanca sent -> delivered -> read', () => {
    expect(statusAdvances('sent', 'delivered')).toBe(true);
    expect(statusAdvances('delivered', 'read')).toBe(true);
  });
  it('NAO retrocede (delivered nao volta para sent) — bug dos webhooks fora de ordem', () => {
    expect(statusAdvances('delivered', 'sent')).toBe(false);
    expect(statusAdvances('read', 'delivered')).toBe(false);
    expect(statusAdvances('sent', 'sent')).toBe(false);
  });
  it('failed so antes de entregar', () => {
    expect(statusAdvances('sent', 'failed')).toBe(true);
    expect(statusAdvances('delivered', 'failed')).toBe(false);
    expect(statusAdvances('read', 'failed')).toBe(false);
  });
});

describe('isWindowOpen', () => {
  const now = new Date('2026-05-29T12:00:00Z');
  it('falso quando nunca houve inbound', () => {
    expect(isWindowOpen(null, now)).toBe(false);
  });
  it('verdadeiro dentro de 24h', () => {
    expect(isWindowOpen(new Date(now.getTime() - 60_000), now)).toBe(true);
  });
  it('falso apos 24h', () => {
    expect(isWindowOpen(new Date(now.getTime() - WINDOW_MS - 1), now)).toBe(false);
  });
});

describe('collectEvents', () => {
  it('extrai mensagem de entrada com telefone e nome do contato', () => {
    const body = {
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                contacts: [{ wa_id: '556181508486', profile: { name: 'Carol' } }],
                messages: [{ id: 'wamid.A', from: '556181508486', type: 'text', text: { body: 'oi' } }],
              },
            },
          ],
        },
      ],
    };
    const events = collectEvents(body);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'message', externalEventId: 'wa:msg:wamid.A', phone: '556181508486', name: 'Carol' });
  });

  it('extrai echo do app Business', () => {
    const body = {
      entry: [{ changes: [{ field: 'message_echoes', value: { message_echoes: [{ id: 'wamid.E', from: '556181508486', type: 'text', text: { body: 'resposta' } }] } }] }],
    };
    const events = collectEvents(body);
    expect(events[0]).toMatchObject({ kind: 'echo', externalEventId: 'wa:echo:wamid.E', phone: '556181508486' });
  });

  it('extrai status com chave por id+status', () => {
    const body = {
      entry: [{ changes: [{ field: 'statuses', value: { statuses: [{ id: 'wamid.A', status: 'delivered' }] } }] }],
    };
    const events = collectEvents(body);
    expect(events[0]).toEqual({ kind: 'status', externalEventId: 'wa:status:wamid.A:delivered', waMessageId: 'wamid.A', status: 'delivered' });
  });

  it('ignora mensagem sem id ou sem telefone', () => {
    const body = { entry: [{ changes: [{ value: { messages: [{ type: 'text' }] } }] }] };
    expect(collectEvents(body)).toHaveLength(0);
  });

  it('payload vazio nao quebra', () => {
    expect(collectEvents({})).toEqual([]);
    expect(collectEvents(null)).toEqual([]);
  });
});
