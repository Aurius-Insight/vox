# Deploy — fase de teste em produção (Render)

Este guia leva o MVP do zero até **um ambiente acessível por URL pública**,
com Postgres + Redis gerenciados, HTTPS automático, e um diretor capaz de
fazer login. É o suficiente para começar o beta com a operação da Vox RJ.

> Pré-requisito: o código já está num repositório Git (GitHub recomendado).
> Hoje a pasta `MVP/` não é repositório — primeiro passo: `git init`, commit
> inicial e push para um repo no GitHub.

## 1. Visão geral do que vai subir

- **API** (`apps/api`): Node 22 + Express + Prisma. Serve `/api/*`.
- **Frontend** (`apps/web`): Vite + React, build estático.
- **Postgres 16** (gerenciado pelo Render).
- **Redis 7** (gerenciado pelo Render — sessões, magic link e rate limit).

Todos no mesmo projeto Render, mesma região (`oregon` ou `frankfurt`,
o que tiver menor latência para o RJ).

## 2. Provisionar no Render (passo a passo)

### 2.1 Banco Postgres

1. Dashboard Render → **New** → **PostgreSQL**.
2. Nome: `vox-mvp-db`, plano `Basic` (256 MB já basta para o beta).
3. Após provisionar, copiar o **Internal Database URL** (vai virar `DATABASE_URL`).

### 2.2 Redis

1. **New** → **Key Value** (era "Redis" no menu antigo).
2. Nome: `vox-mvp-redis`, plano `Starter`.
3. Copiar o **Internal Redis URL** (`REDIS_URL`).

### 2.3 Web Service (API)

1. **New** → **Web Service** → conectar o repositório Git.
2. Configuração:
   - **Root Directory**: `MVP`
   - **Runtime**: Node
   - **Build Command**:
     ```
     npm ci && npm run db:generate && npm run build -w apps/api
     ```
   - **Start Command**:
     ```
     node apps/api/dist/index.js
     ```
   - **Pre-Deploy Command** (em "Settings" → "Advanced"):
     ```
     npm run db:migrate
     ```
   - **Health Check Path**: `/api/health`
3. **Environment** (variáveis):

   | Chave | Valor |
   |---|---|
   | `NODE_ENV` | `production` |
   | `PORT` | `10000` (Render usa esse port internamente) |
   | `APP_ORIGIN` | URL pública do frontend (definir após 2.4) |
   | `DATABASE_URL` | Internal URL do Postgres (2.1) |
   | `REDIS_URL` | Internal URL do Redis (2.2) |
   | `SESSION_SECRET` | gerar local: `openssl rand -hex 32` |
   | `WEBHOOK_SECRET` | gerar local: `openssl rand -hex 16` |
   | `ADMIN_EMAIL` | e-mail real do diretor (login inicial) |
   | `ADMIN_PASSWORD` | senha forte (≥ 12 chars) — vai virar a senha do diretor no seed |
   | `BOTCONVERSA_API_KEY` | (deixar vazio até obter a chave) |

4. Salvar e fazer o primeiro deploy.

### 2.4 Static Site (frontend)

1. **New** → **Static Site** → mesmo repositório.
2. Configuração:
   - **Root Directory**: `MVP`
   - **Build Command**:
     ```
     npm ci && npm run build -w apps/web
     ```
   - **Publish Directory**: `apps/web/dist`
3. **Environment** (se o frontend for usar `import.meta.env`): por enquanto
   o `apps/web/src/api/client.ts` usa caminho relativo `/api/...`; para isso
   funcionar com domínios diferentes, adicionar no Render → **Redirects /
   Rewrites** uma regra:
   ```
   Source:      /api/*
   Destination: https://<URL-do-vox-mvp-api>.onrender.com/api/:splat
   Type:        Rewrite
   ```
   Assim, do ponto de vista do navegador, frontend e API ficam na mesma
   origem (resolve CORS e cookies de uma vez).
4. Anotar a URL do frontend (`https://vox-mvp-web.onrender.com`) e voltar
   ao serviço da API para preencher `APP_ORIGIN` com ela.

### 2.5 Primeira execução

Após o deploy da API ficar verde:

1. **Render Dashboard** → API service → **Shell**:
   ```bash
   npm run db:seed
   ```
   Cria o usuário diretor (`ADMIN_EMAIL` + `ADMIN_PASSWORD`), as 5 matérias,
   2 unidades de exemplo e 2 pacotes. Os usuários de teste (joao.p,
   coordenacao test, alunos demo) também são criados — bom para o beta;
   o diretor pode desativá-los depois pela tela de Configurações.
2. Abrir a URL do frontend → login com o e-mail e senha definidos no env.

## 3. Geração de secrets (local)

```bash
# Antes de colar no painel do Render, gere localmente:
echo "SESSION_SECRET=$(openssl rand -hex 32)"
echo "WEBHOOK_SECRET=$(openssl rand -hex 16)"
echo "ADMIN_PASSWORD=$(openssl rand -base64 18)"
```

## 4. BotConversa (quando o acesso chegar)

1. Painel BotConversa → **Configurações → Integrações → Webhook Integration**
   → copiar a API key.
2. No Render → API service → Environment → preencher `BOTCONVERSA_API_KEY`
   → re-deploy.
3. No painel BotConversa, configurar o **Bloco de Integração** apontando
   para `https://<URL-da-api>/api/webhooks/botconversa`, com header
   `X-VOX-Webhook-Secret: <WEBHOOK_SECRET>` e payload conforme
   [`BOTCONVERSA_INTEGRACAO.md`](./BOTCONVERSA_INTEGRACAO.md) seção 4.

A partir daí o magic link do portal é entregue automaticamente via WhatsApp,
e leads novos do BotConversa caem direto no pipeline.

## 5. Backup

O `scripts/db-backup.sh` está pronto, mas em produção o destino dos dumps
**não pode** ser o disco efêmero do Render (some a cada deploy). Duas opções:

- **Render Cron Job** que escreve para S3/Backblaze B2:
  - **New** → **Cron Job** → mesma branch.
  - Schedule: `0 3 * * *` (diário às 03:00).
  - Command: `bash scripts/db-backup.sh /tmp/backups && <upload para S3>`.
- **pg_dump nativo do Render**: o plano Basic do Postgres no Render já faz
  snapshots diários automáticos com retenção de 7 dias — pode bastar para
  o beta. Verificar em Postgres → **Backups**.

Recomendação para o beta: **usar os snapshots automáticos do Render**
durante a fase de teste; ligar o cron com upload externo só quando passar
a fase de teste interno.

## 6. Monitoramento mínimo

- **UptimeRobot** (free) apontando para `https://<api>/api/health` — alerta
  por e-mail se ficar fora por > 2 min.
- Logs do Render já mostram as linhas do `logger` (JSON estruturado, uma
  por linha). Para os eventos `access_denied` (401/403/429) e
  `unhandled_error`, pode-se filtrar no dashboard ou exportar para
  Logtail / Better Stack quando ganhar volume.

## 7. Checklist de go-live

- [ ] Repositório no GitHub com a branch `main` apontando para o Render.
- [ ] Postgres + Redis provisionados, URLs internas no env da API.
- [ ] Secrets gerados (`SESSION_SECRET`, `WEBHOOK_SECRET`, `ADMIN_PASSWORD`).
- [ ] `APP_ORIGIN` preenchido com o domínio real do frontend.
- [ ] Primeiro deploy verde + `npm run db:seed` rodado no shell do Render.
- [ ] Login do diretor funciona pela URL pública.
- [ ] `/api/health` responde 200 do navegador.
- [ ] UptimeRobot configurado.
- [ ] CI do GitHub Actions verde no último push.

Quando isso fechar, está em fase de teste em produção. Os itens 4 e 5
desta lista (BotConversa real + backup externo) ligam o canal de WhatsApp
e a custódia de backup — não bloqueiam o início do beta interno.
