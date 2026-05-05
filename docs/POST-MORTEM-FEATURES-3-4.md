# Post-Mortem — Features 3 & 4 (Categories + Classes CRUD)

**Date:** 2026-05-05
**Author:** lead (post-merge analysis)
**Scope:** commits `210308e` (Feature 3) + `0a06ebc` (merge) + `9c3c1bf` (Feature 4)
**Purpose:** extract n=2 patterns from FdF for eventual framework v0.4.0
sync. **FdF-local document** — not yet promoted to
`gargency-context/framework/`. Cross-company validation (n≥2 outside
FdF) is required before promotion per Constitution §5 and the framework
governance rules.

---

## Summary

Two PFM CRUD features completed on the same day (2026-05-05), each
covering the second and third levels of the sinking-fund taxonomy
(ADR-0006: Fondo → Categoria → Classe).

| Metric                         | Feature 3 (Categories) | Feature 4 (Classes) |
|---|---|---|
| Commit                         | `210308e` (12:39)      | `9c3c1bf` (16:58)   |
| Files added                    | 13                     | 12                  |
| Lines (insertions)             | 3,431                  | 3,993               |
| API route handlers             | 4 (GET/POST/PUT/DELETE)| 4 (GET/POST/PUT/DELETE) |
| Test files (colocated)         | 2                      | 2                   |
| `it()` test cases              | 48 (24+24)             | 58 (28+30)          |
| Smoke runbook lines            | 441                    | 555                 |
| New migrations                 | 0                      | 0                   |
| New npm dependencies           | 0                      | 0                   |
| `src/proxy.ts` modifications   | 0                      | 0                   |
| Quality gates (lint/test/build)| PASS                   | PASS                |

Same-day delivery (~4h between F3 merge and F4 commit) confirms the
F2→F3 scaffold absorbed most of the friction; F4 was largely a
mechanical clone with one structural variant (parent-of-parent
selector).

---

## Patterns Observed (n=2, promotion candidates)

These patterns appear in **both** features with near-identical structure
and warrant lifting into shared helpers when n=3 is confirmed (likely
Feature 5: Accounts CRUD or Sinking-Fund-Tree read).

### 1. API route 5-step skeleton

**Evidence:** `src/app/api/{categories,classes}/route.ts` and
`src/app/api/{categories,classes}/[id]/route.ts` — all four files
follow:

```
1. Init SSR client (getServerSupabaseClient → 500 on null)
2. Verify auth (getUser, not getSession → 401 on miss)
3. Validate route/query params (Zod safeParse → 400)
4. Validate body (request.json + Zod safeParse → 400)
5. DB op + Zod row validation on return → 200/201/204
```

**Why reusable:** every household-scoped CRUD endpoint will need these
five steps. The ordering is non-negotiable (auth must precede DB).

**Promotion:** ASK at n=3. Candidates:
- `withSupabaseUser(handler)` HOC that pipes `(supabase, userId,
  request) → Response`.
- Codified error-code constants module to prevent drift (`code:
  "UNAUTHENTICATED"` is currently a string literal repeated 8 times).

### 2. Two-layer household_id derivation on parent-FK insert

**Evidence:**
- `categories/route.ts:170-194` — query `funds` for `household_id`
  before inserting a category, then RLS WITH CHECK as second defence.
- `classes/route.ts:174-198` — query `categories` for `household_id`
  before inserting a class, then RLS WITH CHECK.

The pattern: the user passes the parent FK (`fund_id`/`category_id`);
the server derives `household_id` from the parent row (Strategy A),
which RLS hides if cross-household → 404. RLS WITH CHECK on the child
table is Strategy B (defence in depth).

**Why reusable:** every nested-resource CRUD that scopes via parent
will need this. Eliminates an entire class of cross-tenant write bugs
without trusting client-supplied `household_id`.

**Promotion:** strong candidate. Constitution §"GDPR & data residency"
implicitly requires server-side household derivation — codify as a
shared helper `resolveHouseholdFromParent(parentTable, parentId)`.

### 3. Soft-delete idempotent UPDATE + probe

**Evidence:** identical 30-line block at the end of both
`[id]/route.ts` files (`categories/[id]/route.ts:201-256`,
`classes/[id]/route.ts:234-289`).

```sql
UPDATE … SET archived_at = NOW() WHERE id = $1 AND archived_at IS NULL
-- if 0 rows: SELECT id FROM … WHERE id = $1
--   if found → already archived → 204 (idempotent)
--   if not   → 404
```

**Why reusable:** distinguishing "already archived" from "not found /
RLS-hidden" without a separate read-then-write race window is
non-trivial. Both features arrived at the exact same shape.

**Promotion:** highest signal pattern. Lift to
`softDeleteWithIdempotentProbe(supabase, table, id)`. Verified at n=2
within FdF; cross-company validation pending.

### 4. Standardized error-code taxonomy

**Evidence:** identical codes across 4 route files:

| HTTP | code                  | Meaning                              |
|---|---|---|
| 401  | `UNAUTHENTICATED`     | `getUser` failed                     |
| 400  | `VALIDATION_ERROR`    | Zod parse / param validation         |
| 404  | `FUND_NOT_FOUND` / `CATEGORY_NOT_FOUND` / `NOT_FOUND` | parent or self missing  |
| 409  | `CONFLICT`            | Postgres `23505` unique violation    |
| 500  | `INIT_ERROR`          | `getServerSupabaseClient` returned null |
| 500  | `DB_ERROR`            | any other Supabase error             |

**Why reusable:** front-end Server Actions branch on `res.status`
(`actions.ts` in both `app/categories/` and `app/classes/`). A drifting
code map would silently break user-facing copy.

**Promotion:** lift to `src/lib/api/error-codes.ts` constant module.
Already mature enough for FdF-internal extraction.

### 5. Zod row-schema validation on DB results

**Evidence:** `CategoryRowSchema` (Feature 3) and `ClassRowSchema`
(Feature 4) are both `z.object` schemas in `src/lib/domain/funds.ts`
imported by the corresponding routes. Pattern of use:

```ts
const rows = (rawRows ?? []).flatMap((row) => {
  const result = Schema.safeParse(row);
  return result.success ? [result.data] : [];
});
```

**Why reusable:** drops malformed rows silently rather than 500-ing the
whole list. Cheap defence against schema drift between migrations and
route code.

**Promotion:** keep as a convention; doesn't need a helper (the lambda
is short). Document in a future "API authoring guide".

### 6. Server Component fetch via `cookies()` + `buildBaseUrl()`

**Evidence:** `categories/page.tsx:38-43`, `classes/page.tsx:48-53`,
also `categories/actions.ts:33-43`, `classes/actions.ts:33-43`. The
helper is **duplicated verbatim 4 times**.

```ts
async function buildBaseUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const protocol = h.get("x-forwarded-proto") ?? "http";
  return `${protocol}://${host}`;
}
```

**Why reusable:** every Server Component that calls its own `/api/*`
endpoints from inside a request needs this. Already at n=4 within FdF.

**Promotion:** **immediate** (pre-Feature-5). Lift to
`src/lib/server/internal-fetch.ts` with a `serverFetch(path, init?)`
wrapper. Lowest-risk extraction in this list.

### 7. Server Action (create) + client fetch (edit/delete) split

**Evidence:** `categories/actions.ts` exports `createCategory` only;
edit and delete live in `CategoryRow.tsx` (`"use client"`) as
`router.refresh()` flows. Feature 4 mirrors this split exactly
(`createClass` in `actions.ts`, edit/delete in `ClassRow.tsx`).

**Why reusable:** both teams arrived at the same trade-off (Server
Action for the dedicated `/new` route; client fetch when the row is
already interactive). Validated judgement, not accidental.

**Promotion:** document as a convention; no shared code to lift.

### 8. In-page 401 handling (no `proxy.ts` redirect)

**Evidence:** identical 401 branch in `categories/page.tsx:133-154` and
`classes/page.tsx:180-203`. Both render an "Accedi per visualizzare…"
message with a `Link` to `/login` rather than redirecting.

**Why reusable:** keeps `src/proxy.ts` lean (kill switch + auth scope
narrow per AGENTS.md "Edge middleware" §). Feature 3 set the pattern;
Feature 4 followed without prompting.

**Promotion:** convention only.

### 9. Frontend component quartet `<Selector>` + `<List>` + `<Row>` + `<Form>`

**Evidence:**
- Feature 3: `FundSelector`, `CategoryList`, `CategoryRow`,
  `CategoryForm`, `ArchivedBadge`.
- Feature 4: `CategorySelector` (two-level), `ClassList`, `ClassRow`,
  `ClassForm`. **Reuses `ArchivedBadge` directly from
  `@/components/categories/`** — already a cross-feature pattern.

**Why reusable:** one shape for every CRUD-list view. Feature 4
reusing `ArchivedBadge` is the first n=2 component-level reuse signal
in the repo.

**Promotion:** consider relocating `ArchivedBadge` to
`src/components/shared/` (rename: it's not category-specific). ASK
because file move touches imports.

### 10. Vitest scaffold for route handlers

**Evidence:** identical mock setup in all 4 test files
(`mock @/lib/supabase/server`, `mock next/server` with custom
`MockNextResponse`, UUID-v4 fixtures, `NOW` constant, helper
`makeRequest()`).

**Why reusable:** every route test will repeat this. Already at n=4
within FdF.

**Promotion:** lift to `src/test-utils/route-handler-harness.ts` after
Feature 5 confirms n=3 of route handlers.

### 11. Smoke runbook 11-section format

**Evidence:** `SMOKE-TEST-FEATURE-{2,3,4}.md` all follow the same
section ordering (Prereqs → Auth → Negative auth → Validation → Happy
path → Read variants → Update → Soft delete → Cross-tenant RLS → SQL
verification → Cleanup). F4's runbook even mirrors F3's prereq table
structure.

**Why reusable:** establishes a manual-test contract that new features
copy verbatim and edit only the resource-specific portions.

**Promotion:** template file `docs/templates/SMOKE-TEST-TEMPLATE.md`
when n=3 confirms.

### 12. PII-safe error logging shape

**Evidence:** every `console.error` in both features uses
`{ userId, code: dbError.code }` — never email, never amount, never
row content. Matches AGENTS.md "No console.log with PII".

**Why reusable:** convention-level only, but worth codifying.

---

## Patterns Waiting (n=1, need more validation)

- **Two-level cascading selector** (`CategorySelector` for classes):
  fund-then-category dropdown. Feature 3 only had one level
  (`FundSelector`). Wait for Feature 5+ to see if the pattern
  generalizes.
- **`PUT` accepts `archived_at: null` for un-archive** (only Feature 4
  added this in `PutClassBody`). Asymmetry with Feature 3's PUT — flag
  as inconsistency, decide on convergence at Feature 5.
- **Pre-check parent on reparent** (Feature 4's PUT explicitly looks up
  the new `category_id` before the UPDATE; Feature 3 lets RLS WITH CHECK
  reject the update silently). Two valid styles, no consensus yet.
- **`tipologia` enum constraint** at the API layer
  (`addebito_immediato` / `fondo_breve` / `fondo_lungo`). Domain-specific
  to classes; not promotable.

---

## Anti-patterns Avoided

- **No admin client / service role in CRUD handlers.** Both features
  use only `getServerSupabaseClient()` (anon-key SSR with cookie auth)
  — service role is reserved for the documented signup bootstrap
  workaround (see AGENTS.md §"Bootstrap household al signup"). RLS is
  the primary gate.
- **No client-supplied `household_id` on insert.** Always derived from
  parent FK + RLS WITH CHECK, never trusted from request body.
- **No raw SQL string-building.** All queries via the Supabase JS
  client; no SQL injection surface in route code.
- **No PII in logs.** Verified via grep across both features — only
  `userId` (UUID) and Postgres error codes.
- **No new dependencies.** Reused `zod` and `@supabase/ssr` already
  present.
- **No `src/proxy.ts` modification.** Auth redirect logic in proxy
  remained untouched (Constitution §4.6 / AGENTS.md "Edge middleware").
- **No schema-altering migrations.** Existing tables + RLS policies
  from `9b0915f feat(db): schema core` were sufficient — confirmed
  during planning. Avoided destructive ASK to lead.
- **No half-finished implementations.** Both features land complete
  CRUD (GET/POST/PUT/DELETE) — no TODOs or "v2 coming soon" stubs.

---

## Agent Teams Metrics

> Indicative — derived from commit timestamps and message bodies, not
> from a logged session record. Treat as soft signals.

### Wall-clock

| Phase                      | Feature 3              | Feature 4              |
|---|---|---|
| Branch open → first commit | (untracked)            | (untracked)            |
| First commit → merge to main | `210308e` 12:39 → `0a06ebc` 13:20 (~41 min) | `9c3c1bf` 16:58 → not yet merged |
| F3 merge → F4 commit       | `0a06ebc` 13:20 → `9c3c1bf` 16:58 (~3h 38m)            |                        |

Total wall-clock for both features: **same calendar day**
(2026-05-05). The F2 scaffold (auth + SSR client + RLS bootstrap
workaround) clearly amortized across both.

### BLOCK events

No BLOCK events surfaced in the commit history or smoke runbooks. This
is consistent with both features being **schema-additive on existing
tables** (no migration ASK, no RLS policy ASK). Memory entry
"BLOCK è il successo del dry-run" applies prospectively — Feature 5
should not assume this clean run is the steady state.

### Plan approval workflow

- Both feature commit messages and inline comments reference "the plan
  approved" / "documented in plan" (e.g.,
  `categories/actions.ts:11`, `categories/CategoryRow.tsx:11`),
  indicating a plan was authored and approved before
  implementation.
- **Regression to flag:** F4's commit message body is empty (just
  title + co-author). F3 had a structured body listing
  Backend / Frontend / Tests / Quality gates. Future features should
  match F3's format.

### Quality gate cycle

Both features cleared `pnpm lint / test / build` per their commit
messages (F3 explicitly: "lint PASS, 178 tests PASS, build PASS";
F4 implicit via merge prereq). The `.claude/hooks/task-completed.sh`
gate was the enforcement point.

---

## Recommendations

### For Feature 5+ (if we do them)

1. **Lift `buildBaseUrl()` first** — duplicated 4 times, lowest risk.
   Move to `src/lib/server/internal-fetch.ts` and import from all
   four call sites before opening Feature 5 branch.
2. **Decide PUT-reparent convention** (pre-check parent vs. RLS-only).
   Pick one and refactor F3 or F4 to match — currently a divergence.
3. **Decide PUT `archived_at: null` un-archive policy.** F4 supports
   it; F3 doesn't. ASK lead before Feature 5 inherits whichever shape.
4. **Relocate `ArchivedBadge` to `src/components/shared/`** (already
   reused cross-feature). ASK because file move.
5. **Author `softDeleteWithIdempotentProbe()` helper** if Feature 5
   needs soft delete — that's n=3 and clears the promotion bar.

### For framework v0.4.0 promotion

Three patterns are FdF-mature enough to **propose** to framework, but
**none can be promoted yet** without n=2 across companies:

- Two-layer household_id derivation (multi-tenant scoping)
- Soft-delete idempotent UPDATE + probe
- Standardized API error-code taxonomy

Action: hold proposals in this document. Re-evaluate when a second
Gargency company starts a multi-tenant CRUD feature. Per Constitution
§5 framework patterns require n≥2 across companies.

### For cross-company pattern validation

- The patterns above assume Postgres + RLS + a `household_id`-style
  tenant column. A Stripe-payments or e-commerce company might not
  share the row-level security stack. Don't promote these as
  "framework patterns" — promote as "Supabase RLS multi-tenant
  CRUD patterns" if/when validated.
- The Server Component + cookie + base-URL helper is **Next.js
  App-Router-specific**. If the second company is on a different
  framework, this becomes a Next.js-only convention, not a framework
  pattern.

---

## File index for this analysis

- `src/app/api/categories/route.ts` (F3 collection handler)
- `src/app/api/categories/[id]/route.ts` (F3 item handler)
- `src/app/api/classes/route.ts` (F4 collection handler)
- `src/app/api/classes/[id]/route.ts` (F4 item handler)
- `src/app/{categories,classes}/page.tsx` (Server Components)
- `src/app/{categories,classes}/actions.ts` (Server Actions)
- `src/app/{categories,classes}/new/page.tsx` (dedicated create routes)
- `src/components/categories/{FundSelector,CategoryList,CategoryRow,CategoryForm,ArchivedBadge}.tsx`
- `src/components/classes/{CategorySelector,ClassList,ClassRow,ClassForm}.tsx`
- `docs/SMOKE-TEST-FEATURE-{3,4}.md`
- `src/lib/domain/funds.ts` (`CategoryRowSchema`, `ClassRowSchema`)
