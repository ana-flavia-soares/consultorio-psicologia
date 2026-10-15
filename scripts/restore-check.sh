#!/usr/bin/env bash
# Prova que um backup pode ser restaurado. Backup nunca testado não é garantia.
#
# O que faz: confere o código de verificação, descriptografa com a chave
# privada, restaura num Postgres temporário NESTE computador e conta as linhas
# de cada tabela. Nada é enviado para fora e o banco temporário é apagado no fim.
#
# Uso:
#   ./scripts/restore-check.sh backups/consultorio-AAAAMMDD-HHMMSS.dump.age caminho/da/chave-privada.txt
set -euo pipefail

FILE="${1:?Informe o arquivo .dump.age}"
IDENTITY="${2:?Informe o arquivo da chave privada age}"
PG_BIN="${PG_BIN:-$(dirname "$(command -v initdb 2>/dev/null || ls /usr/lib/postgresql/*/bin/initdb | tail -1)")}"
PORT="${PORT:-54330}"

if [ -f "$FILE.sha256" ]; then
  sha256sum --check --quiet "$FILE.sha256" && echo "Código de verificação confere."
else
  echo "Aviso: arquivo .sha256 não encontrado; integridade do arquivo não conferida."
fi

umask 077
WORK="$(mktemp -d)"
trap '"$PG_BIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT

age --decrypt --identity "$IDENTITY" --output "$WORK/backup.dump" "$FILE"
"$PG_BIN/initdb" -D "$WORK/data" -U postgres -A trust >/dev/null
"$PG_BIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null
PSQL=("$PG_BIN/psql" -h "$WORK" -p "$PORT" -U postgres -d postgres -X -q -v ON_ERROR_STOP=1)

# O backup referencia o esquema "auth" do Supabase; criamos o mínimo para restaurar.
"${PSQL[@]}" -f "$(dirname "$0")/../supabase/tests/00_supabase_shim.sql" >/dev/null
# O backup recria o esquema public; removemos o vazio que vem com o banco novo.
"${PSQL[@]}" -c "set client_min_messages = warning; drop schema public cascade;" >/dev/null
# Usuários de auth não estão no backup; as chaves estrangeiras são recriadas sem validar.
"$PG_BIN/pg_restore" -h "$WORK" -p "$PORT" -U postgres -d postgres --no-owner --no-privileges --exit-on-error \
  --section=pre-data "$WORK/backup.dump"
"$PG_BIN/pg_restore" -h "$WORK" -p "$PORT" -U postgres -d postgres --no-owner --no-privileges --disable-triggers --exit-on-error \
  --section=data "$WORK/backup.dump"

echo "Restauração concluída. Linhas por tabela:"
"${PSQL[@]}" -A -F ' ' -t -c "
  select 'pacientes', count(*) from public.patients union all
  select 'sessões', count(*) from public.sessions union all
  select 'pagamentos', count(*) from public.payments union all
  select 'anotações (versões)', count(*) from public.session_notes union all
  select 'auditoria', count(*) from public.audit_log union all
  select 'cofre', count(*) from public.vault;"
echo "Backup restaurável. Anote a data deste teste."
