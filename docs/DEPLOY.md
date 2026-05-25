# Deploy — VPS proprio com docker compose

Guia operacional do deploy real do MVP. A stack roda em VPS atras do
Traefik, todos os servicos sobem com `docker-compose.prod.yml`:

- **postgres** (Postgres 16) — banco
- **redis** (Redis 7) — sessoes, magic link, rate limit
- **api** (`Dockerfile.api`) — Node 22 + Express + Prisma, expoe `/api/*`
- **web** (`Dockerfile.web`) — Vite + React, servido como estatico via nginx

> Versoes antigas deste guia descreviam Render e Vercel — nao sao mais o
> caminho atual. Se precisar do historico, ver o git log deste arquivo.

---

## Pre-requisitos da VPS

- Docker Engine + `docker compose` v2 instalados.
- Rede docker externa chamada `web` (compartilhada com o Traefik):
  ```bash
  docker network create web   # so na primeira vez
  ```
- Traefik rodando e atendendo `vox.voxrio.xyz` (router HTTPS com Let's
  Encrypt). As labels do `docker-compose.prod.yml` ja registram api e web.
- `.env` na mesma pasta do `docker-compose.prod.yml`, com os secrets
  abaixo. **Nunca** versionar este arquivo.

### `.env` de producao

| Chave | Como obter / valor |
|---|---|
| `POSTGRES_PASSWORD` | senha forte gerada (uso interno; nao vaza pra app) |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `WEBHOOK_SECRET` | `openssl rand -hex 16` |
| `ADMIN_EMAIL` | e-mail do diretor (login inicial) |
| `ADMIN_PASSWORD` | `openssl rand -base64 18` (so vale pro seed inicial) |
| `BOTCONVERSA_API_KEY` | painel BotConversa → Integracoes → Webhook |

`DATABASE_URL`, `DIRECT_URL` e `REDIS_URL` ja estao definidos dentro do
`docker-compose.prod.yml` apontando pros services internos — nao precisa
duplicar no `.env`.

---

## Fluxo de deploy (toda subida)

A imagem da api ja tem um `ENTRYPOINT` que roda `prisma migrate deploy`
automaticamente antes de iniciar o node — idempotente, no-op quando nao
ha migration pendente. Se uma migration falhar, o container sai com
codigo nao-zero e o restart policy do compose **nao** reinicia em loop
ate o operador resolver.

Mesmo com o auto-migrate, recomenda-se backup antes de qualquer subida
que inclua migration pendente. O fluxo abaixo cobre os dois casos.

### Caso A — Deploy sem migration nova

Identificavel olhando o diff de `apps/api/prisma/migrations/` no commit
que esta subindo: se nao apareceu pasta nova, o auto-migrate vai detectar
"No pending migrations to apply" e seguir direto.

```bash
# Na VPS, na pasta do MVP:
git pull
docker compose -f docker-compose.prod.yml up -d --build
docker logs vox-api --tail 50           # confere boot limpo
curl -fsS https://vox.voxrio.xyz/api/health
```

### Caso B — Deploy COM migration nova (recomendado)

```bash
# 1. Backup antes de qualquer toque no schema.
./scripts/db-backup.sh /var/backups/vox

# 2. Atualiza o codigo.
git pull

# 3. Build da nova imagem da api SEM substituir o container que esta no ar.
docker compose -f docker-compose.prod.yml build api

# 4. (Opcional, paranoico) Roda a migration via container one-shot, fora
#    do servico principal — assim voce vê o log da migration isolado e o
#    container atual continua atendendo trafego ate o passo 5.
docker compose -f docker-compose.prod.yml run --rm \
  --entrypoint sh api -c 'npx prisma migrate deploy --schema apps/api/prisma/schema.prisma'

#    Se preferir confiar no auto-migrate do entrypoint, pula o passo 4 e
#    vai direto pro 5 — a primeira coisa que o api container novo faz e
#    rodar a migration.

# 5. Swap final: substitui api e web pelas novas imagens.
docker compose -f docker-compose.prod.yml up -d --build

# 6. Sanity.
docker logs vox-api --tail 80
curl -fsS https://vox.voxrio.xyz/api/health
```

---

## Primeiro deploy (bootstrap)

So da primeira vez que a stack sobe num servidor zerado:

```bash
# 1. Clonar o repo na pasta de deploy.
git clone https://github.com/Aurius-Insight/vox.git
cd vox

# 2. Criar o .env com os secrets da tabela acima.
nano .env

# 3. Garantir a rede externa do Traefik.
docker network ls | grep web || docker network create web

# 4. Subir a stack. O entrypoint da api roda `prisma migrate deploy`
#    automaticamente — todas as migrations sao aplicadas no primeiro boot.
docker compose -f docker-compose.prod.yml up -d --build

# 5. Rodar o seed inicial — cria diretor (ADMIN_EMAIL/ADMIN_PASSWORD),
#    materias, unidades e pacotes.
docker exec vox-api npm run db:seed

# 6. Validar.
curl -fsS https://vox.voxrio.xyz/api/health
```

Login com `ADMIN_EMAIL` + `ADMIN_PASSWORD` definidos no `.env`. **No ar.**

---

## Rollback

### Rollback do codigo (sem mexer no DB)

```bash
git revert HEAD && git push
docker compose -f docker-compose.prod.yml up -d --build
```

A maioria das migrations e forward-compatible com o codigo anterior
(`ADD COLUMN ... DEFAULT`, `DROP NOT NULL`). Reverter so o codigo
costuma resolver.

### Rollback de uma migration (quando a anterior nao for forward-compatible)

```bash
# Identifica a ultima migration aplicada.
docker exec vox-postgres psql -U vox -d vox \
  -c "SELECT migration_name FROM _prisma_migrations ORDER BY started_at DESC LIMIT 5;"

# Aplica o SQL reverso do `migration.sql` da pasta correspondente,
# adaptado a mao — Prisma nao gera reversos automaticamente.
docker exec -i vox-postgres psql -U vox -d vox <<'SQL'
-- exemplo do reverso de 20260521120000_student_type:
ALTER TABLE "Student" DROP COLUMN "type";
ALTER TABLE "Student" ALTER COLUMN "packageName" SET NOT NULL;
DROP TYPE "StudentType";
SQL

# Marca a migration como nao aplicada no historico do Prisma.
docker exec vox-postgres psql -U vox -d vox \
  -c "DELETE FROM _prisma_migrations WHERE migration_name = '20260521120000_student_type';"
```

Restaurar do backup completo (passo 1 do Caso B) e sempre uma alternativa
quando o reverso fica complexo.

---

## BotConversa (webhook + magic link)

O canal de WhatsApp esta integrado via BotConversa. Detalhes operacionais
do webhook (POST do BotConversa pra VOX) e do magic link (mensagem que a
VOX manda pelo BotConversa) ficam em
[`BOTCONVERSA_INTEGRACAO.md`](./BOTCONVERSA_INTEGRACAO.md).

Pra subir o canal novo:

1. Painel BotConversa → Configuracoes → Integracoes → Webhook Integration
   → copia a API key.
2. Cola em `BOTCONVERSA_API_KEY` no `.env` da VPS.
3. `docker compose -f docker-compose.prod.yml up -d` (sem `--build`,
   so re-cria os containers com o env novo).

---

## Backup

`scripts/db-backup.sh` gera dump comprimido com timestamp + retencao
(14 ultimos). Rodar via cron na propria VPS:

```cron
0 3 * * * cd /opt/vox && ./scripts/db-backup.sh /var/backups/vox >> /var/log/vox-backup.log 2>&1
```

Para backup off-site, agendar copia do `/var/backups/vox` pra S3/B2/etc.
Nao manter so na VPS — se o disco morrer, vai junto.

---

## Monitoramento minimo

- **UptimeRobot** apontando pra `https://vox.voxrio.xyz/api/health` —
  alerta por e-mail se ficar fora por > 2 min.
- `docker logs vox-api -f` mostra logs estruturados (JSON, uma linha por
  evento). Filtros mais usados:
  - `level":"error"` — erros nao tratados.
  - `access_denied` — 401/403/429 (tentativas de acesso).
  - `webhook_botconversa` — entrada de lead pelo webhook.

---

## Troubleshooting

| Sintoma | Provavel causa | Como mitigar |
|---|---|---|
| `vox-api` em restart loop apos deploy | Migration falhou ou crash no boot | `docker logs vox-api --tail 100` mostra a linha do erro. Se for migration, ver secao de Rollback. |
| 502 do Traefik no dominio | api nao subiu (health) ou rede `web` desconectada | `docker ps` confirma containers up; `docker network inspect web` confirma todos os 4 conectados. |
| Login retorna 401 com senha certa | `APP_ORIGIN` divergente do dominio real ou cookie nao sendo aceito | Confirma `APP_ORIGIN=https://vox.voxrio.xyz` no compose. |
| Webhook BotConversa retornando 401 | `WEBHOOK_SECRET` divergente entre VPS e painel BotConversa | Regenera os dois e aplica em ambos. |
| Lead nao aparece apos webhook | Webhook chegou mas falhou na validacao | `docker logs vox-api | grep webhook` — payload + razao. |

---

## Checklist de go-live de cada deploy

- [ ] CI verde no commit que esta sendo deployado.
- [ ] Se inclui migration nova: backup tirado (Caso B passo 1).
- [ ] `docker compose -f docker-compose.prod.yml up -d --build` rodado.
- [ ] `docker logs vox-api --tail 80` sem `unhandled_error` no boot.
- [ ] `curl https://vox.voxrio.xyz/api/health` devolve 200.
- [ ] Login do diretor funciona pela URL publica.
- [ ] Telas tocadas pelo deploy abrem sem console error.
