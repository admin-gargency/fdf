#!/usr/bin/env bash
# Installs the framework-baseline .claude/settings.json into this repo.
# Why not committed directly: the Claude Code harness sandbox gates writes
# to the .claude/ folder. Run this once per clone, manually, to apply
# the baseline defined in framework/runtime/claude-settings.baseline.json
# (gargency-context).
#
# Usage:
#   ./scripts/setup-claude-settings.sh [path-to-gargency-context]
# Default context path:  ~/dev/gargency-context

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CTX_ROOT="${1:-${HOME}/dev/gargency-context}"
BASELINE="${CTX_ROOT}/framework/runtime/claude-settings.baseline.json"
TARGET="${REPO_ROOT}/.claude/settings.json"

if [ ! -f "$BASELINE" ]; then
  echo "error: baseline not found at $BASELINE" >&2
  echo "hint: pass the gargency-context path as \$1" >&2
  exit 1
fi

mkdir -p "${REPO_ROOT}/.claude"
cp "$BASELINE" "$TARGET"
echo "installed: $TARGET"
echo "source:    $BASELINE"
