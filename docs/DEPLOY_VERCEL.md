# Deploy — Vercel + Supabase

Guia para subir o MVP usando **apenas 2 fornecedores**: Vercel (frontend +
backend serverless + KV) e Supabase (Postgres).

Alternativa ao [`DEPLOY.md`](./DEPLOY.md) (que cobre Render). Use **um ou outro**,
nao os dois ao mesmo tempo.

## Visao geral

```
                ┌──────────────────────────────────────────┐
                │                  Vercel                  │
                │                                          │
   navegador ── ┤  /          → apps/web (estatico, CDN)   │
                │  /api/*     → apps/api (serverless fn)   │
                │  KV         → sessoes, magic link, rate  │
                │                                          │
                └────────────┬─────────────────────────────┘
                             │
                             ▼
                ┌──────────────────────────────────────────┐
                │                Supabase                  │
                │  Postgres 16 (pooler PgBouncer + direct) │
                └──────────────────────────────────────────┘
```

Frontend e backend ficam na **mesma origem** (subdominio Vercel) — CSRF +
cookies HttpOnly funcionam sem rewrite cross-domain.

## Pre-requisitos do repositorio

Ja entregue na branch `feat/vercel-supabase`:

- `vercel.json` na raiz (rewrites + funcao serverless)
- `apps/api/api/index.ts` (entrypoint da serverless function)
- `apps/api/src/db/redis.ts` virou shim que detecta Vercel KV via env
- `apps/api/src/db/client.ts` com singleton globalThis
- `schema.prisma` com `directUrl`
- `seed.ts` e `import-botconversa.ts` preferem `DIRECT_URL`

Em dev local nada muda: `npm run dev` continua usando o Docker (Postgres
:5433 + Redis :6380).

## Passo a passo

### 1. Secrets (5 min, local)

```bash
echo "SESSION_SECRET=$(openssl rand -hex 32)"
echo "WEBHOOK_SECRET=$(openssl rand -hex 16)"
echo "ADMIN_PASSWORD=$(openssl rand -base64 18)"
```

Guarda os 3 valores em senha-bank.

### 2. Supabase (~30 min)

1. Cria projeto em <https://supabase.com>. Regiao recomendada: `sao1` (Sao
   Paulo) no plano Pro; free fica em US East e **pausa apos 1 semana sem
   uso** — vale pro beta interno, problematico pra prod real.

2. **Settings → Database → Connection string**:
   - Copia **Transaction Pooler** (porta 6543) → vira `DATABASE_URL`.
     Acrescenta `?pgbouncer=true&connection_limit=1` no final.
   - Copia **Direct connection** (porta 5432) → vira `DIRECT_URL`.

3. **Local**, com `DIRECT_URL` apontando pro Supabase, roda migrations + seed:
   ```bash
   cd MVP
   DATABASE_URL='<supabase-direct-url>' \
   DIRECT_URL='<supabase-direct-url>' \
   ADMIN_EMAIL='<seu-email>' \
   ADMIN_PASSWORD='<gerado-no-passo-1>' \
   SESSION_SECRET='<gerado-no-passo-1>' \
   WEBHOOK_SECRET='<gerado-no-passo-1>' \
   npm run db:migrate

   # Idem com NODE_ENV=production pra forcar ADMIN_PASSWORD obrigatoria
   NODE_ENV=production \
   DATABASE_URL='<supabase-direct-url>' \
   DIRECT_URL='<supabase-direct-url>' \
   ADMIN_EMAIL='<seu-email>' \
   ADMIN_PASSWORD='<gerado-no-passo-1>' \
   npm run db:seed
   ```

4. (Opcional) Importa leads do BotConversa:
   ```bash
   DIRECT_URL='<supabase-direct-url>' \
   BOTCONVERSA_API_KEY='<chave-do-painel>' \
   npm run db:import-botconversa
   ```

### 3. Vercel (~30 min)

1. Em <https://vercel.com> → **New Project** → seleciona o repo
   `GuiRCosta/vox-mvp`. Confirma branch `main` (ou `feat/vercel-supabase`
   se quiser testar primeiro).

2. **Configure Project**:
   - **Root Directory**: `MVP`
   - **Framework Preset**: Other (`vercel.json` cuida do resto)
   - **Build/Output**: deixar como esta (vem do `vercel.json`)

3. **Environment Variables** (Settings → Environment Variables):

   | Chave | Valor |
   |---|---|
   | `NODE_ENV` | `production` |
   | `TZ` | `America/Sao_Paulo` |
   | `APP_ORIGIN` | URL final do Vercel (ex.: `https://vox-mvp.vercel.app`) |
   | `DATABASE_URL` | Pooler do Supabase com `?pgbouncer=true&connection_limit=1` |
   | `DIRECT_URL` | Direct connection do Supabase (porta 5432) |
   | `SESSION_SECRET` | gerado no passo 1 |
   | `WEBHOOK_SECRET` | gerado no passo 1 |
   | `ADMIN_EMAIL` | seu e-mail (login do diretor) |
   | `ADMIN_PASSWORD` | gerado no passo 1 |
   | `BOTCONVERSA_API_KEY` | (preencher quando obtiver) |

4. **Storage → Create → KV Database** → nome `vox-mvp-kv`, regiao igual a do
   projeto. O Vercel **injeta automaticamente** `KV_URL`,
   `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `KV_REST_API_READ_ONLY_TOKEN`.

   Nosso `redis.ts` detecta `KV_REST_API_URL` e troca pro adapter HTTP
   sozinho. Sem outra mudanca.

5. **Deploy**. Primeira build ~3-5 min.

### 4. Verificar (~5 min)

- Abre a URL do Vercel → login interno com `ADMIN_EMAIL` + `ADMIN_PASSWORD`.
- Testa `/dashboard`, `/vendas` (Kanban), `/coordenacao` (criar aula),
  `/alunos` (renovar pacote), `/portal/entrar` (CPF de aluno seedado).
- Confere logs em **Vercel → Deployments → Functions** — deve ver linhas
  JSON do `logger` (`api_started` so aparece em dev/index.ts; em prod
  serverless cada invocacao gera `access_denied` quando aplicavel).

### 5. BotConversa (quando a chave chegar)

Identico ao guia Render. Resumo:

1. **Vercel → Environment** → preenche `BOTCONVERSA_API_KEY` → **Redeploy**.
2. No painel do BotConversa, configura o **Bloco de Integracao** apontando
   pra `https://<vercel-url>/api/webhooks/botconversa` com header
   `X-VOX-Webhook-Secret: <WEBHOOK_SECRET>` e body como descrito em
   [`BOTCONVERSA_INTEGRACAO.md`](./BOTCONVERSA_INTEGRACAO.md) secao 4.

A partir daqui, leads novos chegam em tempo real e o magic link do portal
e entregue automaticamente via WhatsApp.

## Trade-offs versus Render

| | Render | Vercel + Supabase |
|---|---|---|
| Cold start no magic link | 0ms (processo persistente) | **2–5s pós-idle** (serverless) |
| Cron para backup proprio | gratis (Render Cron) | **so Pro** ($20/mes) |
| Pausa por inatividade | nao | **Supabase Free pausa em 1 semana** |
| Regiao Sao Paulo | nao | **sim, no Pro** ($25/mes) |
| Preview URLs por PR | nao | **sim, automatico** |
| Fornecedores | 1 (Render) | 2 (Vercel + Supabase) |
| Custo beta | $0 (trial 90 dias) | $0 |
| Custo prod tipico | ~$24/mes | ~$45/mes (Vercel Pro + Supabase Pro) |

**Cold start e o trade principal**. Mitigacao mais pratica: cron de ping
a cada 5 min (Pro). Pro beta interno, conviver com 2-5s na primeira
requisicao apos longa pausa e aceitavel.

## Limitacoes herdadas

- **Import de leads (`db:import-botconversa`)**: roda ~2-3 min. NAO cabe em
  funcao serverless (max 30s no Pro, 10s no Hobby). Continua rodando local
  apontando pro `DIRECT_URL` da Supabase.

- **Backup customizado (`scripts/db-backup.sh`)**: nao roda no Vercel. Pra
  beta, usar os snapshots automaticos da Supabase (Free: 7 dias; Pro: PITR
  7 dias). Pra prod sria, agendar via Vercel Cron (Pro) ou rodar
  externamente (Github Actions com cron, AWS Lambda, etc.).

## Checklist de go-live

- [ ] Secrets gerados e guardados em senha-bank.
- [ ] Projeto Supabase criado; `DATABASE_URL` (pooler) e `DIRECT_URL` em maos.
- [ ] `npm run db:migrate` + `db:seed` rodaram contra Supabase (local).
- [ ] (Opcional) Import de leads do BotConversa rodado.
- [ ] Projeto Vercel criado com root `MVP` e env vars completas.
- [ ] KV provisionada no Vercel (vars `KV_*` aparecem automaticas).
- [ ] Primeiro deploy verde; `/api/health` responde 200 do navegador.
- [ ] Login do diretor funciona pela URL Vercel.
- [ ] CI do GitHub Actions verde no ultimo push.

Quando isso fechar, **em fase de teste em producao** via Vercel + Supabase.
