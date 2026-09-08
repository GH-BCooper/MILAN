#!/usr/bin/env bash
#
# scripts/reseed-local.sh — wipe and reseed the Milan database.
#
# Usage:
#   ./scripts/reseed-local.sh            # prompts for confirmation
#   RESEED_YES=1 ./scripts/reseed-local.sh   # no prompt (scripted runs)
#
# Database resolution (first win):
#   1. DATABASE_URL / DIRECT_URL already exported in your shell, or
#   2. the same variables from .env.local (Supabase, per docs/SETUP_GUIDE.md).
# The script never invents a localhost default: a wrong guess either fails
# cryptically in migrate or — worse — wipes the wrong database.
#
# What it does, in order:
#   1. preflight      — the database answers (extensions advisory only)
#   2. pnpm db:migrate   — bring the schema up (incl. 0014 Smart Education re-theme)
#   3. pnpm seed --reset  — truncate + load seed-data/ (30 challenges, 51 capabilities, users)
#   4. pnpm seed:ai       — replay the AI pipeline over every seed (rules tier by default)
#   5. pnpm seed:states   — walk the cast into 9 distinct statuses, incl. GUM-0002
#                            ROUTED with its SLA ladder rungs shielded +120d so
#                            verify:sla's +45d walk cannot consume verify:gov's target
#
# The app server may stay running while this executes. The suite expects a
# FRESH reseed before verify:phase3 (several children consume state: the SLA
# reaper fires globally, the gate breach sticks, the demo resets the board).
#
set -euo pipefail
cd "$(dirname "$0")/.."

# --- resolve database URLs -------------------------------------------
from_dotenv() {
  # $1 = VAR name; prints the value from .env.local or nothing.
  [[ -f .env.local ]] || return 0
  grep -E "^$1=" .env.local | head -1 | cut -d'"' -f2
}

if [[ -z "${DATABASE_URL:-}" ]]; then
  DATABASE_URL="$(from_dotenv DATABASE_URL)"
fi
if [[ -z "${DIRECT_URL:-}" ]]; then
  # Migrations need the session-pooler string; fall back to DATABASE_URL only
  # when nothing more specific exists (plain local Postgres has no pooler).
  DIRECT_URL="$(from_dotenv DIRECT_URL)"
  [[ -n "${DIRECT_URL:-}" ]] || DIRECT_URL="${DATABASE_URL:-}"
fi
export DATABASE_URL="${DATABASE_URL:-}"
export DIRECT_URL="${DIRECT_URL:-}"
export AI_PROVIDER_CHAIN="${AI_PROVIDER_CHAIN:-rules}"

masked() {
  # Show host + db, never the password: postgresql://[user@]host:port/db
  echo "$1" | sed -E 's#(postgresql://)([^@]*@)?([^/]+)(/.*)?#\1\3\4#'
}

echo "Milan reseed"
echo "  database : $(masked "${DATABASE_URL:-<unset>}")"
echo "  migrate via: $(masked "${DIRECT_URL:-<unset>}")"
echo "  AI chain : ${AI_PROVIDER_CHAIN}"
echo

if [[ -z "${DATABASE_URL:-}" || -z "${DIRECT_URL:-}" ]]; then
  echo "ERROR: no database configured." >&2
  echo >&2
  echo "Either export your database URLs:" >&2
  echo '  export DATABASE_URL="postgresql://USER:PASS@HOST:PORT/DB"' >&2
  echo '  export DIRECT_URL="$DATABASE_URL"   # or your session-pooler string' >&2
  echo "or put them in .env.local (see docs/SETUP_GUIDE.md section 4)." >&2
  echo >&2
  echo "No database yet? The project needs Postgres 17 with the extensions" >&2
  echo "vector, pg_trgm, pgcrypto and unaccent (Supabase: Database → Extensions;" >&2
  echo "local: CREATE EXTENSION vector, pg_trgm, pgcrypto, unaccent) plus the" >&2
  echo "media + artifacts storage buckets for the photo/artifact legs." >&2
  exit 1
fi

command -v pnpm >/dev/null || { echo "ERROR: pnpm is not on PATH." >&2; exit 1; }
command -v node >/dev/null || { echo "ERROR: node is not on PATH." >&2; exit 1; }

# --- preflight: the database answers ----------------------------------
echo "--- 0/4 preflight ----------------------------------------------"
if ! node --input-type=module -e "
import postgres from 'postgres';
const sql = postgres(process.env.DIRECT_URL, { max: 1, connect_timeout: 8, prepare: false });
try {
  await sql\`select 1\`;
  console.log('database answers.');
  // Advisory only: the full green qualification ran on a database with just
  // vector + plpgsql, so a missing extension warns instead of blocking.
  // (Supabase: Database -> Extensions, one click each.)
  const ext = await sql\`select extname from pg_extension where extname in ('vector','pg_trgm','pgcrypto','unaccent')\`;
  const have = new Set(ext.map((r) => r.extname));
  for (const need of ['vector','pg_trgm','pgcrypto','unaccent']) {
    if (!have.has(need)) console.log('WARNING: extension not installed: ' + need);
  }
} catch (e) {
  console.error('CONNECT FAILED: ' + (e.message || e));
  process.exit(3);
} finally {
  await sql.end();
}
"; then
  echo >&2
  echo "ERROR: preflight failed — not running migrate against an unreachable database." >&2
  echo "Fix the URL / start Postgres / enable the extensions, then re-run." >&2
  exit 1
fi

# --- confirm (louder when the target is not localhost) -----------------
is_local() {
  [[ "$1" == *"@localhost"* || "$1" == *"@127.0.0.1"* || "$1" == *"@::1"* ]]
}

if [[ "${RESEED_YES:-0}" != "1" ]]; then
  if is_local "$DATABASE_URL"; then
    echo "This WIPES every table on the database above and reseeds from seed-data/."
    read -r -p "Type YES to continue: " answer
    [[ "$answer" == "YES" ]] || { echo "Aborted."; exit 1; }
  else
    echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
    echo "!! The target is NOT localhost — this will WIPE A REMOTE DB !!"
    echo "!! $(masked "$DATABASE_URL")"
    echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
    read -r -p "Type WIPE-REMOTE to continue: " answer
    [[ "$answer" == "WIPE-REMOTE" ]] || { echo "Aborted."; exit 1; }
  fi
fi

echo "--- 1/4 migrate ------------------------------------------------"
pnpm db:migrate

echo "--- 2/4 seed --reset -------------------------------------------"
pnpm seed --reset

echo "--- 3/4 seed:ai (pipeline replay) ------------------------------"
pnpm seed:ai

echo "--- 4/4 seed:states (board cast) --------------------------------"
pnpm seed:states

echo
echo "Reseed complete. Expected tail: SUBMITTED×16 ROUTED×4"
echo "CITIZEN_VERIFIED×3 FORWARDED_EXTERNAL×2 BOUNTY_LISTED×1"
echo "SOLUTION_PUBLISHED×1 IN_RESEARCH×1 CLOSED×1 TRIAGED×1."
echo "Next: start the server (pnpm build && pnpm start -H 0.0.0.0 -p 3000)"
echo "and work through docs/qualification-checklist.csv."
