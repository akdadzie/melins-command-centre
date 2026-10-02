#!/usr/bin/env bash
# Loads a weekly backup's data (and logins, if the archive has them) into a
# database that already has every migration applied and no users yet (docs/BACKUP_RESTORE.md; A-046). It empties the public
# tables first (the migrations seed reference data), then loads data.sql with
# triggers off, so the ledger, audit and numbering triggers don't run again
# on rows that already carry their results.
#
#   scripts/backup/restore.sh <backup archive (.tar.gz or .tar.gz.gpg)> <database url>
#   BACKUP_PASSPHRASE must be set for an encrypted archive.
set -euo pipefail
ARCHIVE="${1:?archive}"; DB_URL="${2:?database url}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

if [[ "$ARCHIVE" == *.gpg ]]; then
  : "${BACKUP_PASSPHRASE:?Set BACKUP_PASSPHRASE to decrypt}"
  gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 0 -d "$ARCHIVE" <<< "$BACKUP_PASSPHRASE" | tar -xz -C "$TMP"
else
  tar -xzf "$ARCHIVE" -C "$TMP"
fi
DIR="$(find "$TMP" -mindepth 1 -maxdepth 1 -type d | head -1)"
[ -f "$DIR/data.sql" ] || { echo "No data.sql in the archive" >&2; exit 1; }

{
  echo "\set ON_ERROR_STOP 1"
  echo "begin;"
  echo "set session_replication_role = replica;"
  echo "do \$\$ declare t text; begin"
  echo "  for t in select tablename from pg_tables where schemaname = 'public' loop"
  echo "    execute format('truncate table public.%I cascade', t);"
  echo "  end loop;"
  echo "end \$\$;"
  [ -f "$DIR/auth.sql" ] && echo "\i '$DIR/auth.sql'"
  echo "\i '$DIR/data.sql'"
  echo "set session_replication_role = origin;"
  echo "commit;"
} > "$TMP/restore.sql"
psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$TMP/restore.sql"

echo "Restored. Row counts (compare with MANIFEST.txt):"
for t in $(psql "$DB_URL" -X -At -c "select tablename from pg_tables where schemaname = 'public' order by 1" | tr -d '\r'); do
  printf '%-40s %s\n' "$t" "$(psql "$DB_URL" -X -At -c "select count(*) from public.\"$t\"" | tr -d '\r')"
done > "$TMP/counts.txt"
if diff <(grep -E '^[a-z_]+ +[0-9]+$' "$DIR/MANIFEST.txt") "$TMP/counts.txt" >/dev/null; then
  echo "Every table matches the backup's manifest."
else
  echo "Some counts differ from the manifest:" >&2
  diff <(grep -E '^[a-z_]+ +[0-9]+$' "$DIR/MANIFEST.txt") "$TMP/counts.txt" >&2 || true
  exit 1
fi
