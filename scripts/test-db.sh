#!/usr/bin/env bash
# Sobe um Postgres temporário, aplica a migração e roda os testes de segurança.
# Requer os binários do PostgreSQL 15+ (initdb, pg_ctl, psql) no PATH ou em PG_BIN.
set -euo pipefail
cd "$(dirname "$0")/.."

PG_BIN="${PG_BIN:-$(dirname "$(command -v initdb 2>/dev/null || ls /usr/lib/postgresql/*/bin/initdb | tail -1)")}"
PORT="${PORT:-54329}"
DATA="$(mktemp -d)"
trap '"$PG_BIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DATA"' EXIT

"$PG_BIN/initdb" -D "$DATA" -U postgres -A trust >/dev/null
"$PG_BIN/pg_ctl" -D "$DATA" -o "-p $PORT -k $DATA -c listen_addresses=''" -l "$DATA/log" -w start >/dev/null

PSQL=("$PG_BIN/psql" -h "$DATA" -p "$PORT" -U postgres -d postgres -X -q -v ON_ERROR_STOP=1)
"${PSQL[@]}" -f supabase/tests/00_supabase_shim.sql
for m in supabase/migrations/*.sql; do "${PSQL[@]}" -f "$m"; done
set -o pipefail
"${PSQL[@]}" -f supabase/tests/10_regras_de_seguranca.sql 2>&1 | sed -e 's/^psql:[^ ]* NOTICE:  //' -e 's/^psql:[^ ]* ERROR:  /ERRO: /'
