# Onboarding — Vox Rio (MVP)

Guia rapido pra quem chegou agora no projeto comecar a trabalhar. Leitura
linear leva ~15 min; depois disso voce ja deve estar com o app rodando
localmente e capaz de fazer deploy em prod.

> Credenciais (senha SSH, senha do Postgres prod, ADMIN_PASSWORD)
> **nao estao neste documento**. Pega elas separadamente com o Gui
> (canal seguro: 1Password, Bitwarden, ou pessoalmente).

---

## 1. O que e o Vox Rio

CRM operacional da rede de escolas de oratoria Vox Rio (5 unidades:
Tijuca, Icarai, Santa Rosa, Catete, Copacabana — Niteroi serve como
unidade de triagem). Atende 3 papeis internos (diretor, coordenacao,
professor) e um portal externo do aluno.

Funcoes principais hoje:

- **Vendas / Kanban de leads** — sincronizado com BotConversa via cron
  a cada minuto + import full diario as 04:00.
- **Agenda / Presenca** — aulas, agendamentos, presencas, creditos.
- **Alunos** — ficha, historico, conversao experimental → matriculado,
  renovacao de pacote.
- **Professores, Escolas, Configuracoes** — admin do catalogo.
- **Portal do aluno** — magic link via WhatsApp, agenda/desagenda
  aulas, ve historico.
- **Dashboard** — KPIs do dia, tendencias 30d, ranking por escola/materia/
  pacote, top professores, pendencias do ETL legado.

A stack:

| Camada | Tecnologia |
|---|---|
| Frontend (`apps/web`) | React 18 + Vite + dnd-kit + recharts + lucide |
| Backend (`apps/api`) | Node 22 + Express + Zod + Prisma 7 |
| Banco | PostgreSQL 16 |
| Cache / lock | Redis (sessoes, magic link, lock distribuido do sync) |
| Deploy | Docker Compose em VPS proprio + Traefik (TLS automatico) |
| Integracao | BotConversa (poll incremental + full daily) |

---

## 2. Repositorio Git

O codigo vive em **dois remotes** que sempre andam sincronizados:

| Nome do remote | URL |
|---|---|
| `origin` | `git@github.com:Aurius-Insight/vox.git` |
| `guirc`  | `git@github.com:GuiRCosta/vox-mvp.git` |

**Sempre `git push` nos dois** depois de cada commit — o repo do GuiRC
e usado por automacao e nao pode ficar para tras. Comando padrao:

```bash
git push guirc main && git push origin main
```

Convencao de commit: `<type>: <descricao>` (`feat:`, `fix:`, `refactor:`,
`docs:`, `chore:`, `perf:`, `ci:`, `test:`). Mensagem curta no titulo,
detalhe no corpo. Veja qualquer commit recente como referencia.

---

## 3. Acesso ao servidor de producao

**VPS**: `187.77.22.210`, usuario `root`, autenticacao por senha
(pegar com o Gui separadamente, **nunca commitar**).

Configura o SSH alias na tua maquina pra encurtar comandos. Edita
`~/.ssh/config`:

```ssh-config
Host vox
  HostName 187.77.22.210
  User root
```

Verifica o acesso:

```bash
ssh vox 'uptime'
```

A senha vai ser pedida toda vez. Se quiser usar chave em vez de senha,
gera um par local e pede pro Gui adicionar a publica no
`/root/.ssh/authorized_keys`.

### Onde tudo vive na VPS

| Caminho | O que e |
|---|---|
| `/opt/vox/app/` | Codigo da aplicacao (sincronizado via `rsync` do dev) |
| `/opt/vox/app/.env` | Secrets de producao (root:600 — **nunca sobrescrever**) |
| `/opt/vox/app/docker-compose.prod.yml` | Stack docker da producao |
| `/opt/vox/backups/` | Dumps automaticos diarios + manuais pre-deploy |
| `/etc/cron.d/vox-sync` | Cron do BotConversa (poll a cada 1 min + import 04:00) |
| `/opt/vox/poll.log` | Log do poll incremental |
| `/opt/vox/import.log` | Log do import diario |

URL publica: <https://vox.voxrio.xyz>. Health-check publico:
<https://vox.voxrio.xyz/api/health>.

---

## 4. Setup local

Pre-requisitos: Node 22, pnpm, Docker Desktop (pra Postgres + Redis
locais).

```bash
# 1. Clone (use o remote que voce tem acesso).
git clone git@github.com:Aurius-Insight/vox.git vox && cd vox

# 2. Configure os dois remotes.
git remote add guirc git@github.com:GuiRCosta/vox-mvp.git
git remote -v   # confere que ambos aparecem

# 3. Suba Postgres + Redis locais.
docker compose up -d postgres redis

# 4. Crie o .env local (NAO commite).
cp .env.example .env   # se existir, senao pede o template pro Gui

# 5. Instale dependencias e gere o client do Prisma.
pnpm install
cd apps/api && npx prisma migrate deploy && npx prisma generate && cd ../..

# 6. Suba api + web em terminais separados.
pnpm --filter @vox/api dev    # http://localhost:3000
pnpm --filter @vox/web dev    # http://localhost:5173
```

Credenciais de teste local (seed inicial criado pela primeira
`prisma migrate`):

- **Diretor**: `admin@voxrio.xyz` / senha do `ADMIN_PASSWORD` do `.env`
- **Coordenacao / Professor**: criados pelo diretor em `/configuracoes`

Roda os testes pra garantir que o ambiente esta saudavel:

```bash
cd apps/api && npm test
```

Esperado: `Test Files 18 passed (18) — Tests 170 passed (170)`.

---

## 5. Fluxo de deploy

A producao **nao e um git checkout** — os arquivos vao via `rsync` da
maquina do dev. A imagem docker da api tem um `ENTRYPOINT` que roda
`prisma migrate deploy` automaticamente antes de iniciar, entao
migrations novas sao aplicadas no primeiro boot.

Fluxo padrao pra qualquer mudanca:

```bash
# 1. Commit + push pros dois remotes.
git add ... && git commit -m "feat: ..."
git push guirc main && git push origin main

# 2. Backup do banco antes (so se a mudanca tem migration ou e arriscada).
ssh vox 'cd /opt/vox/app && docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U vox vox | gzip > /opt/vox/backups/pre-<NOME>-$(date +%Y%m%d-%H%M%S).sql.gz'

# 3. Sincroniza os arquivos alterados (exclui o .env de prod!).
rsync -az <arquivo-ou-pasta> vox:/opt/vox/app/<mesmo-caminho>

# 4. Rebuilda o que mudou (api, web ou ambos).
ssh vox 'cd /opt/vox/app && docker compose -f docker-compose.prod.yml up -d --build api web'

# 5. Smoke test.
curl -s https://vox.voxrio.xyz/api/health   # { "ok": true, ... }
curl -s https://vox.voxrio.xyz/ | grep -oE 'assets/index-[^"]+\.(js|css)' | head -2
```

> Importante: **nao commitar nem subir** `apps/api/.env` ou
> `/opt/vox/app/.env`. O secret de producao so existe na VPS.

Mais detalhe operacional (Traefik, rede docker, troubleshooting):
[DEPLOY.md](DEPLOY.md).

---

## 6. Como o sync com BotConversa funciona

Cron do sistema, configurado em `/etc/cron.d/vox-sync`:

```
* * * * *   poll-botconversa.ts   # a cada 1 min — leads novos em ~1 min
0 4 * * *   import-botconversa.ts # diario as 04:00 — rede de seguranca
```

Regras importantes do sync (ja implementadas, mas vale entender):

- **Kanban manda**: o stage so e atualizado enquanto o lead esta em
  `novo_lead`. Em qualquer outra etapa, o sync nao mexe na etapa.
- **Student manda**: se o lead ja virou aluno (`Student` vinculado),
  o sync ignora completamente e gera audit log
  `stage.locked_by_student`.
- **Lock distribuido**: Redis (`SETNX` + script Lua de release) impede
  duas execucoes paralelas do poll se uma demorar mais de 1 minuto.

Logica viva em `apps/api/src/lib/botconversa-sync.ts`
(funcao `resolveLeadFromSubscriber`).

---

## 7. Convencoes que os reviewers vao cobrar

- **Imutabilidade**: nunca mutar objetos, sempre criar novos
  (`{ ...current, field: value }`).
- **Validacao**: todo input externo passa por `zod` no handler.
- **Audit log** pra operacoes sensiveis (matricula, renovacao, mudanca
  de etapa quando ha aluno).
- **Sem `console.log`** no codigo commitado — usa `logger.*`.
- **Sem secrets no front** ou em commits — `.env`, `*.local`, dumps,
  ignorados via `.gitignore`.
- **Testes** acompanham mudanca de regra: TDD onde der, minimo de teste
  pra qualquer logica nao trivial. Coverage alvo 80%.

---

## 8. Onde procurar cada coisa

| Pergunta | Arquivo |
|---|---|
| Como deployo? | [DEPLOY.md](DEPLOY.md) |
| Quais endpoints existem? | [ENDPOINTS_MVP.md](ENDPOINTS_MVP.md) |
| Como funciona o BotConversa? | [BOTCONVERSA_INTEGRACAO.md](BOTCONVERSA_INTEGRACAO.md) |
| Design / cores / componentes? | [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) |
| Acessos de teste do MVP? | [ACESSOS_TESTE_MVP.md](ACESSOS_TESTE_MVP.md) |
| Plano de renovacao de pacotes? | [PLANO_RENOVACAO.md](PLANO_RENOVACAO.md) |
| Plano do pipeline customizavel? | [PLANO_PIPELINE_CUSTOMIZAVEL.md](PLANO_PIPELINE_CUSTOMIZAVEL.md) |
| Plano de campanhas Meta? | [PLANO_CAMPANHAS_META.md](PLANO_CAMPANHAS_META.md) |
| Riscos de seguranca conhecidos? | [GAPS_SEGURANCA_REQUISICOES.md](GAPS_SEGURANCA_REQUISICOES.md) |

---

## 9. Gotchas (coisas que ja morderam)

- **Dois remotes**: esquecer de `git push guirc main` quebra automacoes.
- **Cron BotConversa silencioso**: se mudou schema de `LeadStage`,
  conferir o `poll.log` por 5 min — em fevereiro de 2026, uma migration
  enum→table causou 270 falhas em 23h sem alerta porque o cron rodava
  com erro mas sem health check externo.
- **CPF e WhatsApp opcionais no Student**: alunos vindos do ETL das
  planilhas nao tem WhatsApp. Validators e UI tratam null.
- **ETL legado pendente**: 369 alunos vindos das planilhas Catete /
  Niteroi / Tijuca ainda nao tem WhatsApp coletado. 398 datas Catete
  estao com interpretacao ambigua (US vs BR) — operador valida pelos
  CSVs em `apps/api/scripts/output-prod/`.
- **`.env` da VPS nao versionado**: se for criar um secret novo, criar
  em `apps/api/src/config/env.ts` (schema zod) **e** adicionar no
  arquivo `/opt/vox/app/.env` na VPS — o entrypoint do container vai
  reclamar no boot se faltar.

---

## 10. Quando voce travar

1. Da uma olhada nos logs: `ssh vox 'docker logs vox-api --tail 80'`.
2. Procura `level":"error"` ou `unhandled_error`.
3. Confere o ultimo deploy: `ssh vox 'cd /opt/vox/app && git log -1'`
   (se voce versiona) ou compara hash do bundle com o esperado.
4. Restaura backup se o estrago for grande:
   ```bash
   ssh vox 'cd /opt/vox/app && gunzip -c /opt/vox/backups/<arquivo>.sql.gz | docker compose -f docker-compose.prod.yml exec -T postgres psql -U vox vox'
   ```
5. Se travou de verdade, chama o Gui — direto.
