import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { redis } from '../db/redis.js';
import { prisma } from '../db/client.js';

/**
 * Testes de integracao da camada de autenticacao/autorizacao.
 * Precisam de PostgreSQL + Redis no ar e do seed aplicado
 * (`docker compose up -d && npm run db:migrate && npm run db:seed`).
 */
const app = createApp();
const PASSWORD = 'admin-dev-password';

async function login(email: string): Promise<string[]> {
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  const setCookie = res.headers['set-cookie'];
  return Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
}

beforeAll(async () => {
  // Zera os contadores de rate limit para o suite nao esbarrar no limite.
  const keys = await redis.keys('rl:*');
  if (keys.length > 0) await redis.del(...keys);
});

afterAll(async () => {
  try {
    await redis.quit();
    await prisma.$disconnect();
  } catch {
    // cleanup best-effort
  }
});

describe('autenticacao', () => {
  it('bloqueia endpoints protegidos sem sessao (401)', async () => {
    await request(app).get('/api/dashboard').expect(401);
    await request(app).get('/api/leads').expect(401);
    await request(app).get('/api/classes').expect(401);
    await request(app).get('/api/users').expect(401);
  });

  it('rejeita credenciais invalidas (401)', async () => {
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@voxrj.com', password: 'senha-errada' })
      .expect(401);
  });
});

describe('matriz de permissoes', () => {
  it('dashboard: so o diretor entra', async () => {
    const diretor = await login('admin@voxrj.com');
    const coordenacao = await login('coordenacao@voxrj.com');
    const professor = await login('joao.p@voxrj.com');
    await request(app).get('/api/dashboard').set('Cookie', diretor).expect(200);
    await request(app).get('/api/dashboard').set('Cookie', coordenacao).expect(403);
    await request(app).get('/api/dashboard').set('Cookie', professor).expect(403);
  });

  it('leads: diretor e coordenacao operam o pipeline; professor nao', async () => {
    const coordenacao = await login('coordenacao@voxrj.com');
    const professor = await login('joao.p@voxrj.com');
    await request(app).get('/api/leads').set('Cookie', coordenacao).expect(200);
    await request(app).get('/api/leads').set('Cookie', professor).expect(403);
    // coordenacao passa pelo guard de papel: corpo vazio cai em 400 de validacao, nao 403.
    await request(app).post('/api/leads').set('Cookie', coordenacao).send({}).expect(400);
    await request(app).post('/api/leads').set('Cookie', professor).send({}).expect(403);
  });

  it('professor ve classes, mas nao cria aula', async () => {
    const professor = await login('joao.p@voxrj.com');
    await request(app).get('/api/classes').set('Cookie', professor).expect(200);
    await request(app).post('/api/classes').set('Cookie', professor).send({}).expect(403);
  });

  it('unidades: a coordenacao le, o professor nao', async () => {
    const coordenacao = await login('coordenacao@voxrj.com');
    const professor = await login('joao.p@voxrj.com');
    await request(app).get('/api/units').set('Cookie', coordenacao).expect(200);
    await request(app).get('/api/units').set('Cookie', professor).expect(403);
  });

  it('criar usuario e so diretor', async () => {
    const coordenacao = await login('coordenacao@voxrj.com');
    await request(app).post('/api/users').set('Cookie', coordenacao).send({}).expect(403);
  });

  it('gerar magic link de aluno: diretor e coordenacao podem; professor nao', async () => {
    const coordenacao = await login('coordenacao@voxrj.com');
    const professor = await login('joao.p@voxrj.com');
    // stu_x nao existe -> 404 comprova que coordenacao passou pelo guard de papel.
    await request(app)
      .post('/api/students/stu_x/magic-link')
      .set('Cookie', coordenacao)
      .expect(404);
    await request(app)
      .post('/api/students/stu_x/magic-link')
      .set('Cookie', professor)
      .expect(403);
  });

  it('editar aluno: diretor e coordenacao podem; professor nao', async () => {
    const coordenacao = await login('coordenacao@voxrj.com');
    const professor = await login('joao.p@voxrj.com');
    // stu_x nao existe -> 404 comprova que coordenacao passou pelo guard de papel.
    await request(app)
      .patch('/api/students/stu_x')
      .set('Cookie', coordenacao)
      .send({ name: 'Nome Editado' })
      .expect(404);
    await request(app)
      .patch('/api/students/stu_x')
      .set('Cookie', professor)
      .send({ name: 'Nome Editado' })
      .expect(403);
  });

  it('renovacao de pacote: diretor e coordenacao podem; professor nao', async () => {
    const coordenacao = await login('coordenacao@voxrj.com');
    const professor = await login('joao.p@voxrj.com');
    // Corpo vazio cai em 400 (validacao) — comprova que passou pelo guard de papel.
    await request(app)
      .post('/api/students/stu_x/renew')
      .set('Cookie', coordenacao)
      .send({})
      .expect(400);
    await request(app)
      .post('/api/students/stu_x/renew')
      .set('Cookie', professor)
      .send({})
      .expect(403);
  });

  it('pacotes: diretor e coordenacao leem; so o diretor gerencia', async () => {
    const coordenacao = await login('coordenacao@voxrj.com');
    const professor = await login('joao.p@voxrj.com');
    await request(app).get('/api/packages').set('Cookie', coordenacao).expect(200);
    await request(app).get('/api/packages').set('Cookie', professor).expect(403);
    await request(app).post('/api/packages').set('Cookie', coordenacao).send({}).expect(403);
  });
});

describe('isolamento do portal do aluno', () => {
  it('sessao interna nao da acesso ao portal do aluno', async () => {
    const diretor = await login('admin@voxrj.com');
    await request(app).get('/api/portal/me').set('Cookie', diretor).expect(401);
  });
});

describe('protecao CSRF', () => {
  it('rejeita escrita com Origin de outro dominio (403)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'http://malicioso.example')
      .send({ email: 'admin@voxrj.com', password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('csrf_origin_mismatch');
  });

  it('aceita escrita com Origin do proprio app', async () => {
    await request(app)
      .post('/api/auth/login')
      .set('Origin', 'http://localhost:5173')
      .send({ email: 'admin@voxrj.com', password: PASSWORD })
      .expect(200);
  });
});
