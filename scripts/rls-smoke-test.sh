#!/usr/bin/env bash
# FDFA-11 · RLS smoke test — household A JWT NON vede household B.
# Ref: ADR-0003 §3, framework/stack-playbooks/supabase/rls-smoke-tests.md

set -euo pipefail

: "${SUPABASE_URL:?SUPABASE_URL required (es. https://<ref>.supabase.co)}"
: "${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY required}"
: "${SUPABASE_JWT_A:?SUPABASE_JWT_A required (authenticated user di household A)}"
: "${SUPABASE_JWT_B:?SUPABASE_JWT_B required (authenticated user di household B)}"

TABLES=(
  households household_members accounts funds categories
  classes transactions budgets sinking_funds contribution_splits
)

pass=0
fail=0

check_anon_blocked() {
  local table="$1"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" \
    "$SUPABASE_URL/rest/v1/$table?select=*" \
    -H "apikey: $SUPABASE_ANON_KEY")
  # 401/403/404 = grant revocato; 200 con [] accettato solo se RLS + GRANT residuo.
  # Pattern canonico ADR-0003: anon NON deve leggere. Ci aspettiamo 401/403.
  if [[ "$code" == "401" || "$code" == "403" ]]; then
    echo "  OK  [anon]  $table → $code (denied)"
    pass=$((pass+1))
  else
    echo "  FAIL [anon] $table → $code (atteso 401/403)"
    fail=$((fail+1))
  fi
}

check_user_sees_own_only() {
  local table="$1" jwt_label="$2" jwt="$3" other_label="$4" other_household_id="$5"
  local body
  body=$(curl -s \
    "$SUPABASE_URL/rest/v1/$table?select=household_id" \
    -H "apikey: $SUPABASE_ANON_KEY" \
    -H "Authorization: Bearer $jwt")
  if echo "$body" | grep -q "\"$other_household_id\""; then
    echo "  FAIL [$jwt_label] $table: leak → ha visto household_id di $other_label"
    fail=$((fail+1))
  else
    local count
    count=$(echo "$body" | jq 'length' 2>/dev/null || echo "?")
    echo "  OK   [$jwt_label] $table: n=$count, zero leak da $other_label"
    pass=$((pass+1))
  fi
}

echo "=== anon deve essere bloccato (REVOKE ALL) ==="
for t in "${TABLES[@]}"; do
  check_anon_blocked "$t"
done

if [[ -n "${SUPABASE_HOUSEHOLD_A_ID:-}" && -n "${SUPABASE_HOUSEHOLD_B_ID:-}" ]]; then
  echo
  echo "=== user A non deve vedere dati di household B ==="
  for t in households accounts funds categories classes transactions budgets sinking_funds contribution_splits; do
    check_user_sees_own_only "$t" "userA" "$SUPABASE_JWT_A" "household B" "$SUPABASE_HOUSEHOLD_B_ID"
  done

  echo
  echo "=== user B non deve vedere dati di household A ==="
  for t in households accounts funds categories classes transactions budgets sinking_funds contribution_splits; do
    check_user_sees_own_only "$t" "userB" "$SUPABASE_JWT_B" "household A" "$SUPABASE_HOUSEHOLD_A_ID"
  done
else
  echo
  echo "[skip] SUPABASE_HOUSEHOLD_A_ID / SUPABASE_HOUSEHOLD_B_ID non impostati;"
  echo "       esegui seed (due household + un record per tabella) e ri-esporta gli ID."
fi

echo
echo "=== Riepilogo ==="
echo "PASS: $pass   FAIL: $fail"
if (( fail > 0 )); then
  exit 1
fi
