#!/usr/bin/env bash
# Rebuilds a throwaway local database and applies the Supabase shim, every
# migration, the seed and the SQL tests, stopping at the first error.
#
# Usage: supabase/tests/run.sh            (uses PGPORT, default 54329)
# Needs a local PostgreSQL 15+ you can connect to as postgres without a password.
set -euo pipefail
cd "$(dirname "$0")/../.."

PSQL="${PSQL:-psql}"
if ! command -v "$PSQL" >/dev/null 2>&1 && [ -x "/c/Program Files/PostgreSQL/17/bin/psql.exe" ]; then
  PSQL="/c/Program Files/PostgreSQL/17/bin/psql.exe"
fi
PORT="${PGPORT:-54329}"
DB="${TEST_DB:-melins_test}"
run() { "$PSQL" -X -q -p "$PORT" -U postgres -v ON_ERROR_STOP=1 "$@"; }

run -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null

files=(supabase/tests/00_supabase_shim.sql supabase/migrations/*.sql)
[ -f supabase/seed.sql ] && files+=(supabase/seed.sql)
files+=(supabase/tests/01_test_helpers.sql)
for f in "${files[@]}"; do
  echo "apply  $f"
  run -d "$DB" -1 -o /dev/null -f "$f"
done

shopt -s nullglob
for f in supabase/tests/[1-9]*_test_*.sql; do
  echo "test   $f"
  run -d "$DB" -o /dev/null -f "$f" 2>&1 | grep -v "^$" | sed "s/^psql:[^ ]* NOTICE:  //"
  [ "${PIPESTATUS[0]}" -eq 0 ] || exit 1
done
echo "OK"
