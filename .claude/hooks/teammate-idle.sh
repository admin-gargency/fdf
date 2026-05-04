#!/usr/bin/env bash
# .claude/hooks/teammate-idle.sh
#
# TeammateIdle hook per Agent Teams su FdF.
# Light-touch per il pilot: logga la transizione idle, non blocca.
# Exit 0 = OK (idle confermato).
# Exit 2 = block (manda feedback e tieni il teammate al lavoro).
#
# Per il pilot: non bloccare. Raccogliere dati prima di formalizzare
# regole. Se durante il pilot emergeranno pattern di idle prematuro,
# raffinare qui.

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")"
LOG_DIR="$REPO_ROOT/.claude/logs"
LOG_FILE="$LOG_DIR/teammate-idle.log"

mkdir -p "$LOG_DIR"

# Log strutturato (1 riga per evento, JSON-like)
TIMESTAMP="$(date -Iseconds)"
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")"

# Hook input arriva su stdin (JSON con metadata teammate)
# Per il pilot lo ignoriamo, ci basta loggare evento + branch
INPUT="$(cat 2>/dev/null || echo "{}")"

echo "{\"timestamp\":\"$TIMESTAMP\",\"branch\":\"$BRANCH\",\"event\":\"teammate_idle\",\"input_size\":${#INPUT}}" >> "$LOG_FILE"

# Per il pilot: non bloccare
exit 0
