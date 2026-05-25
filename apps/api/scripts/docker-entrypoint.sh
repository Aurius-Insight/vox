#!/bin/sh
#
# Entrypoint da imagem da API em producao.
#
# Roda `prisma migrate deploy` antes de iniciar o processo Node. Se a
# migration falhar, o container sai com codigo nao-zero e o docker compose
# nao reinicia o servico ate o operador resolver — evita boot loop com
# DB em estado inconsistente.
#
# `prisma migrate deploy` e idempotente: aplica so o que falta e sai 0 se
# o banco ja estiver atualizado. Pode rodar todo boot sem efeito colateral.
#
# `exec` substitui o shell pelo node — sinais (SIGTERM do docker stop)
# chegam direto no processo certo.

set -e

echo "[entrypoint] aplicando migrations pendentes..."
npx --no-install prisma migrate deploy --schema apps/api/prisma/schema.prisma

echo "[entrypoint] iniciando api na porta ${PORT:-3333}..."
exec node apps/api/dist/index.js
