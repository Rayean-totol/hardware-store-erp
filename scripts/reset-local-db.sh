#!/usr/bin/env bash
# Recreate a plain-Postgres database with the Supabase shim, all migrations and (optionally) seed data.
# Usage: scripts/reset-local-db.sh <database-url-of-maintenance-db> <db-name> [--seed]
# Example: scripts/reset-local-db.sh postgres://erp:erp@localhost:5432/postgres erp_dev --seed
# For a real Supabase project use `supabase db reset` instead (see docs/setup.md).
set -euo pipefail
ADMIN_URL="${1:?maintenance database url required}"
DB="${2:?database name required}"
SEED="${3:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB_URL="${ADMIN_URL%/*}/${DB}"

psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "drop database if exists \"$DB\" with (force)" -c "create database \"$DB\""
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/tests/supabase-shim.sql" 2>&1 | grep -v 'already been granted' || true
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "applying $(basename "$f")"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done
if [[ "$SEED" == "--seed" ]]; then
  echo "applying seed.sql"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/seed.sql"
fi
echo "done: $DB_URL"
