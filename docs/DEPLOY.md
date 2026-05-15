# Deploy — fase de teste em producao (Render)

Guia pratico, na ordem em que se faz, para subir o MVP da Vox RJ para um
ambiente acessivel por URL publica.

**Pre-requisito ja feito**: repo no GitHub em
<https://github.com/GuiRCosta/vox-mvp> (privado).

## Visao geral do que vai subir

- **API** (`apps/api`): Node 22 + Express + Prisma. Serve `/api/*`.
- **Frontend** (`apps/web`): Vite + React, build estatico.
- **Postgres 16** gerenciado pelo Render.
- **Redis 7** gerenciado pelo Render (sessoes, magic link, rate limit).

Todos no mesmo projeto Render, mesma regiao (`Oregon` ou `Frankfurt`).

## Ordem pratica

Faz **3 → 2 → 4**:

1. **Item 3 primeiro** — gera os secrets localmente (offline, leva 1 min).
2. **Item 2** — provisiona Render (Postgres, Redis, API, Static Site).
3. **Item 4** — quando o acesso ao painel BotConversa chegar, liga o canal
   de WhatsApp.

---

## Item 3 — Gerar secrets (5 min, local)

Roda no terminal:

```bash
echo "SESSION_SECRET=$(openssl rand -hex 32)"
echo "WEBHOOK_SECRET=$(openssl rand -hex 16)"
echo "ADMIN_PASSWORD=$(openssl rand -base64 18)"
```

Sai algo do tipo:

```
SESSION_SECRET=a7d3...ef     (64 hex chars = 32 bytes)
WEBHOOK_SECRET=4b1c...92     (32 hex chars = 16 bytes)
ADMIN_PASSWORD=Xy7+Kl...     (24 chars base64)
```

**Guarda esses tres valores em um gerenciador de senhas.** Vao virar
variaveis no Render no item 2.

### Tabela completa de variaveis (para colar depois)

| Chave | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `TZ` | `America/Sao_Paulo` (todo `new Date()` e log do servidor sai em BRT) |
| `PORT` | `10000` (porta interna do Render) |
| `APP_ORIGIN` | URL do Static Site (preencher apos 2.d) |
| `DATABASE_URL` | Internal URL do Postgres (item 2.a) |
| `REDIS_URL` | Internal URL do Redis (item 2.b) |
| `SESSION_SECRET` | gerado acima |
| `WEBHOOK_SECRET` | gerado acima |
| `ADMIN_EMAIL` | **seu e-mail real** — vira o login do diretor |
| `ADMIN_PASSWORD` | gerado acima |
| `BOTCONVERSA_API_KEY` | deixa vazio por enquanto |

**Importante**:
- Vazou `SESSION_SECRET`? Toda sessao ativa fica invalida na hora.
  Usuarios precisam relogar.
- Vazou `WEBHOOK_SECRET`? Qualquer um manda lead falso pro webhook.
- Em ambos os casos: gera novo, re-deploy.

---

## Item 2 — Render (provisionar tudo, ~20 min)

Cria conta em <https://render.com> — login pelo GitHub e o caminho rapido
(autoriza acesso ao repo `GuiRCosta/vox-mvp`). Depois, **na ordem**:

### 2.a · Postgres

- **New → PostgreSQL**
- Nome: `vox-mvp-db`, plano **Basic**, regiao `Oregon` (ou `Frankfurt`)
- Espera ficar `Available` (~2 min)
- Copia o **Internal Database URL** — guarda pra `DATABASE_URL` no item 2.c

### 2.b · Redis

- **New → Key Value** (era "Redis", o nome mudou)
- Nome: `vox-mvp-redis`, plano **Starter**, mesma regiao
- Copia o **Internal Redis URL** — vai ser `REDIS_URL` no item 2.c

### 2.c · API (Web Service)

- **New → Web Service** → escolhe o repo `GuiRCosta/vox-mvp` (autoriza
  se necessario)

| Campo | Valor |
|---|---|
| **Name** | `vox-mvp-api` |
| **Root Directory** | (em branco — o repo ja e o MVP) |
| **Runtime** | Node |
| **Build Command** | `npm ci && npm run db:generate && npm run build -w apps/api` |
| **Start Command** | `node apps/api/dist/index.js` |
| **Health Check Path** | `/api/health` |
| **Pre-Deploy Command** (em Settings → Advanced apos criar) | `npm run db:migrate` |

- Em **Environment**, cola todas as variaveis da tabela do item 3
  (deixa `APP_ORIGIN` em branco por enquanto — preenche em 2.d).
- **Create Web Service** — primeiro deploy ~5 min.

### 2.d · Frontend (Static Site)

- **New → Static Site** → mesmo repo

| Campo | Valor |
|---|---|
| **Name** | `vox-mvp-web` |
| **Build Command** | `npm ci && npm run build -w apps/web` |
| **Publish Directory** | `apps/web/dist` |

- Apos criar, em **Redirects/Rewrites** → adiciona:

  ```
  Source:      /api/*
  Destination: https://vox-mvp-api.onrender.com/api/:splat
  Type:        Rewrite
  ```

  (Substitui pela URL real da API.) Isso faz o navegador enxergar frontend
  e API na mesma origem — resolve CORS e cookies de uma vez.

- Anota a URL final do Static Site (ex.: `https://vox-mvp-web.onrender.com`).
- **Volta no `vox-mvp-api` → Environment** → preenche `APP_ORIGIN` com a
  URL do Static Site → re-deploy automatico.

### 2.e · Primeiro seed

Depois da API ficar verde no dashboard:

- **vox-mvp-api → Shell** (botao lateral)
- Roda: `npm run db:seed`

Cria o usuario diretor com `ADMIN_EMAIL` + `ADMIN_PASSWORD` que voce
configurou. Tambem cria as 5 materias, 2 unidades de exemplo e 2 pacotes.

> Os usuarios de teste (joao.p, coordenacao test, alunos demo) tambem
> sao criados — bom pra explorar o beta. O diretor pode desativa-los
> depois pela tela de Configuracoes.

Abre a URL do frontend → login com o e-mail e senha definidos no env.
**No ar.**

---

## Item 4 — BotConversa (quando o acesso chegar)

Quando voce conseguir entrar no painel da Vox RJ no BotConversa:

### 4.a · Pegar a API key

- **Configuracoes → Integracoes → Webhook Integration** → copia a chave.

### 4.b · Configurar no Render

- **vox-mvp-api → Environment → Edit** → preenche `BOTCONVERSA_API_KEY`
  com a chave.
- Save → re-deploy automatico.
- A partir desse momento, o magic link do portal e **entregue
  automaticamente via WhatsApp** quando o aluno digita o CPF.

### 4.c · Configurar o webhook de entrada (BotConversa → Vox)

No painel do BotConversa, no fluxo de captura de leads:

- Adiciona um **Bloco de Integracao** apos a captura de nome + unidade.
- **URL**: `https://vox-mvp-api.onrender.com/api/webhooks/botconversa`
- **Metodo**: `POST`
- **Headers**:

  ```
  X-VOX-Webhook-Secret: <o WEBHOOK_SECRET que voce gerou no item 3>
  Content-Type: application/json
  ```

- **Body** (mapeando as variaveis do fluxo do BotConversa):

  ```json
  {
    "eventId": "{{event_id_unico_do_fluxo}}",
    "contact": {
      "id": "{{subscriber_id}}",
      "name": "{{nome}}",
      "whatsapp": "{{phone}}"
    },
    "fields": {
      "unitInterest": "{{unidade_interesse}}",
      "campaign": "{{campanha}}"
    }
  }
  ```

  Os nomes exatos das variaveis dependem do que o cliente ja configurou
  no fluxo dele — ajusta na hora.

### 4.d · Validar

- Cria um lead de teste pelo WhatsApp da Vox RJ.
- No dashboard do MVP, o lead deve aparecer em segundos com a campanha
  preenchida.
- Pede um magic link pelo portal — voce deve receber a mensagem no WhatsApp.

Detalhes tecnicos completos da API estao em
[`BOTCONVERSA_INTEGRACAO.md`](./BOTCONVERSA_INTEGRACAO.md).

---

## Backup

O `scripts/db-backup.sh` esta pronto, mas em producao o destino dos dumps
**nao pode** ser o disco efemero do Render (some a cada deploy). Duas opcoes:

- **Snapshots automaticos do Render** (recomendado pro beta): o plano Basic
  do Postgres ja faz snapshots diarios com retencao de 7 dias.
  Verificar em **Postgres → Backups**. Zero configuracao.
- **Render Cron Job** que escreve para S3/Backblaze B2:
  - **New → Cron Job** → mesma branch
  - Schedule: `0 3 * * *` (diario as 03:00)
  - Command: `bash scripts/db-backup.sh /tmp/backups && <upload para S3>`

Para a fase de teste interno, o snapshot do Render basta.

## Monitoramento minimo

- **UptimeRobot** (free) apontando para `https://<api>/api/health` —
  alerta por e-mail se ficar fora por > 2 min.
- Os logs do Render ja mostram as linhas do `logger` (JSON estruturado,
  uma por linha). Para os eventos `access_denied` (401/403/429) e
  `unhandled_error`, pode filtrar no dashboard ou exportar para
  Logtail / Better Stack quando ganhar volume.

## Checklist de go-live

- [ ] Secrets gerados (`SESSION_SECRET`, `WEBHOOK_SECRET`, `ADMIN_PASSWORD`)
      e guardados em senha-bank.
- [ ] Postgres + Redis provisionados, URLs internas em maos.
- [ ] `vox-mvp-api` criado com Build/Start/Pre-Deploy corretos.
- [ ] `vox-mvp-web` criado com Rewrite `/api/*` apontando pra API.
- [ ] `APP_ORIGIN` no env da API preenchido com a URL do Static Site.
- [ ] Primeiro deploy verde + `npm run db:seed` rodado no shell do Render.
- [ ] Login do diretor funciona pela URL publica.
- [ ] `/api/health` responde 200 do navegador.
- [ ] UptimeRobot configurado.
- [ ] CI do GitHub Actions verde no ultimo push.

Quando isso fechar, **em fase de teste em producao**.

Os itens 4.b/4.c (BotConversa real) e o backup externo entram quando o
acesso ao painel chegar / quando passar da fase de teste interno. **Nao
bloqueiam o inicio do beta.**

---

## Quando travar

Em qualquer ponto que der erro inesperado no Render (build falhando, env
faltando, primeiro `seed` quebrando), me passa o output do log e eu te
oriento. Os pontos mais comuns que travam na primeira vez:

- **Build falha por `npm ci`**: provavelmente o `package-lock.json` nao
  esta na raiz. Confere `ls package-lock.json` no shell do Render.
- **`seed` falha com `ADMIN_PASSWORD obrigatorio`**: a env nao chegou —
  confirma que esta salva e re-rodou o deploy.
- **Login devolve 401 mesmo com senha certa**: cookies sendo bloqueados
  porque frontend e API estao em origens diferentes. Confere se o
  **Rewrite `/api/*`** do Static Site (item 2.d) esta ativo.
- **CSRF rejeitando login**: `APP_ORIGIN` esta apontando pra URL errada.
  Tem que ser exatamente a URL do Static Site (com `https://`, sem barra
  no final).
