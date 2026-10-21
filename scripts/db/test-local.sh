#!/usr/bin/env bash
# scripts/db/test-local.sh — apply all Supabase migrations to a throwaway database on plain
# PostgreSQL 16 and run the SQL tests in supabase/tests/. No Supabase CLI or Docker needed.
#
# Usage:   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres bash scripts/db/test-local.sh
# Needs:   psql on PATH; a role on the server that can CREATE DATABASE (e.g. the `postgres`
#          superuser of a `postgres:16` CI service container). Contrib extension `citext`.
# Env:     KEEP_DB=1  keep the scratch database for inspection (default: dropped on exit).
#
# Steps (each psql run uses ON_ERROR_STOP=1, so any error -> non-zero exit):
#   1. create scratch database  ciq_test_<pid>
#   2. scripts/db/auth-stub.sql          (roles, auth schema, auth.uid()/jwt() like Supabase)
#   3. supabase/migrations/*.sql          (lexical = timestamp order)
#   4. scripts/db/test-fixtures.sql       (assertion helpers + synthetic orgs/users)
#   5. supabase/tests/*.sql               (each wrapped in begin ... rollback)
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "error: DATABASE_URL is not set (e.g. postgresql://postgres:postgres@localhost:5432/postgres)" >&2
  exit 2
fi
command -v psql >/dev/null || { echo "error: psql not found on PATH" >&2; exit 2; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEST_DB="ciq_test_$$"

# Build a connection string for the scratch database from DATABASE_URL.
if [[ "$DATABASE_URL" =~ ^postgres(ql)?:// ]]; then
  base="${DATABASE_URL%%\?*}"
  query=""
  [[ "$DATABASE_URL" == *\?* ]] && query="?${DATABASE_URL#*\?}"
  authority="${base#*://}"
  scheme="${base%%://*}"
  hostpart="${authority%%/*}"
  TEST_URL="${scheme}://${hostpart}/${TEST_DB}${query}"
else
  TEST_URL="${DATABASE_URL} dbname=${TEST_DB}"   # key=value conninfo: last dbname wins
fi

PSQL=(psql -X -q -v ON_ERROR_STOP=1 --set=VERBOSITY=terse)

cleanup() {
  if [[ "${KEEP_DB:-0}" != "1" ]]; then
    "${PSQL[@]}" "$DATABASE_URL" -c "drop database if exists ${TEST_DB} with (force)" >/dev/null 2>&1 || true
  else
    echo "kept scratch database: ${TEST_DB}"
  fi
}
trap cleanup EXIT

echo "==> creating scratch database ${TEST_DB}"
"${PSQL[@]}" "$DATABASE_URL" -c "create database ${TEST_DB}"

echo "==> applying scripts/db/auth-stub.sql"
"${PSQL[@]}" "$TEST_URL" -f "$ROOT/scripts/db/auth-stub.sql"

shopt -s nullglob
migrations=("$ROOT"/supabase/migrations/*.sql)
tests=("$ROOT"/supabase/tests/*.sql)
shopt -u nullglob

for f in "${migrations[@]}"; do
  echo "==> migration $(basename "$f")"
  "${PSQL[@]}" "$TEST_URL" -1 -f "$f"
done

echo "==> applying scripts/db/test-fixtures.sql"
"${PSQL[@]}" "$TEST_URL" -f "$ROOT/scripts/db/test-fixtures.sql"

if [[ ${#tests[@]} -eq 0 ]]; then
  echo "error: no tests found in supabase/tests/" >&2
  exit 1
fi

total=0
for f in "${tests[@]}"; do
  echo "==> test $(basename "$f")"
  # Assertion helpers print 'ok - ...' as NOTICEs on stderr; a failure raises and stops psql.
  out="$("${PSQL[@]}" "$TEST_URL" -f "$f" 2>&1)" || { echo "$out"; echo "FAILED: $(basename "$f")" >&2; exit 1; }
  n="$(grep -c 'ok - ' <<<"$out" || true)"
  sed -n 's/.*NOTICE:  \(ok - .*\)/  \1/p' <<<"$out"
  total=$((total + n))
done

echo "==> all ${#tests[@]} test files passed (${total} assertions)"
