#!/usr/bin/env bash
# Backup criptografado do banco do consultório.
#
# O que faz: copia o banco (pg_dump), criptografa o arquivo com "age" usando a
# CHAVE PÚBLICA de backup e grava em ./backups com um código de verificação.
# Quem só tem este script e o arquivo não consegue ler o backup: para abrir é
# preciso a chave privada, guardada fora do computador (veja o README).
#
# Uso:
#   export SUPABASE_DB_URL='postgresql://postgres.[ref]:[SENHA]@[host]:5432/postgres'
#   export BACKUP_AGE_RECIPIENT='age1...'     # chave pública de backup
#   ./scripts/backup.sh
set -euo pipefail

: "${SUPABASE_DB_URL:?Defina SUPABASE_DB_URL (veja o README)}"
: "${BACKUP_AGE_RECIPIENT:?Defina BACKUP_AGE_RECIPIENT com a chave pública age}"
command -v pg_dump >/dev/null || { echo "Instale o PostgreSQL client (pg_dump)."; exit 1; }
command -v age >/dev/null || { echo "Instale o age: https://github.com/FiloSottile/age"; exit 1; }

umask 077
DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$DIR/consultorio-$STAMP.dump.age"

# --schema=public: só os dados do consultório. Formato custom: restauração seletiva.
# O arquivo intermediário nunca toca o disco sem criptografia (vai direto pelo pipe).
pg_dump "$SUPABASE_DB_URL" --format=custom --no-owner --no-privileges --schema=public \
  | age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" --output "$OUT"

sha256sum "$OUT" > "$OUT.sha256"
echo "Backup criado: $OUT"
echo "Tamanho: $(du -h "$OUT" | cut -f1)"
echo "Próximo passo: copie o arquivo e o .sha256 para o local de guarda e rode scripts/restore-check.sh uma vez por mês."
