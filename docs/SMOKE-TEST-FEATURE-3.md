# Smoke Test — Feature 3: Categories CRUD

**Date:** TBD (run by backend-dev or lead at merge time)
**Agent:** backend-dev / lead
**Branch:** `feature/3-categories-crud`
**Environment:** local dev (`pnpm dev`, `http://localhost:3000`)
**Supabase project:** `tzsnmdmegpokbrbzqbra.supabase.co` (EU region)

---

## Bug Found and Fixed During This Smoke Test

_Placeholder — to be filled in by backend-dev if any issues arise during the smoke run. See Feature 2 runbook (`docs/SMOKE-TEST-FEATURE-2.md`) for the format._

---

## Quality Gates

| Gate | Result |
|---|---|
| `pnpm lint` | (fill at run time) |
| `pnpm typecheck` | (fill at run time) |
| `pnpm test --run` | (fill at run time) |
| `pnpm build` | (fill at run time) |

---

## 1. Prereqs

Before running this smoke test, two smoke users must exist with separate households. Each user must have at least one fund in their household (created via the `/api/funds` endpoint or directly via Supabase Studio).

| Smoke user | Cookie file | UUID | Fund UUID |
|---|---|---|---|
| User A | `/tmp/fdf-smoke-catA-cookies.txt` | `<UUID_USER_A>` | `<UUID_FUND_A>` |
| User B | `/tmp/fdf-smoke-catB-cookies.txt` | `<UUID_USER_B>` | `<UUID_FUND_B>` |

**Email format:** `smoke+cat-a-<timestamp>@example.com` / `smoke+cat-b-<timestamp>@example.com`

All UUIDs must be recorded in the table above before proceeding. No PII beyond email local-part in logs.

---

## 2. Auth and Session Setup

Log in both users and persist session cookies.

### 2a. Login as User A

```bash
curl -i -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"smoke+cat-a-<timestamp>@example.com","password":"SmokeTest!2026"}' \
  -c /tmp/fdf-smoke-catA-cookies.txt
```

Expected: `HTTP/1.1 200 OK`, `set-cookie: sb-*-auth-token=...`

### 2b. Login as User B

```bash
curl -i -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"smoke+cat-b-<timestamp>@example.com","password":"SmokeTest!2026"}' \
  -c /tmp/fdf-smoke-catB-cookies.txt
```

Expected: `HTTP/1.1 200 OK`, session cookie set.

---

## 3. GET /api/categories — unauthenticated

Verifies the endpoint requires a session before serving data.

```bash
curl -i "http://localhost:3000/api/categories?fund_id=<UUID_FUND_A>"
```

Expected:

```
HTTP/1.1 401 Unauthorized
{"error":"Unauthorized","code":"UNAUTHENTICATED"}
```

**Result:** ___

---

## 4. GET /api/categories — missing or invalid fund_id

```bash
# Missing fund_id
curl -s "http://localhost:3000/api/categories" \
  -b /tmp/fdf-smoke-catA-cookies.txt

# Non-UUID fund_id
curl -s "http://localhost:3000/api/categories?fund_id=not-a-uuid" \
  -b /tmp/fdf-smoke-catA-cookies.txt
```

Expected for both: `{"error":"...","code":"VALIDATION_ERROR"}` with HTTP 400.

**Result:** ___

---

## 5. POST /api/categories — create "Azioni" as User A

Creates the first category under User A's fund. Record the returned `id` as `UUID_CAT_A`.

```bash
curl -i -X POST http://localhost:3000/api/categories \
  -H "Content-Type: application/json" \
  -b /tmp/fdf-smoke-catA-cookies.txt \
  -d '{"fund_id":"<UUID_FUND_A>","name":"Azioni"}'
```

Expected:

```
HTTP/1.1 201 Created
{
  "id": "<UUID_CAT_A>",     ← record this
  "fund_id": "<UUID_FUND_A>",
  "name": "Azioni",
  "archived_at": null,
  "household_id": "<UUID_HH_A>",
  "sort_order": 0,
  "target_amount_cents": null,
  "current_amount_cents": 0,
  "created_at": "...",
  "updated_at": "..."
}
```

**Result:** ___

### 5a. POST validation — missing name

```bash
curl -s -X POST http://localhost:3000/api/categories \
  -H "Content-Type: application/json" \
  -b /tmp/fdf-smoke-catA-cookies.txt \
  -d '{"fund_id":"<UUID_FUND_A>"}'
```

Expected: HTTP 400, `code: "VALIDATION_ERROR"`.

**Result:** ___

### 5b. POST validation — whitespace-only name

```bash
curl -s -X POST http://localhost:3000/api/categories \
  -H "Content-Type: application/json" \
  -b /tmp/fdf-smoke-catA-cookies.txt \
  -d '{"fund_id":"<UUID_FUND_A>","name":"   "}'
```

Expected: HTTP 400, `code: "VALIDATION_ERROR"`.

**Result:** ___

### 5c. POST — fund not found (cross-household fund_id)

```bash
curl -s -X POST http://localhost:3000/api/categories \
  -H "Content-Type: application/json" \
  -b /tmp/fdf-smoke-catA-cookies.txt \
  -d '{"fund_id":"<UUID_FUND_B>","name":"Azioni"}'
```

Expected: HTTP 404, `code: "FUND_NOT_FOUND"`. (RLS on `funds` hides User B's fund from User A.)

**Result:** ___

---

## 6. GET /api/categories — active only (default)

Verifies "Azioni" is returned and that the default filter excludes archived rows.

```bash
curl -s "http://localhost:3000/api/categories?fund_id=<UUID_FUND_A>" \
  -b /tmp/fdf-smoke-catA-cookies.txt
```

Expected: HTTP 200, array containing `{"name":"Azioni","archived_at":null,...}`.

**Result:** ___

---

## 7. PUT /api/categories/:id — rename

Renames "Azioni" to "Azioni IT".

```bash
curl -i -X PUT http://localhost:3000/api/categories/<UUID_CAT_A> \
  -H "Content-Type: application/json" \
  -b /tmp/fdf-smoke-catA-cookies.txt \
  -d '{"name":"Azioni IT"}'
```

Expected: HTTP 200, body contains `"name":"Azioni IT"`.

**Result:** ___

### 7a. PUT — duplicate name conflict

Create a second category "Obbligazioni", then try to rename "Azioni IT" to "Obbligazioni".

```bash
# Create second category
curl -s -X POST http://localhost:3000/api/categories \
  -H "Content-Type: application/json" \
  -b /tmp/fdf-smoke-catA-cookies.txt \
  -d '{"fund_id":"<UUID_FUND_A>","name":"Obbligazioni"}'

# Attempt duplicate rename
curl -s -X PUT http://localhost:3000/api/categories/<UUID_CAT_A> \
  -H "Content-Type: application/json" \
  -b /tmp/fdf-smoke-catA-cookies.txt \
  -d '{"name":"Obbligazioni"}'
```

Expected for the rename: HTTP 409, `code: "CONFLICT"`.

**Result:** ___

### 7b. PUT — empty body rejected

```bash
curl -s -X PUT http://localhost:3000/api/categories/<UUID_CAT_A> \
  -H "Content-Type: application/json" \
  -b /tmp/fdf-smoke-catA-cookies.txt \
  -d '{}'
```

Expected: HTTP 400, `code: "VALIDATION_ERROR"` (at least one field required).

**Result:** ___

### 7c. PUT — reparent to another fund within same household

If User A has a second fund (`UUID_FUND_A2`), verify reparenting works.

```bash
curl -i -X PUT http://localhost:3000/api/categories/<UUID_CAT_A> \
  -H "Content-Type: application/json" \
  -b /tmp/fdf-smoke-catA-cookies.txt \
  -d '{"fund_id":"<UUID_FUND_A2>"}'
```

Expected: HTTP 200, body contains `"fund_id":"<UUID_FUND_A2>"`.

_Skip this step if User A has only one fund — mark as SKIP._

**Result:** ___

---

## 8. DELETE /api/categories/:id — soft delete

Soft-deletes "Azioni IT" (UUID_CAT_A). Verifies `archived_at` is set and 204 is returned.

```bash
curl -i -X DELETE http://localhost:3000/api/categories/<UUID_CAT_A> \
  -b /tmp/fdf-smoke-catA-cookies.txt
```

Expected:

```
HTTP/1.1 204 No Content
(no body)
```

**Result:** ___

### 8a. Verify soft delete: GET excludes archived row by default

```bash
curl -s "http://localhost:3000/api/categories?fund_id=<UUID_FUND_A>" \
  -b /tmp/fdf-smoke-catA-cookies.txt
```

Expected: "Azioni IT" is absent from the array (only "Obbligazioni" appears).

**Result:** ___

### 8b. GET with ?include_archived=true shows the archived row

```bash
curl -s "http://localhost:3000/api/categories?fund_id=<UUID_FUND_A>&include_archived=true" \
  -b /tmp/fdf-smoke-catA-cookies.txt
```

Expected: array contains "Azioni IT" with `"archived_at": "<non-null ISO timestamp>"`.

**Result:** ___

### 8c. Re-DELETE already-archived row is idempotent (204)

```bash
curl -i -X DELETE http://localhost:3000/api/categories/<UUID_CAT_A> \
  -b /tmp/fdf-smoke-catA-cookies.txt
```

Expected: `HTTP/1.1 204 No Content` — same as first delete, no error.

**Result:** ___

---

## 9. DELETE — row not found

```bash
curl -s -X DELETE "http://localhost:3000/api/categories/00000000-1111-4222-a333-444444444444" \
  -b /tmp/fdf-smoke-catA-cookies.txt
```

Expected: HTTP 404, `code: "NOT_FOUND"`.

**Result:** ___

---

## 10. RLS Isolation — User B cannot access User A's data

This section verifies that `categories_select_member`, `categories_update_member`, and `categories_delete_member` RLS policies isolate households correctly. All four operations are tested using User B's session against User A's category (`UUID_CAT_A` — still accessible because `archived_at` is set but the row exists; for UPDATE/DELETE isolation, use "Obbligazioni" which is active).

Record the UUID of "Obbligazioni" (created in step 7a) as `UUID_CAT_OBBL`.

### 10a. User B cannot read User A's categories (GET)

```bash
curl -s "http://localhost:3000/api/categories?fund_id=<UUID_FUND_A>" \
  -b /tmp/fdf-smoke-catB-cookies.txt
```

Expected: HTTP 200 with `[]` (empty array — RLS filters by `household_id`; User A's fund is in a different household so RLS on `funds` also hides it, making the query return nothing).

**Result:** ___

### 10b. User B cannot update User A's category (PUT)

```bash
curl -s -X PUT http://localhost:3000/api/categories/<UUID_CAT_OBBL> \
  -H "Content-Type: application/json" \
  -b /tmp/fdf-smoke-catB-cookies.txt \
  -d '{"name":"Hacked"}'
```

Expected: HTTP 404, `code: "NOT_FOUND"` (RLS USING clause hides the row; update affects 0 rows; handler returns 404).

**Result:** ___

### 10c. User B cannot soft-delete User A's category (DELETE)

```bash
curl -s -X DELETE http://localhost:3000/api/categories/<UUID_CAT_OBBL> \
  -b /tmp/fdf-smoke-catB-cookies.txt
```

Expected: HTTP 404, `code: "NOT_FOUND"` (same RLS isolation — archive UPDATE and probe SELECT both return nothing for User B).

**Result:** ___

### 10d. SQL verification (optional — via Supabase Studio or psql)

Run with User B's JWT set as the RLS context:

```sql
-- Set User B's identity (simulates RLS evaluation)
SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"<UUID_USER_B>"}';

-- Attempt to read User A's category directly
SELECT * FROM public.categories WHERE id = '<UUID_CAT_OBBL>';
-- Expected: 0 rows

-- Attempt to update
UPDATE public.categories SET name = 'Hacked' WHERE id = '<UUID_CAT_OBBL>';
-- Expected: UPDATE 0

-- Attempt to delete
DELETE FROM public.categories WHERE id = '<UUID_CAT_OBBL>';
-- Expected: DELETE 0
```

**Result:** ___

---

## 11. Smoke User Cleanup

Delete both smoke users, their households, household members, funds, and any remaining categories via Supabase admin API or Studio. Verify zero remaining rows matching the smoke test email patterns.

```bash
# Via Supabase admin API — delete auth users by UUID
# (leads or backend-dev run this — requires service role or dashboard access)

# Verify no smoke users remain
# In Supabase Studio: Authentication > Users > filter by "smoke+cat"
# In SQL: SELECT email FROM auth.users WHERE email LIKE 'smoke+cat-%';
# Expected: 0 rows
```

**Cleanup completed by:** ___
**Timestamp:** ___

---

## Summary

| Step | Status |
|---|---|
| pnpm lint / typecheck / test / build | |
| GET /api/categories — no session → 401 | |
| GET /api/categories — missing fund_id → 400 | |
| GET /api/categories — invalid UUID fund_id → 400 | |
| POST /api/categories — happy path → 201 | |
| POST /api/categories — missing name → 400 | |
| POST /api/categories — whitespace name → 400 | |
| POST /api/categories — cross-household fund_id → 404 FUND_NOT_FOUND | |
| GET /api/categories — active only → 200 (archived excluded) | |
| PUT /api/categories/:id — rename → 200 | |
| PUT /api/categories/:id — duplicate → 409 CONFLICT | |
| PUT /api/categories/:id — empty body → 400 | |
| PUT /api/categories/:id — reparent same household → 200 | |
| DELETE /api/categories/:id — soft delete → 204 | |
| GET after delete — archived row excluded | |
| GET ?include_archived=true — archived row included | |
| Re-DELETE archived row — idempotent 204 | |
| DELETE non-existent id → 404 | |
| RLS: User B GET User A's categories → 200 [] | |
| RLS: User B PUT User A's category → 404 | |
| RLS: User B DELETE User A's category → 404 | |
| Smoke user cleanup | |
