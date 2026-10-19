#!/bin/sh
set -e

if [ -n "${DB_PATH:-}" ]; then
  DATA_DIR="$(dirname "$DB_PATH")"
elif [ -n "${DB_DIR:-}" ]; then
  DATA_DIR="$DB_DIR"
else
  DATA_DIR="/app/data"
fi

mkdir -p "$DATA_DIR"
chown -R node:node "$DATA_DIR" 2>/dev/null || true

if ! su-exec node test -w "$DATA_DIR"; then
  echo "[GastroOS] Error: el usuario node no puede escribir en $DATA_DIR." >&2
  echo "[GastroOS] Revisa los permisos del volumen (por ejemplo, db-data)." >&2
  exit 1
fi

exec su-exec node "$@"
