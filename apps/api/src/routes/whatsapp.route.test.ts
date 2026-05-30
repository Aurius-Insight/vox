import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { redis } from '../db/redis.js';
import { prisma } from '../db/client.js';

// Testes de borda do chat WhatsApp que NAO dependem de seed: gating de auth e o
// handshake de verificacao do webhook. (O fluxo completo e validado em prod.)
const app = createApp();

beforeAll(() => {
  process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'test-verify-token';
});

afterAll(async () => {
  try {
    await redis.quit();
    await prisma.$disconnect();
  } catch {
    // cleanup best-effort
  }
});

describe('rotas de atendimento (auth)', () => {
  it('bloqueia a lista de conversas sem sessao (401)', async () => {
    await request(app).get('/api/whatsapp/conversations').expect(401);
  });

  it('bloqueia o envio sem sessao (401)', async () => {
    await request(app)
      .post('/api/whatsapp/conversations/x/messages')
      .send({ text: 'oi' })
      .expect(401);
  });
});

describe('webhook do WhatsApp (handshake)', () => {
  it('devolve o challenge quando o verify token casa', async () => {
    const res = await request(app)
      .get('/api/webhooks/whatsapp')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'test-verify-token', 'hub.challenge': '12345' });
    expect(res.status).toBe(200);
    expect(res.text).toBe('12345');
  });

  it('rejeita verify token errado (403)', async () => {
    await request(app)
      .get('/api/webhooks/whatsapp')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'errado', 'hub.challenge': '12345' })
      .expect(403);
  });
});
