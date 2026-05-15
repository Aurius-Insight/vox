#!/usr/bin/env bash
#
# Backup do banco do MVP Vox RJ: dump comprimido com timestamp + retencao.
#
# Uso:   ./scripts/db-backup.sh [diretorio-destino]
#        (destino padrao: ./backups)
#
# Requer: pg_dump no PATH e DATABASE_URL no ambiente ou no .env da raiz do MVP.
#
# Producao: agendar diariamente via cron, por exemplo:
#   0 3 * * * cd /caminho/para/MVP && ./scripts/db-backup.sh /var/backups/vox
#
# Retencao: mantem os $KEEP_COUNT dumps mais recentes (apaga os mais antigos).
# Assume execucao diaria; se rodar varias vezes ao dia, a retencao por contagem
# vai eliminar dumps validos. Nesse caso, troque para retencao por idade
# (`find -mtime +14 -delete`).
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST_DIR="${1:-$ROOT_DIR/backups}"
KEEP_COUNT=14

# Carrega DATABASE_URL do .env da raiz se nao estiver no ambiente.
# Remove aspas (simples ou duplas) e CR de arquivos vindos de Windows.
if [[ -z "${DATABASE_URL:-}" && -f "$ROOT_DIR/.env" ]]; then
  raw="$(grep -E '^DATABASE_URL=' "$ROOT_DIR/.env" | head -1 | cut -d= -f2-)"
  raw="${raw%$'\r'}"
  raw="${raw#\"}"; raw="${raw%\"}"
  raw="${raw#\'}"; raw="${raw%\'}"
  DATABASE_URL="$raw"
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "erro: DATABASE_URL nao definida (ambiente ou $ROOT_DIR/.env)." >&2
  exit 1
fi

# Pasta de backup so legivel pelo dono: dumps tem hashes de CPF, emails, etc.
mkdir -p "$DEST_DIR"
chmod 700 "$DEST_DIR" 2>/dev/null || true

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$DEST_DIR/vox-mvp-$STAMP.sql.gz"

# Write atomico: grava em .tmp e renomeia ao final. Em caso de falha do
# pg_dump (pipefail), nao deixa dump parcial sendo contado pela retencao.
pg_dump "$DATABASE_URL" | gzip > "$OUT.tmp"
mv "$OUT.tmp" "$OUT"
chmod 600 "$OUT"
echo "backup gravado: $OUT"

# Retencao: mantem apenas os $KEEP_COUNT dumps mais recentes. Loop em vez
# de `xargs` para ser portavel entre BSD (macOS) e GNU (Linux) e nao falhar
# quando nao ha o que apagar.
ls -1t "$DEST_DIR"/vox-mvp-*.sql.gz 2>/dev/null \
  | tail -n "+$((KEEP_COUNT + 1))" \
  | while IFS= read -r old; do rm -f "$old"; done
