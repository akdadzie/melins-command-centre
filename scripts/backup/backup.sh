#!/usr/bin/env bash
# Weekly full export (brief §3 Backups; D-009, A-015, A-046): the app's
# schemas as SQL (structure and data) plus one CSV per table, in one archive,
# encrypted with BACKUP_PASSPHRASE when it is set. Run by
# .github/workflows/backup.yml, which uploads the archive to the restricted
# Google Drive folder. Nothing is kept in the repository.
#
#   BACKUP_DB_URL      connection string to the database (session pooler, port 5432)
#   BACKUP_PASSPHRASE  optional but recommended; keep it offline with the Owner
#   OUT_DIR            where the archive is written (default ./backup-out)
#
# Row-level security is switched off for the session, so if the login can't
# see every row the export fails loudly instead of writing partial files.
set -euo pipefail

: "${BACKUP_DB_URL:?Set BACKUP_DB_URL}"
OUT_DIR="${OUT_DIR:-backup-out}"
STAMP="$(date -u +%Y-%m-%d)"
NAME="melins-backup-$STAMP"
WORK="$OUT_DIR/$NAME"
export PGOPTIONS="-c row_security=off"

rm -rf "$WORK"
mkdir -p "$WORK/csv"
psql_() { psql "$BACKUP_DB_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }
# Query output without carriage returns (psql on Windows ends lines with \r\n).
q() { psql_ -At -c "$1" | tr -d '\r'; }

# 1. SQL. data.sql is what scripts/backup/restore.sh loads into a database
#    built from the migrations (the schema, policies and grants come from
#    git). melins.sql is the full structure and data, for reading or for a
#    plain PostgreSQL.
pg_dump "$BACKUP_DB_URL" --no-owner --no-privileges --data-only --schema=public --file "$WORK/data.sql"
pg_dump "$BACKUP_DB_URL" --no-owner --no-privileges --schema=public --schema=app --file "$WORK/melins.sql"
# Logins (users, sign-in identities, authenticators) so a restore keeps
# everyone's access. They include password hashes and 2FA secrets, so they're
# only exported into an encrypted archive (A-046).
if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  pg_dump "$BACKUP_DB_URL" --no-owner --no-privileges --data-only     --table=auth.users --table=auth.identities --table=auth.mfa_factors --file "$WORK/auth.sql"
fi

# 2. CSV: every table in public, with a header row.
tables="$(q "select tablename from pg_tables where schemaname = 'public' order by 1")"
for t in $tables; do
  psql_ -c "\\copy public.\"$t\" to '$WORK/csv/$t.csv' with (format csv, header)"
done

# 3. Manifest: when, and how many rows per table, to check a restore against.
{
  echo "MeLiNS Command Centre backup, $(date -u '+%Y-%m-%d %H:%M') UTC"
  echo "Restore: see docs/BACKUP_RESTORE.md"
  echo
  for t in $tables; do
    printf '%-40s %s\n' "$t" "$(q "select count(*) from public.\"$t\"")"
  done
} > "$WORK/MANIFEST.txt"

# 4. One archive, encrypted if a passphrase is set.
tar -C "$OUT_DIR" -czf "$OUT_DIR/$NAME.tar.gz" "$NAME"
rm -rf "$WORK"
if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 0 --symmetric --cipher-algo AES256 \
      -o "$OUT_DIR/$NAME.tar.gz.gpg" "$OUT_DIR/$NAME.tar.gz" <<< "$BACKUP_PASSPHRASE"
  rm "$OUT_DIR/$NAME.tar.gz"
  echo "$OUT_DIR/$NAME.tar.gz.gpg"
else
  echo "$OUT_DIR/$NAME.tar.gz"
fi
