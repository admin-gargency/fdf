#!/usr/bin/env bash
# kill-fdf-smoke-local.sh — local smoke test of the kill-switch mechanism.
#
# Why: the day-1 production smoke test per Constitution §4.6 runs against
# https://fdf.gargency.com once deploy is live (B6). Until the CEO approves
# the first public deploy (AUTO→ASK per issue rules), we validate the
# mechanism locally: the proxy honors MAINTENANCE_MODE=1 and returns 503.
# This is a pre-flight confidence check — NOT a substitute for the
# production smoke test.
#
# Usage:
#   ./scripts/kill-fdf-smoke-local.sh
#
# Exit codes:
#   0 → all expected statuses observed (200 healthy → 503 maintenance → 200 recovered).
#   2 → missing tools (pnpm, curl).
#   3 → server failed to start within timeout.
#   4 → expected status not observed.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-3731}"
BASE="http://127.0.0.1:${PORT}"
PID_FILE="$(mktemp)"
LOG_FILE="$(mktemp)"

log() {
  printf '%s [smoke-local] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2
}

require() {
  command -v "$1" >/dev/null 2>&1 || { log "missing tool: $1"; exit 2; }
}

require pnpm
require curl

cleanup() {
  if [ -s "$PID_FILE" ]; then
    local pid
    pid="$(cat "$PID_FILE")"
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  fi
  rm -f "$PID_FILE"
}
trap cleanup EXIT INT TERM

cd "$REPO_ROOT"

start_server() {
  local mode="$1"
  log "starting next start in ${mode} mode on port ${PORT}"
  if [ "$mode" = "maintenance" ]; then
    MAINTENANCE_MODE=1 PORT="$PORT" pnpm start >"$LOG_FILE" 2>&1 &
  else
    PORT="$PORT" pnpm start >"$LOG_FILE" 2>&1 &
  fi
  echo $! > "$PID_FILE"

  local tries=0
  until curl -sS -o /dev/null "$BASE/" 2>/dev/null; do
    tries=$((tries + 1))
    if [ "$tries" -gt 60 ]; then
      log "server did not come up within 60s"
      cat "$LOG_FILE" >&2 || true
      exit 3
    fi
    sleep 1
  done
  log "server is up (${tries}s)"
}

probe() {
  local url="$1"
  curl -s -o /dev/null -w '%{http_code}' "$url" || echo 000
}

assert_status() {
  local label="$1" got="$2" want="$3"
  if [ "$got" != "$want" ]; then
    log "FAIL — ${label}: got ${got}, want ${want}"
    exit 4
  fi
  log "OK   — ${label}: ${got}"
}

# Phase 1: healthy baseline.
start_server normal
H_LAND=$(probe "$BASE/")
H_HEAL=$(probe "$BASE/api/health")
assert_status "healthy / (landing)" "$H_LAND" "200"
assert_status "healthy /api/health" "$H_HEAL" "200"
cleanup

# Phase 2: maintenance mode.
start_server maintenance
M_LAND=$(probe "$BASE/")
M_HEAL=$(probe "$BASE/api/health")
assert_status "maintenance / (landing)" "$M_LAND" "503"
assert_status "maintenance /api/health" "$M_HEAL" "503"
cleanup

# Phase 3: recovery — server without MAINTENANCE_MODE is healthy again.
start_server normal
R_LAND=$(probe "$BASE/")
R_HEAL=$(probe "$BASE/api/health")
assert_status "recovered / (landing)" "$R_LAND" "200"
assert_status "recovered /api/health" "$R_HEAL" "200"

log "local smoke test PASS — kill-switch mechanism works end-to-end"
