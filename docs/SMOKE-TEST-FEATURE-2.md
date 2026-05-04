# Smoke Test — Feature 2: Auth System + Protected /funds

**Date:** 2026-05-05  
**Agent:** backend-dev (team `feature-2-auth`)  
**Branch:** `feature/2-auth-system`  
**Environment:** local dev (`pnpm dev`, `http://localhost:3000`)  
**Supabase project:** `tzsnmdmegpokbrbzqbra.supabase.co` (EU region)  
**Test user created:** `smoke+e2e-1777935733@fdf.local` / `25afd006-fa19-4887-8255-9ccea59727cd`

---

## Bug Found and Fixed During This Smoke Test

**Bug:** signup route returned 500 "Failed to create household" when called with a real authenticated session.

**Root causes (pre-existing schema issues, not introduced by Feature 2):**

1. `households` INSERT with `.select("id").single()` returned 403 via SSR client — `households_select_member` USING clause filtered out the just-inserted row because the user wasn't yet a member.
2. `household_members` INSERT caused infinite recursion (SQLSTATE 42P17) — the `household_members_insert_self_or_owner` WITH CHECK subquery recurses through its own table.

**Fix applied (`src/app/api/auth/signup/route.ts`):** the two bootstrap inserts (household + membership) now use the admin client (`getAdminClient()`, service role) instead of the SSR client. Auth validation (signUp, signInWithPassword, getUser) continues to use the SSR anon-key client. The verified `userId` from `getUser()` is passed to the admin inserts — no user-controlled input reaches the admin client.

**Schema issues deferred:** fixing the RLS recursion and SELECT-after-INSERT limitation is Feature 3+ scope (requires ASK-level schema changes).

---

## Operational Note

Supabase email confirmation was **ON** at the start of testing, causing hourly email rate limits to block the signup happy-path in the first test run. Email confirmation was subsequently disabled by the project (or the rate limit window reset), allowing the full E2E to pass. The smoke test below reflects the **second run** (2026-05-04T23:02:13Z) where all steps passed.

---

## Quality Gates

| Gate | Result |
|---|---|
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm test` (133 tests, 1 skipped) | PASS |
| `pnpm build` | PASS — "✓ Compiled successfully", "ƒ Proxy (Middleware)" registered |

---

## 1. Proxy / Middleware Redirects

### 1a. GET /funds without session → 307 /login

```
curl -i http://localhost:3000/funds
```
```
HTTP/1.1 307 Temporary Redirect
location: /login
```
**Result: PASS**

### 1b. GET /login without session → 200

```
curl -i http://localhost:3000/login
```
```
HTTP/1.1 200 OK
```
**Result: PASS**

### 1c. GET /signup without session → 200

```
curl -i http://localhost:3000/signup
```
```
HTTP/1.1 200 OK
```
**Result: PASS**

### 1d. GET /login with authenticated session → 307 /funds

```
curl -i http://localhost:3000/login -b /tmp/fdf-e2e-cookies.txt
```
```
HTTP/1.1 307 Temporary Redirect
location: /funds
```
**Result: PASS**

### 1e. GET /signup with authenticated session → 307 /funds

```
curl -i http://localhost:3000/signup -b /tmp/fdf-e2e-cookies.txt
```
```
HTTP/1.1 307 Temporary Redirect
location: /funds
```
**Result: PASS**

### 1f. Kill switch: MAINTENANCE_MODE=1 → 503 on all paths

Server started with `MAINTENANCE_MODE=1 pnpm dev`:

```
curl -i http://localhost:3000/funds  → HTTP/1.1 503 Service Unavailable
curl -i http://localhost:3000/       → HTTP/1.1 503 Service Unavailable
```
Response body: `{"status":"maintenance","service":"fdf","message":"FdF is temporarily offline for maintenance."}`

**Result: PASS** — kill switch takes precedence over auth redirect.

### 1g. Security headers on non-protected path

```
curl -i http://localhost:3000/
```
```
permissions-policy: camera=(), microphone=(), geolocation=(), payment=(self 'https://checkout.stripe.com')
referrer-policy: strict-origin-when-cross-origin
strict-transport-security: max-age=31536000; includeSubDomains
x-frame-options: DENY
```
**Result: PASS**

---

## 2. POST /api/auth/signup

### 2a. Happy path — 200 + user + household created

```
curl -i -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"smoke+e2e-1777935733@fdf.local","password":"SmokeTest!2026"}' \
  -c /tmp/fdf-e2e-cookies.txt
```
```
HTTP/1.1 200 OK
set-cookie: sb-tzsnmdmegpokbrbzqbra-auth-token=... (session cookie set)
{"success":true,"user":{"id":"25afd006-fa19-4887-8255-9ccea59727cd","email":"smoke+e2e-1777935733@fdf.local",...}}
```
**Result: PASS** (2026-05-04T23:02:13Z)

### 2b. Validation: missing password → 400

```json
{"error":"email and password are required","code":"BAD_REQUEST"}
```
**Result: PASS**

### 2c. Validation: password < 8 chars → 400

```json
{"error":"password must be at least 8 characters","code":"BAD_REQUEST"}
```
**Result: PASS**

### 2d. Validation: both fields missing → 400

```json
{"error":"email and password are required","code":"BAD_REQUEST"}
```
**Result: PASS**

---

## 3. POST /api/auth/login

### 3a. Happy path — 200 + session cookie set

```
curl -i -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"smoke+e2e-1777935733@fdf.local","password":"SmokeTest!2026"}' \
  -c /tmp/fdf-login-cookies.txt
```
```
HTTP/1.1 200 OK
set-cookie: sb-tzsnmdmegpokbrbzqbra-auth-token=... (session cookie set)
{"success":true,"user":{"id":"25afd006-fa19-4887-8255-9ccea59727cd",...}}
```
**Result: PASS** (2026-05-04T23:02:32Z)

### 3b. Wrong credentials → 401

```json
{"error":"Invalid login credentials","code":"INVALID_CREDENTIALS"}
```
**Result: PASS**

### 3c. Missing fields → 400

```json
{"error":"email and password are required","code":"BAD_REQUEST"}
```
**Result: PASS**

---

## 4. POST /api/auth/logout

### 4a. Logout → 200

```json
{"success":true}
```
HTTP status: 200. **Result: PASS**

### 4b. After logout, GET /funds → 307 /login

```
HTTP/1.1 307 Temporary Redirect
location: /login
```
**Result: PASS**

---

## 5. GET /api/funds (protected resource)

### 5a. With session → 200 + empty fund array

```
curl -s http://localhost:3000/api/funds -b /tmp/fdf-e2e-cookies.txt
```
```
[]
```
HTTP status: 200. **Result: PASS** (new user has no funds yet — correct empty state)

---

## 6. DB Verification (households + household_members)

Lead verified directly via PostgREST + service role at 2026-05-04T23:05Z, using a second smoke user (`lead-final-1777935901@fdf.local`, ID `600cc91d-ec7f-4ffb-b07e-51260a6a2ea9`):

```
GET /rest/v1/household_members?user_id=eq.600cc91d-...&select=household_id,role,display_name,households(id,name)
```
Response:
```json
[{"household_id":"0ff68317-d039-4170-ad27-acca6137c960","role":"owner","display_name":"lead-final-1777935901","households":{"id":"0ff68317-d039-4170-ad27-acca6137c960","name":"Household di lead-final-1777935901"}}]
```

**Result: PASS** — household + membership row created, owner role, display_name = email local-part.

For future verification, the equivalent SQL is:
```sql
SELECT h.id, h.name, hm.user_id, hm.role, hm.display_name
FROM public.households h
JOIN public.household_members hm ON hm.household_id = h.id
WHERE hm.user_id = '<user-id>';
```

---

## 7. Smoke User Cleanup

Test users created during the full E2E + lead independent re-verification: 8 total (signup attempts during rate-limit debugging + one happy-path each from backend-dev and lead).

All 8 auth users + 2 orphaned households (smoke users that successfully completed signup post-fix) deleted via the Supabase admin API at 2026-05-04T23:06Z. Verified clean: zero remaining smoke test users or households matching the test patterns.

---

## Summary

| Step | Status |
|---|---|
| pnpm lint / typecheck / test / build | PASS |
| GET /funds (no session) → 307 /login | PASS |
| GET /login (no session) → 200 | PASS |
| GET /signup (no session) → 200 | PASS |
| GET /login (with session) → 307 /funds | PASS |
| GET /signup (with session) → 307 /funds | PASS |
| MAINTENANCE_MODE=1 → 503 everywhere | PASS |
| Security headers on / | PASS |
| POST /api/auth/signup — validation paths | PASS |
| POST /api/auth/signup — happy path | PASS |
| POST /api/auth/login — 401 wrong creds | PASS |
| POST /api/auth/login — happy path | PASS |
| POST /api/auth/logout → 200 | PASS |
| GET /funds after logout → 307 /login | PASS |
| GET /api/funds with session → 200 | PASS |
| DB rows (households + members) | PASS (verified via PostgREST + service role) |
| Smoke user cleanup | DONE (8 auth users + 2 orphaned households deleted) |
