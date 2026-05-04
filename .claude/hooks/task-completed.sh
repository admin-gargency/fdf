#!/usr/bin/env bash
# .claude/hooks/task-completed.sh
#
# TaskCompleted hook per Agent Teams su FdF.
# Blocca il completamento di un task se i quality gate falliscono.
# Exit 2 = block + send feedback al teammate.
# Exit 0 = OK, proceed.
#
# Riferimento: https://code.claude.com/docs/en/hooks
# Nota: la sintassi precisa di TaskCompleted/TeammateIdle hook è
# documentata in code.claude.com/docs/en/agent-teams. Verificare
# con `claude --version` >= 2.1.32.

set -uo pipefail

# Colori per leggibilità in terminale
RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[1;33m'
NC=$'\033[0m'

# Trova root del repo
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$REPO_ROOT" ]; then
  echo "${RED}BLOCK:${NC} non sono in un repo git" >&2
  exit 2
fi
cd "$REPO_ROOT"

echo "${YELLOW}=== TaskCompleted quality gate (FdF) ===${NC}"
echo "Repo: $REPO_ROOT"
echo "Branch: $(git rev-parse --abbrev-ref HEAD)"
echo "Time: $(date -Iseconds)"

# Gate 1: install (frozen) per essere sicuri di avere deps coerenti
echo ""
echo "${YELLOW}[1/4]${NC} pnpm install --frozen-lockfile"
if ! pnpm install --frozen-lockfile --silent 2>&1 | tail -5; then
  echo "${RED}BLOCK:${NC} pnpm install fallita. Verifica pnpm-lock.yaml." >&2
  exit 2
fi

# Gate 2: lint
echo ""
echo "${YELLOW}[2/4]${NC} pnpm lint"
if ! pnpm lint; then
  echo "${RED}BLOCK:${NC} pnpm lint fallita. Risolvi gli errori prima di completare." >&2
  exit 2
fi

# Gate 3: test
echo ""
echo "${YELLOW}[3/4]${NC} pnpm test --run"
if ! pnpm test --run; then
  echo "${RED}BLOCK:${NC} pnpm test fallita. Risolvi i test failing prima di completare." >&2
  exit 2
fi

# Gate 4: build (solo se la PR tocca apps/web/, altrimenti skip)
echo ""
echo "${YELLOW}[4/4]${NC} build conditional check"
CHANGED_FILES="$(git diff --name-only origin/main...HEAD 2>/dev/null || git diff --name-only HEAD~1 2>/dev/null || echo "")"
if echo "$CHANGED_FILES" | grep -qE "^(apps/web/|packages/)" ; then
  echo "Cambi in apps/web/ o packages/ rilevati → eseguo build"
  if ! pnpm --filter web build; then
    echo "${RED}BLOCK:${NC} pnpm build fallita. Il codice non compila per produzione." >&2
    exit 2
  fi
else
  echo "Nessun cambio in apps/web/ o packages/ → skip build"
fi

# Gate 5 (extra): scan rapido per PII patterns nei file modificati
echo ""
echo "${YELLOW}[extra]${NC} PII pattern scan sui file modificati"
PII_HITS=0
for f in $CHANGED_FILES; do
  if [ -f "$f" ] && [[ "$f" =~ \.(ts|tsx|js|jsx|sql)$ ]]; then
    # Cerca console.log con email-like patterns o IBAN-like patterns
    if grep -nE 'console\.(log|info|warn|error).*[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' "$f" >/dev/null 2>&1; then
      echo "${YELLOW}WARN:${NC} possibile email in console.log: $f" >&2
      PII_HITS=$((PII_HITS+1))
    fi
    if grep -nE 'console\.(log|info|warn|error).*IT[0-9]{2}[A-Z][0-9]{10}' "$f" >/dev/null 2>&1; then
      echo "${RED}BLOCK:${NC} possibile IBAN in console.log: $f" >&2
      exit 2
    fi
  fi
done
if [ $PII_HITS -gt 0 ]; then
  echo "${YELLOW}WARN:${NC} $PII_HITS possibili leak PII (non blocking, ma rivedi)" >&2
fi

echo ""
echo "${GREEN}=== Quality gate PASSED ===${NC}"
exit 0
