#!/usr/bin/env bash
#
# scripts/reseed-local.sh — wipe and reseed the LOCAL Milan database.
#
# Usage:
#   ./scripts/reseed-local.sh            # prompts for confirmation
#   RESEED_YES=1 ./scripts/reseed-local.sh   # no prompt (scripted runs)
#
# What it does, in order:
#   1. pnpm db:migrate   — bring the schema up (incl. 0014 Smart Education re-theme)
#   2. pnpm seed --reset  — truncate + load seed-data/ (30 challenges, 51 capabilities, users)
#   3. pnpm seed:ai       — replay the AI pipeline over every seed (rules tier by default)
#   4. pnpm seed:states   — walk the cast into 9 distinct statuses, incl. GUM-0002
#                            ROUTED with its SLA ladder rungs shielded +120d so
#                            verify:sla's +45d walk cannot consume verify:gov's target
#
# The app server may stay running while this executes. The suite expects a
# FRESH reseed before verify:phase3 (several children consume state: the SLA
# reaper fires globally, the gate breach sticks, the demo resets the board).
#
set -euo pipefail
cd "$(dirname "$0")/.."

export DATABASE_URL="${DATABASE_URL:-postgresql://milan@localhost:54322/milan}"
export DIRECT_URL="${DIRECT_URL:-$DATABASE_URL}"
export AI_PROVIDER_CHAIN="${AI_PROVIDER_CHAIN:-rules}"

echo "Milan local reseed"
echo "  database : ${DATABASE_URL}"
echo "  AI chain : ${AI_PROVIDER_CHAIN}"
echo

if [[ "${RESEED_YES:-0}" != "1" ]]; then
  echo "This WIPES every table and reseeds from seed-data/."
  read -r -p "Type YES to continue: " answer
  if [[ "$answer" != "YES" ]]; then
    echo "Aborted."
    exit 1
  fi
fi

command -v pnpm >/dev/null || { echo "pnpm is not on PATH." >&2; exit 1; }

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
