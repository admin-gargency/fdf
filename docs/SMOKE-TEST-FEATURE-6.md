# Smoke Test — Feature 6: Transactions CRUD

**Date:** 2026-05-05
**Branch:** `feature/6-transactions-crud`
**Environment:** local dev (`pnpm dev`, `http://localhost:3000`)
**Supabase project:** `tzsnmdmegpokbrbzqbra.supabase.co` (EU region)

---

## Bug Found and Fixed During This Smoke Test

_Placeholder — to be filled in by backend-dev / frontend-dev if any issue surfaces during the run. Format: see `docs/SMOKE-TEST-FEATURE-2.md` §"Bug Found and Fixed"._

---

## Quality Gates

| Gate | Result |
|---|---|
| `pnpm lint` | PASS — no warnings |
| `pnpm tsc --noEmit` | PASS — 0 errors (test-engineer fixed the F4 leftover) |
| `pnpm test --run` | PASS — 377 passed, 1 skipped (pre-existing). F6 contributes 51 domain + 75 API tests |
| `pnpm build` | PASS — `/transactions`, `/transactions/new`, `/api/accounts`, `/api/transactions`, `/api/transactions/[id]` all in build output |
| `security-reviewer` audit | PASS-with-observations — one MEDIUM (Zod `.strict()`) applied; LOW debt items #2-#6 tracked for future passes |

---

## 1. Prereqs

Two smoke users must exist. F6 boostraps the first account inline, so **no account seeding is required up front** — User A starts with zero accounts and we exercise the bootstrap path. User B starts the same way.

| Smoke user | Cookie file | UUID |
|---|---|---|
| User A | `/tmp/fdf-smoke-txA-cookies.txt` | `<UUID_USER_A>` |
| User B | `/tmp/fdf-smoke-txB-cookies.txt` | `<UUID_USER_B>` |

**Email format:** `smoke-tx-a-2026-05-05@example.test` / `smoke-tx-b-2026-05-05@example.test`
**Password:** `SmokeTest!2026`

User A also needs a Class to assign transactions to. Reuse the F4 smoke setup (`Affitto` under `Categoria A`) or create one quickly via `/api/classes` before starting.

| Resource | UUID |
|---|---|
| User A household | `<UUID_HH_A>` |
| User A class for transactions | `<UUID_CLS_A>` |
| User B household | `<UUID_HH_B>` |

No PII beyond the email local-part may appear in logs.

---

## 2. Auth setup

### 2a. Sign up User A and User B (or login if already created)

```bash
curl -i -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"smoke-tx-a-2026-05-05@example.test","password":"SmokeTest!2026"}' \
  -c /tmp/fdf-smoke-txA-cookies.txt
```

Expected: `HTTP/1.1 200 OK`, `set-cookie: sb-*-auth-token=...`. Same for User B with the appropriate email and cookie file.

**Result A:** ___
**Result B:** ___

---

## 3. GET /api/accounts — unauthenticated

```bash
curl -i http://localhost:3000/api/accounts
```

Expected: `HTTP/1.1 401 Unauthorized`, `{"error":"Unauthorized","code":"UNAUTHENTICATED"}`.

**Result:** ___

---

## 4. GET /api/accounts — empty for fresh user

```bash
curl -s http://localhost:3000/api/accounts -b /tmp/fdf-smoke-txA-cookies.txt
```

Expected: `[]` (empty array). HTTP 200.

**Result:** ___

---

## 5. POST /api/accounts — bootstrap first account

### 5a. Happy path

```bash
curl -i -X POST http://localhost:3000/api/accounts \
  -H "Content-Type: application/json" \
  -b /tmp/fdf-smoke-txA-cookies.txt \
  -d '{"name":"Conto Principale","kind":"corrente"}'
```

Expected: `HTTP/1.1 201 Created`, body contains `{"id":"<UUID_ACC_A>","household_id":"<UUID_HH_A>","name":"Conto Principale","kind":"corrente",...}`. Record `<UUID_ACC_A>`.

**Result:** ___

### 5b. POST validation — missing name

```bash
curl -s -X POST http://localhost:3000/api/accounts \
  -H "Content-Type: application/json" \
  -b /tmp/fdf-smoke-txA-cookies.txt \
  -d '{"kind":"corrente"}'
```

Expected: HTTP 400, `code: "VALIDATION_ERROR"`.

**Result:** ___

### 5c. POST validation — invalid kind

```bash
curl -s -X POST http://localhost:3000/api/accounts \
  -H "Content-Type: application/json" \
  -b /tmp/fdf-smoke-txA-cookies.txt \
  -d '{"name":"Test","kind":"investimento"}'
```

Expected: HTTP 400, `code: "VALIDATION_ERROR"`.

**Result:** ___

### 5d. Duplicate account name (UNIQUE violation)

```bash
curl -s -X POST http://localhost:3000/api/accounts \
  -H "Content-Type: application/json" \
  -b /tmp/fdf-smoke-txA-cookies.txt \
  -d '{"name":"Conto Principale","kind":"fondi"}'
```

Expected: HTTP 409, `code: "CONFLICT"`.

**Result:** ___

---

## 6. POST /api/transactions — happy path

### 6a. Outflow with class assigned

```bash
curl -i -X POST http://localhost:3000/api/transactions \
  -H "Content-Type: application/json" \
  -b /tmp/fdf-smoke-txA-cookies.txt \
  -d '{
    "account_id":"<UUID_ACC_A>",
    "class_id":"<UUID_CLS_A>",
    "booked_at":"2026-04-15",
    "amount_cents":-12500,
    "description":"Spesa supermercato"
  }'
```

Expected: `HTTP/1.1 201 Created`. Record the returned `id` as `<UUID_TX_1>`. Body **must NOT** contain `raw_description`, `external_id`, or `created_by` (PII columns excluded from grants).

**Result:** ___

### 6b. Inflow without class

```bash
curl -i -X POST http://localhost:3000/api/transactions \
  -H "Content-Type: application/json" \
  -b /tmp/fdf-smoke-txA-cookies.txt \
  -d '{
    "account_id":"<UUID_ACC_A>",
    "booked_at":"2026-04-20",
    "amount_cents":300000,
    "description":"Stipendio"
  }'
```

Expected: HTTP 201. `class_id` in response should be `null`. `source` should be `"manual"`. Record id as `<UUID_TX_2>`.

**Result:** ___

### 6c. Different month (for monthly aggregation)

```bash
curl -i -X POST http://localhost:3000/api/transactions \
  -H "Content-Type: application/json" \
  -b /tmp/fdf-smoke-txA-cookies.txt \
  -d '{
    "account_id":"<UUID_ACC_A>",
    "class_id":"<UUID_CLS_A>",
    "booked_at":"2026-03-10",
    "amount_cents":-5000,
    "description":"Caffè"
  }'
```

Expected: HTTP 201. Record id as `<UUID_TX_3>`.

**Result:** ___

### 6d. Validation — amount_cents = 0

```bash
curl -s -X POST http://localhost:3000/api/transactions \
  -H "Content-Type: application/json" \
  -b /tmp/fdf-smoke-txA-cookies.txt \
  -d '{"account_id":"<UUID_ACC_A>","booked_at":"2026-04-15","amount_cents":0}'
```

Expected: HTTP 400, `code: "VALIDATION_ERROR"`.

**Result:** ___

### 6e. Validation — booked_at too far in future

```bash
curl -s -X POST http://localhost:3000/api/transactions \
  -H "Content-Type: application/json" \
  -b /tmp/fdf-smoke-txA-cookies.txt \
  -d '{"account_id":"<UUID_ACC_A>","booked_at":"2027-01-01","amount_cents":-100}'
```

Expected: HTTP 400, `code: "VALIDATION_ERROR"`.

**Result:** ___

### 6f. Cross-household account_id (User B's account)

```bash
# First, log in User B and create an account for them, then return to User A's session.
# This step assumes User B has bootstrapped Conto B with id <UUID_ACC_B>.

curl -s -X POST http://localhost:3000/api/transactions \
  -H "Content-Type: application/json" \
  -b /tmp/fdf-smoke-txA-cookies.txt \
  -d '{"account_id":"<UUID_ACC_B>","booked_at":"2026-04-15","amount_cents":-100}'
```

Expected: HTTP 404, `code: "ACCOUNT_NOT_FOUND"` (RLS hides cross-household account → treated as not found).

**Result:** ___

### 6g. Cross-household class_id (own account, User B's class)

```bash
curl -s -X POST http://localhost:3000/api/transactions \
  -H "Content-Type: application/json" \
  -b /tmp/fdf-smoke-txA-cookies.txt \
  -d '{
    "account_id":"<UUID_ACC_A>",
    "class_id":"<UUID_CLS_B>",
    "booked_at":"2026-04-15",
    "amount_cents":-100
  }'
```

Expected: HTTP 403, `code: "CROSS_HOUSEHOLD"`.

**Result:** ___

### 6h. Source override attempt (should be ignored)

```bash
curl -s -X POST http://localhost:3000/api/transactions \
  -H "Content-Type: application/json" \
  -b /tmp/fdf-smoke-txA-cookies.txt \
  -d '{
    "account_id":"<UUID_ACC_A>",
    "booked_at":"2026-04-15",
    "amount_cents":-100,
    "source":"psd2"
  }'
```

Expected: HTTP 201 with `"source":"manual"` in the response (server hardcodes `source`, never trusts the body).

**Result:** ___

---

## 7. GET /api/transactions — list and filter

### 7a. List all (RLS scopes to User A's household)

```bash
curl -s "http://localhost:3000/api/transactions" \
  -b /tmp/fdf-smoke-txA-cookies.txt
```

Expected: at least 3 rows (`<UUID_TX_1>`, `<UUID_TX_2>`, `<UUID_TX_3>`), sorted by `booked_at` DESC. None of User B's rows.

**Result:** ___

### 7b. Filter by month

```bash
curl -s "http://localhost:3000/api/transactions?month=2026-04" \
  -b /tmp/fdf-smoke-txA-cookies.txt
```

Expected: only `<UUID_TX_1>` and `<UUID_TX_2>` (March row excluded).

**Result:** ___

### 7c. Filter by class

```bash
curl -s "http://localhost:3000/api/transactions?class_id=<UUID_CLS_A>" \
  -b /tmp/fdf-smoke-txA-cookies.txt
```

Expected: only the rows assigned to that class (`<UUID_TX_1>`, `<UUID_TX_3>`).

**Result:** ___

### 7d. Invalid month format

```bash
curl -s "http://localhost:3000/api/transactions?month=2026-4" \
  -b /tmp/fdf-smoke-txA-cookies.txt
```

Expected: HTTP 400, `code: "VALIDATION_ERROR"`.

**Result:** ___

---

## 8. PUT /api/transactions/:id — narrow scope

### 8a. Update class_id

```bash
curl -i -X PUT "http://localhost:3000/api/transactions/<UUID_TX_2>" \
  -H "Content-Type: application/json" \
  -b /tmp/fdf-smoke-txA-cookies.txt \
  -d '{"class_id":"<UUID_CLS_A>"}'
```

Expected: HTTP 200, `class_id` in response equals `<UUID_CLS_A>`.

**Result:** ___

### 8b. Update description and needs_review

```bash
curl -i -X PUT "http://localhost:3000/api/transactions/<UUID_TX_1>" \
  -H "Content-Type: application/json" \
  -b /tmp/fdf-smoke-txA-cookies.txt \
  -d '{"description":"Spesa supermercato (corretto)","needs_review":true}'
```

Expected: HTTP 200, both fields updated. `amount_cents` and `booked_at` unchanged.

**Result:** ___

### 8c. Attempt to update amount_cents — must fail at validation OR DB grant level

```bash
curl -s -X PUT "http://localhost:3000/api/transactions/<UUID_TX_1>" \
  -H "Content-Type: application/json" \
  -b /tmp/fdf-smoke-txA-cookies.txt \
  -d '{"amount_cents":-99999}'
```

Expected: either HTTP 400 (`VALIDATION_ERROR` — server rejects unknown field) OR HTTP 500 with no actual change to the amount. Re-fetch to confirm the row still has the original `amount_cents`.

**Result:** ___

### 8d. PUT — cross-household class_id

```bash
curl -s -X PUT "http://localhost:3000/api/transactions/<UUID_TX_1>" \
  -H "Content-Type: application/json" \
  -b /tmp/fdf-smoke-txA-cookies.txt \
  -d '{"class_id":"<UUID_CLS_B>"}'
```

Expected: HTTP 403, `code: "CROSS_HOUSEHOLD"`.

**Result:** ___

### 8e. PUT — un-assign class (set null)

```bash
curl -i -X PUT "http://localhost:3000/api/transactions/<UUID_TX_2>" \
  -H "Content-Type: application/json" \
  -b /tmp/fdf-smoke-txA-cookies.txt \
  -d '{"class_id":null}'
```

Expected: HTTP 200, `class_id` is `null`.

**Result:** ___

---

## 9. DELETE /api/transactions/:id — hard delete

### 9a. Delete an existing row

```bash
curl -i -X DELETE "http://localhost:3000/api/transactions/<UUID_TX_3>" \
  -b /tmp/fdf-smoke-txA-cookies.txt
```

Expected: HTTP 204, empty body.

**Result:** ___

### 9b. Re-fetch confirms hard delete (no `archived_at` resurrection)

```bash
curl -s "http://localhost:3000/api/transactions" \
  -b /tmp/fdf-smoke-txA-cookies.txt | jq '.[].id'
```

Expected: `<UUID_TX_3>` is **not** in the list (hard delete; no archived row stuck around).

**Result:** ___

### 9c. DELETE on non-existent / cross-household id

```bash
curl -i -X DELETE "http://localhost:3000/api/transactions/00000000-0000-0000-0000-000000000000" \
  -b /tmp/fdf-smoke-txA-cookies.txt
```

Expected: HTTP 404, `code: "NOT_FOUND"`.

**Result:** ___

---

## 10. Cross-household isolation (User B reads User A's data)

```bash
curl -s "http://localhost:3000/api/transactions" \
  -b /tmp/fdf-smoke-txB-cookies.txt
```

Expected: User B's rows only (or empty if User B has none). User A's `<UUID_TX_1>` / `<UUID_TX_2>` must NOT appear.

**Result:** ___

---

## 11. UI smoke

1. Open `http://localhost:3000/transactions/new` as User A in a private window.
2. If User A has zero accounts, expect the inline "create first account" mini-form (name + kind radio). Fill it and submit. Page should reload with the transaction form.
3. Create 3 transactions across two different months; assign one of them to a class.
4. Visit `/transactions`. Verify:
   - Rows sorted by `booked_at` DESC, grouped by date.
   - Outflow rows in default zinc colour, inflow rows in emerald.
   - "Riepilogo mensile" panel above the list shows correct inflow / outflow / net per month and a row count matching the visible items.
   - Bank fields (`bank`, `account_last4`) never appear anywhere in the UI (brand-neutral copy rule).
5. Click the inline class-select on a row, choose a different class. Confirm the row updates after `router.refresh()` and the monthly totals stay consistent (amount unchanged).
6. Click "Elimina" on a row, confirm the modal, and verify the row vanishes after refresh.
7. Apply the month filter (`?month=YYYY-MM`); verify both the list and the aggregation panel recompute against the filter.
8. Sign out and sign in as User B. Visit `/transactions`. Verify zero of User A's rows appear (RLS isolation).

**Result:** ___

---

## 12. PII / log audit (run after the smoke completes)

In another terminal, while running the above, capture the dev server output and grep:

```bash
pnpm dev 2>&1 | tee /tmp/fdf-f6-smoke.log
# After running steps 3-11:
grep -Ei 'smoke-tx-(a|b)|@example\.test|amount_cents|description|raw_description|external_id|account_last4' /tmp/fdf-f6-smoke.log
```

Expected: zero matches. Logs may contain UUIDs and PG error codes only.

**Result:** ___
