#!/usr/bin/env bash
# kill-fdf.sh — kill switch for FdF (Constitution v2.0 §4.6, spine.md §Kill orchestration)
#
# What it does:
#   1. Flip Vercel env var MAINTENANCE_MODE=1 (Production scope) so the Next.js
#      proxy returns HTTP 503 for every request (src/proxy.ts). This covers
#      the landing, /api/health, /api/waitlist and any future endpoint.
#   2. Deploy the same build to Production to propagate the env. Vercel's
#      edge network updates in ~seconds once the deployment completes.
#   3. Fetch https://fdf.gargency.com/ (and /api/health) a few times to
#      confirm 503. Exits non-zero if traffic still sees 200.
#
# Target: complete in under 5 minutes. Hard limit: 60 minutes (§4.6).
#
# Usage:
#   ./scripts/kill-fdf.sh                # kill (toggle MAINTENANCE_MODE=1 + redeploy)
#   ./scripts/kill-fdf.sh --revive       # inverse: remove MAINTENANCE_MODE, redeploy
#   ./scripts/kill-fdf.sh --target <url> # smoke against an explicit URL (preview, staging)
#
# Prerequisites:
#   - `vercel` CLI authenticated (`vercel login`).
#   - Repo linked to the Vercel project (`vercel link` once, `.vercel/` committed-ignored).
#   - Stripe keys live in TEST mode pre-launch → Stripe revoke is a NO-OP here;
#     post-launch this script must be extended with `stripe api_keys expire`
#     (Stripe CLI) before flipping MAINTENANCE_MODE, per ADR-0003 §8.
#
# Observability:
#   Logs to stderr with ISO-8601 timestamps. Exit codes:
#     0 → kill (or revive) completed + smoke confirmed expected status.
#     2 → preconditions not met (no vercel CLI, no project link, no auth).
#     3 → toggle/redeploy failed.
#     4 → smoke verification failed (traffic did not reach expected status).

set -euo pipefail

MODE="kill"
TARGET_URL="https://fdf.gargency.com"
HEALTH_PATH="/api/health"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

while [ $# -gt 0 ]; do
  case "$1" in
    --revive) MODE="revive"; shift ;;
    --target) TARGET_URL="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,30p' "$0"; exit 0 ;;
    *)
      echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

log() {
  printf '%s [kill-fdf] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2
}

require() {
  command -v "$1" >/dev/null 2>&1 || { log "missing required tool: $1"; exit 2; }
}

require vercel
require curl
require jq

cd "$REPO_ROOT"

if [ ! -f .vercel/project.json ]; then
  log "repo is not linked to a Vercel project. Run 'vercel link' first."
  exit 2
fi

case "$MODE" in
  kill)
    log "step 1/3 — set MAINTENANCE_MODE=1 in Vercel production env"
    # Remove first to keep the command idempotent; ignore missing-var errors.
    vercel env rm MAINTENANCE_MODE production --yes >/dev/null 2>&1 || true
    printf '1' | vercel env add MAINTENANCE_MODE production

    log "step 2/3 — redeploy to production to propagate env"
    vercel deploy --prod --yes

    log "step 3/3 — verify traffic returns 503"
    STATUS_LAND=$(curl -s -o /dev/null -w '%{http_code}' "${TARGET_URL}/") || true
    STATUS_HEALTH=$(curl -s -o /dev/null -w '%{http_code}' "${TARGET_URL}${HEALTH_PATH}") || true
    log "observed: / = ${STATUS_LAND}; ${HEALTH_PATH} = ${STATUS_HEALTH}"

    if [ "${STATUS_LAND}" != "503" ] || [ "${STATUS_HEALTH}" != "503" ]; then
      log "ERROR: kill not confirmed (expected 503 on both). Investigate manually."
      exit 4
    fi
    log "kill confirmed — FdF returning 503 on landing and /api/health"
    ;;

  revive)
    log "step 1/3 — remove MAINTENANCE_MODE from Vercel production env"
    vercel env rm MAINTENANCE_MODE production --yes >/dev/null 2>&1 || true

    log "step 2/3 — redeploy to production to propagate env"
    vercel deploy --prod --yes

    log "step 3/3 — verify traffic returns 200"
    STATUS_LAND=$(curl -s -o /dev/null -w '%{http_code}' "${TARGET_URL}/") || true
    STATUS_HEALTH=$(curl -s -o /dev/null -w '%{http_code}' "${TARGET_URL}${HEALTH_PATH}") || true
    log "observed: / = ${STATUS_LAND}; ${HEALTH_PATH} = ${STATUS_HEALTH}"

    if [ "${STATUS_LAND}" != "200" ] || [ "${STATUS_HEALTH}" != "200" ]; then
      log "ERROR: revive not confirmed (expected 200 on both). Investigate manually."
      exit 4
    fi
    log "revive confirmed — FdF healthy on landing and /api/health"
    ;;
esac
