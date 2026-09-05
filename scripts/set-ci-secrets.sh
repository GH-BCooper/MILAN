#!/usr/bin/env bash
#
# BACKLOG.md §1.2 — push the six repository secrets the CI workflow needs.
#
# Without them .github/workflows/ci.yml skips its build and test steps and
# reports green while testing almost nothing, which is worse than no CI.
#
# Requires the GitHub CLI, authenticated:  gh auth login
# Values are read from .env.local and never printed.
#
#   bash scripts/set-ci-secrets.sh
#
set -euo pipefail

REPO="${REPO:-GH-BCooper/MILAN}"
ENV_FILE="${ENV_FILE:-.env.local}"

SECRETS=(
  DATABASE_URL
  DIRECT_URL
  NEXT_PUBLIC_SUPABASE_URL
  NEXT_PUBLIC_SUPABASE_ANON_KEY
  SUPABASE_SERVICE_ROLE_KEY
  BETTER_AUTH_SECRET
)

command -v gh >/dev/null || { echo "gh is not installed: https://cli.github.com"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "gh is not authenticated. Run: gh auth login"; exit 1; }
[ -f "$ENV_FILE" ] || { echo "$ENV_FILE not found — run this from the repo root"; exit 1; }

# Read a KEY=value line, stripping surrounding quotes. Values may contain '='
# and '@', so split on the first '=' only and never word-split the remainder.
read_env() {
  local key="$1" line
  line="$(grep -m1 "^${key}=" "$ENV_FILE" || true)"
  [ -n "$line" ] || return 1
  local value="${line#*=}"
  value="${value%\"}"; value="${value#\"}"
  value="${value%\'}"; value="${value#\'}"
  printf '%s' "$value"
}

failed=0
for key in "${SECRETS[@]}"; do
  if value="$(read_env "$key")" && [ -n "$value" ]; then
    # `--body-file -` is not in every gh build; with no --body flag gh reads the
    # value from stdin, which every build supports and which keeps the secret
    # off the process argument list where `ps` could read it.
    printf '%s' "$value" | gh secret set "$key" --repo "$REPO"
    echo "  set $key"
  else
    echo "  MISSING $key in $ENV_FILE — not set"
    failed=1
  fi
done

if [ "$failed" -ne 0 ]; then
  echo
  echo "Some secrets were missing. CI will still skip build and test."
  exit 1
fi

echo
echo "All six set. Now trigger a run and confirm Build and Test actually ran:"
echo "  gh workflow run CI --repo $REPO"
echo "  gh run watch --repo $REPO"
