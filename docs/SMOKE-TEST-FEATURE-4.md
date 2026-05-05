# Smoke Test — Feature 4: Classes CRUD

**Date:** 2026-05-05
**Agent:** backend-dev / lead
**Branch:** `feature/4-classes-crud`
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

Before running this smoke test, two smoke users must exist with separate households. Each user must have:
- At least one fund in their household (via `/api/funds`)
- At least one category per fund (via `/api/categories`)

| Smoke user | Cookie file | UUID | Fund UUID | Category UUID |
|---|---|---|---|---|
| User A | `/tmp/fdf-smoke-clsA-cookies.txt` | `<UUID_USER_A>` | `<UUID_FUND_A>` | `<UUID_CAT_A>` |
| User B | `/tmp/fdf-smoke-clsB-cookies.txt` | `<UUID_USER_B>` | `<UUID_FUND_B>` | `<UUID_CAT_B>` |

**Email format:** `smoke-cls-a-2026-05-05@example.test` / `smoke-cls-b-2026-05-05@example.test`

All UUIDs must be recorded in the table above before proceeding. No PII beyond email local-part in logs.

---

## 2. Auth and Session Setup

Log in both users and persist session cookies.

### 2a. Login as User A

```bash
curl -i -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"smoke-cls-a-2026-05-05@example.test","password":"SmokeTest!2026"}' \
  -c /tmp/fdf-smoke-clsA-cookies.txt
```

Expected: `HTTP/1.1 200 OK`, `set-cookie: sb-*-auth-token=...`

### 2b. Login as User B

```bash
curl -i -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"smoke-cls-b-2026-05-05@example.test","password":"SmokeTest!2026"}' \
  -c /tmp/fdf-smoke-clsB-cookies.txt
```

Expected: `HTTP/1.1 200 OK`, session cookie set.

---

## 3. GET /api/classes — unauthenticated

Verifies the endpoint requires a session before serving data.

```bash
curl -i "http://localhost:3000/api/classes?category_id=<UUID_CAT_A>"
```

Expected:

```
HTTP/1.1 401 Unauthorized
{"error":"Unauthorized","code":"UNAUTHENTICATED"}
```

**Result:** ___

---

## 4. GET /api/classes — missing or invalid category_id

```bash
# Missing category_id
curl -s "http://localhost:3000/api/classes" \
  -b /tmp/fdf-smoke-clsA-cookies.txt

# Non-UUID category_id
curl -s "http://localhost:3000/api/classes?category_id=not-a-uuid" \
  -b /tmp/fdf-smoke-clsA-cookies.txt
```

Expected for both: `{"error":"...","code":"VALIDATION_ERROR"}` with HTTP 400.

**Result:** ___

---

## 5. POST /api/classes — create one class per tipologia

Creates three classes under User A's category. Record the returned `id` values.

### 5a. tipologia: addebito_immediato

```bash
curl -i -X POST http://localhost:3000/api/classes \
  -H "Content-Type: application/json" \
  -b /tmp/fdf-smoke-clsA-cookies.txt \
  -d '{"category_id":"<UUID_CAT_A>","name":"Affitto","tipologia":"addebito_immediato"}'
```

Expected:

```
HTTP/1.1 201 Created
{
  "id": "<UUID_CLS_AFFITTO>",     <- record this
  "category_id": "<UUID_CAT_A>",
  "household_id": "<UUID_HH_A>",
  "name": "Affitto",
  "tipologia": "addebito_immediato",
  "sort_order": 0,
  "archived_at": null,
  "created_at": "...",
  "updated_at": "..."
}
```

Note: ClassRow does NOT include `target_amount_cents` or `current_amount_cents` (ADR-0006 Decision 1).

**Result:** ___

### 5b. tipologia: fondo_breve

```bash
curl -i -X POST http://localhost:3000/api/classes \
  -H "Content-Type: application/json" \
  -b /tmp/fdf-smoke-clsA-cookies.txt \
  -d '{"category_id":"<UUID_CAT_A>","name":"Vacanze","tipologia":"fondo_breve"}'
```

Expected: HTTP 201, `"tipologia":"fondo_breve"`.

**Result:** ___

### 5c. tipologia: fondo_lungo

```bash
curl -i -X POST http://localhost:3000/api/classes \
  -H "Content-Type: application/json" \
  -b /tmp/fdf-smoke-clsA-cookies.txt \
  -d '{"category_id":"<UUID_CAT_A>","name":"Mutuo","tipologia":"fondo_lungo"}'
```

Expected: HTTP 201, `"tipologia":"fondo_lungo"`.

**Result:** ___

### 5d. POST validation — missing name

```bash
curl -s -X POST http://localhost:3000/api/classes \
  -H "Content-Type: application/json" \
  -b /tmp/fdf-smoke-clsA-cookies.txt \
  -d '{"category_id":"<UUID_CAT_A>","tipologia":"addebito_immediato"}'
```

Expected: HTTP 400, `code: "VALIDATION_ERROR"`.

**Result:** ___

### 5e. POST validation — whitespace-only name

```bash
curl -s -X POST http://localhost:3000/api/classes \
  -H "Content-Type: application/json" \
  -b /tmp/fdf-smoke-clsA-cookies.txt \
  -d '{"category_id":"<UUID_CAT_A>","name":"   ","tipologia":"addebito_immediato"}'
```

Expected: HTTP 400, `code: "VALIDATION_ERROR"`.

**Result:** ___

### 5f. POST validation — missing tipologia

```bash
curl -s -X POST http://localhost:3000/api/classes \
  -H "Content-Type: application/json" \
  -b /tmp/fdf-smoke-clsA-cookies.txt \
  -d '{"category_id":"<UUID_CAT_A>","name":"Test"}'
```

Expected: HTTP 400, `code: "VALIDATION_ERROR"`.

**Result:** ___

### 5g. POST validation — invalid tipologia

```bash
curl -s -X POST http://localhost:3000/api/classes \
  -H "Content-Type: application/json" \
  -b /tmp/fdf-smoke-clsA-cookies.txt \
  -d '{"category_id":"<UUID_CAT_A>","name":"Test","tipologia":"risparmio_programmato"}'
```

Expected: HTTP 400, `code: "VALIDATION_ERROR"`. (`risparmio_programmato` is not a valid tipologia.)

**Result:** ___

### 5h. POST — cross-household category_id

```bash
curl -s -X POST http://localhost:3000/api/classes \
  -H "Content-Type: application/json" \
  -b /tmp/fdf-smoke-clsA-cookies.txt \
  -d '{"category_id":"<UUID_CAT_B>","name":"Affitto","tipologia":"addebito_immediato"}'
```

Expected: HTTP 404, `code: "CATEGORY_NOT_FOUND"`. (RLS on `categories` hides User B's category from User A.)

**Result:** ___

---

## 6. GET /api/classes — active only (default), verify ordering

Verifies all three classes are returned with `archived_at: null`, ordered by `sort_order` then `created_at`.

```bash
curl -s "http://localhost:3000/api/classes?category_id=<UUID_CAT_A>" \
  -b /tmp/fdf-smoke-clsA-cookies.txt
```

Expected: HTTP 200, array of 3 items, all with `"archived_at":null`. No archived rows present.

**Result:** ___

---

## 7. PUT /api/classes/:id

### 7a. Rename a class

```bash
curl -i -X PUT http://localhost:3000/api/classes/<UUID_CLS_AFFITTO> \
  -H "Content-Type: application/json" \
  -b /tmp/fdf-smoke-clsA-cookies.txt \
  -d '{"name":"Affitto Casa"}'
```

Expected: HTTP 200, body contains `"name":"Affitto Casa"`.

**Result:** ___

### 7b. Change tipologia only

```bash
curl -i -X PUT http://localhost:3000/api/classes/<UUID_CLS_AFFITTO> \
  -H "Content-Type: application/json" \
  -b /tmp/fdf-smoke-clsA-cookies.txt \
  -d '{"tipologia":"fondo_lungo"}'
```

Expected: HTTP 200, body contains `"tipologia":"fondo_lungo"`.

**Result:** ___

### 7c. Reparent to another category within same household

If User A has a second category (`UUID_CAT_A2`), verify reparenting works.

```bash
curl -i -X PUT http://localhost:3000/api/classes/<UUID_CLS_AFFITTO> \
  -H "Content-Type: application/json" \
  -b /tmp/fdf-smoke-clsA-cookies.txt \
  -d '{"category_id":"<UUID_CAT_A2>"}'
```

Expected: HTTP 200, body contains `"category_id":"<UUID_CAT_A2>"`.

_Skip this step if User A has only one category — mark as SKIP._

**Result:** ___

### 7d. Reparent to category in another household

```bash
curl -s -X PUT http://localhost:3000/api/classes/<UUID_CLS_AFFITTO> \
  -H "Content-Type: application/json" \
  -b /tmp/fdf-smoke-clsA-cookies.txt \
  -d '{"category_id":"<UUID_CAT_B>"}'
```

Expected: HTTP 404, `code: "CATEGORY_NOT_FOUND"`. (RLS hides User B's category.)

**Result:** ___

### 7e. Duplicate name within same category → 409

Create a name collision:

```bash
curl -s -X PUT http://localhost:3000/api/classes/<UUID_CLS_AFFITTO> \
  -H "Content-Type: application/json" \
  -b /tmp/fdf-smoke-clsA-cookies.txt \
  -d '{"name":"Vacanze"}'
```

Expected: HTTP 409, `code: "CONFLICT"` (UNIQUE(category_id, name) violated).

**Result:** ___

### 7f. Empty body rejected

```bash
curl -s -X PUT http://localhost:3000/api/classes/<UUID_CLS_AFFITTO> \
  -H "Content-Type: application/json" \
  -b /tmp/fdf-smoke-clsA-cookies.txt \
  -d '{}'
```

Expected: HTTP 400, `code: "VALIDATION_ERROR"` (at least one field required).

**Result:** ___

### 7g. Invalid tipologia rejected

```bash
curl -s -X PUT http://localhost:3000/api/classes/<UUID_CLS_AFFITTO> \
  -H "Content-Type: application/json" \
  -b /tmp/fdf-smoke-clsA-cookies.txt \
  -d '{"tipologia":"risparmio_programmato"}'
```

Expected: HTTP 400, `code: "VALIDATION_ERROR"`.

**Result:** ___

---

## 8. DELETE /api/classes/:id — soft delete

Soft-deletes "Affitto Casa". Verifies `archived_at` is set and 204 is returned.

```bash
curl -i -X DELETE http://localhost:3000/api/classes/<UUID_CLS_AFFITTO> \
  -b /tmp/fdf-smoke-clsA-cookies.txt
```

Expected:

```
HTTP/1.1 204 No Content
(no body)
```

**Result:** ___

### 8a. Verify soft delete: GET excludes archived row by default

```bash
curl -s "http://localhost:3000/api/classes?category_id=<UUID_CAT_A>" \
  -b /tmp/fdf-smoke-clsA-cookies.txt
```

Expected: "Affitto Casa" is absent from the array (only "Vacanze" and "Mutuo" appear).

**Result:** ___

### 8b. GET with ?include_archived=true shows the archived row

```bash
curl -s "http://localhost:3000/api/classes?category_id=<UUID_CAT_A>&include_archived=true" \
  -b /tmp/fdf-smoke-clsA-cookies.txt
```

Expected: array contains "Affitto Casa" with `"archived_at": "<non-null ISO timestamp>"`.

**Result:** ___

### 8c. Re-DELETE already-archived row is idempotent (204)

```bash
curl -i -X DELETE http://localhost:3000/api/classes/<UUID_CLS_AFFITTO> \
  -b /tmp/fdf-smoke-clsA-cookies.txt
```

Expected: `HTTP/1.1 204 No Content` — same as first delete, no error.

**Result:** ___

### 8d. DELETE non-existent UUID → 404

```bash
curl -s -X DELETE "http://localhost:3000/api/classes/00000000-1111-4222-a333-444444444444" \
  -b /tmp/fdf-smoke-clsA-cookies.txt
```

Expected: HTTP 404, `code: "NOT_FOUND"`.

**Result:** ___

---

## 9. RLS Isolation — User B vs User A

This section verifies that `classes_select_member`, `classes_update_member`, and `classes_delete_member` RLS policies isolate households correctly. Use User B's session against User A's classes.

Record the UUID of "Vacanze" (still active after step 8) as `UUID_CLS_VACANZE`.

### 9a. User B cannot read User A's classes (GET)

```bash
curl -s "http://localhost:3000/api/classes?category_id=<UUID_CAT_A>" \
  -b /tmp/fdf-smoke-clsB-cookies.txt
```

Expected: HTTP 200 with `[]` (empty array — RLS on `classes` + `categories` filters by `household_id`; User A's category is in a different household).

**Result:** ___

### 9b. User B cannot update User A's class (PUT)

```bash
curl -s -X PUT http://localhost:3000/api/classes/<UUID_CLS_VACANZE> \
  -H "Content-Type: application/json" \
  -b /tmp/fdf-smoke-clsB-cookies.txt \
  -d '{"name":"Hacked"}'
```

Expected: HTTP 404, `code: "NOT_FOUND"` (RLS USING clause hides the row; update affects 0 rows).

**Result:** ___

### 9c. User B cannot soft-delete User A's class (DELETE)

```bash
curl -s -X DELETE http://localhost:3000/api/classes/<UUID_CLS_VACANZE> \
  -b /tmp/fdf-smoke-clsB-cookies.txt
```

Expected: HTTP 404, `code: "NOT_FOUND"` (archive UPDATE and probe SELECT both return nothing for User B).

**Result:** ___

### 9d. SQL verification (optional — via Supabase Studio or psql)

Run with User B's JWT set as the RLS context:

```sql
-- Set User B's identity (simulates RLS evaluation)
SET LOCAL role TO authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"<UUID_USER_B>"}';

-- Attempt to read User A's class directly
SELECT * FROM public.classes WHERE id = '<UUID_CLS_VACANZE>';
-- Expected: 0 rows

-- Attempt to update
UPDATE public.classes SET name = 'Hacked' WHERE id = '<UUID_CLS_VACANZE>';
-- Expected: UPDATE 0

-- Attempt to delete
DELETE FROM public.classes WHERE id = '<UUID_CLS_VACANZE>';
-- Expected: DELETE 0
```

**Result:** ___

---

## 10. 409 Conflict — duplicate name within same category

Attempt to create a second "Vacanze" in the same category:

```bash
curl -s -X POST http://localhost:3000/api/classes \
  -H "Content-Type: application/json" \
  -b /tmp/fdf-smoke-clsA-cookies.txt \
  -d '{"category_id":"<UUID_CAT_A>","name":"Vacanze","tipologia":"fondo_breve"}'
```

Expected: HTTP 409, `code: "CONFLICT"` (UNIQUE(category_id, name) violation).

The same name in a different category is allowed — no test needed here unless User A has a second category.

**Result:** ___

---

## 11. Smoke User Cleanup

Delete both smoke users, their households, household members, funds, categories, and classes via Supabase admin API or Studio. Verify zero remaining rows matching the smoke test email patterns.

```bash
# Via Supabase admin API — delete auth users by UUID
# (lead or backend-dev run this — requires service role or dashboard access)

# Verify no smoke users remain
# In Supabase Studio: Authentication > Users > filter by "smoke-cls"
# In SQL: SELECT email FROM auth.users WHERE email LIKE 'smoke-cls-%';
# Expected: 0 rows
```

**Cleanup completed by:** ___
**Timestamp:** ___

---

## Summary

| Step | Status |
|---|---|
| pnpm lint / typecheck / test / build | |
| GET /api/classes — no session → 401 | |
| GET /api/classes — missing category_id → 400 | |
| GET /api/classes — invalid UUID category_id → 400 | |
| POST /api/classes — tipologia addebito_immediato → 201 | |
| POST /api/classes — tipologia fondo_breve → 201 | |
| POST /api/classes — tipologia fondo_lungo → 201 | |
| POST /api/classes — missing name → 400 | |
| POST /api/classes — whitespace name → 400 | |
| POST /api/classes — missing tipologia → 400 | |
| POST /api/classes — invalid tipologia → 400 | |
| POST /api/classes — cross-household category_id → 404 CATEGORY_NOT_FOUND | |
| GET /api/classes — active only → 200 (archived excluded) | |
| PUT /api/classes/:id — rename → 200 | |
| PUT /api/classes/:id — change tipologia → 200 | |
| PUT /api/classes/:id — reparent same household → 200 | |
| PUT /api/classes/:id — reparent cross-household → 404 CATEGORY_NOT_FOUND | |
| PUT /api/classes/:id — duplicate name → 409 CONFLICT | |
| PUT /api/classes/:id — empty body → 400 | |
| PUT /api/classes/:id — invalid tipologia → 400 | |
| DELETE /api/classes/:id — soft delete → 204 | |
| GET after delete — archived row excluded | |
| GET ?include_archived=true — archived row included | |
| Re-DELETE archived row — idempotent 204 | |
| DELETE non-existent id → 404 | |
| RLS: User B GET User A's classes → 200 [] | |
| RLS: User B PUT User A's class → 404 | |
| RLS: User B DELETE User A's class → 404 | |
| 409 Conflict duplicate name in same category | |
| Smoke user cleanup | |
