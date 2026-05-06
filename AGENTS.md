# AGENTS.md — FdF (Finanza di Famiglia)

> Entry-point per agent che lavorano su questo repo (codice).
> Il file `CLAUDE.md` è alias di questo (`@AGENTS.md`).
> Subordinato a `gargency-context/CONSTITUTION.md` v2.0 e a
> `gargency-context/companies/fdf/CLAUDE.md` (governance company-level).
> In caso di conflitto, vince la Constitution.

## ⚠️ Next.js — leggere prima

Questa versione ha breaking changes — API, conventions, e file structure
possono differire dai dati di training. Leggi la guida pertinente in
`node_modules/next/dist/docs/` prima di scrivere codice. Rispetta i
deprecation notice.

## Cos'è FdF

PFM (Personal Finance Management) italiano per famiglie tech-savvy, con
multi-conto bancario, carta Amex Personal, e modello budget a **sinking
funds** (tassonomia Fondo → Categoria → Classe). Prima company **v2.0
native** della holding Gargency.

Context completo:
- Pitch: `gargency-context/incubator/fdf.md` (Constitution §5.3.2 v2.0)
- Apertura: `gargency-context/decisions/ADR-H-0008-open-fdf-first-v2-native.md`
- Governance company: `gargency-context/companies/fdf/CLAUDE.md`
- Stack & security: `gargency-context/companies/fdf/decisions/`
  (`0001-bootstrap`, `0002-stack`, `0003-security-baseline`)

## Stack

- **Framework:** Next.js (App Router), TypeScript strict
- **Database/Auth:** Supabase (Postgres + Auth + Storage), regione EU, GDPR
- **Pagamenti:** TBD (probabile Stripe per subscription pre-launch)
- **Deploy:** Vercel (`fdf-orpin.vercel.app` pre-launch staging)
- **Test:** Vitest
- **Package manager:** pnpm (single-package, no workspace al momento)
- **CI:** GitHub Actions

## Layout

Repo flat single-package, **non monorepo**. Refactor a workspace
package-based posticipato a quando esistono almeno 2 candidati di
estrazione (vedi ADR-0006 §Decision 2 in `gargency-context/companies/
fdf/decisions/ADR-0006-sinking-funds-taxonomy.md`).

```
src/app/           — Next.js App Router (pages, layouts, /api/* route handlers)
  (auth)/          — route group login + signup
  api/auth/        — POST signup | login | logout
  api/{funds,categories,classes,transactions,budgets}/         — CRUD route handlers
  api/transactions/import-csv/                                 — POST bulk import multipart (F8)
  api/ingestion/amex/csv/                                      — Amex CSV parse-and-return endpoint (legacy)
  funds/, categories/, classes/, transactions/, budgets/, sinking-funds-tree/ — pagine protette
  transactions/import/                                         — UI import CSV (F8)
src/lib/           — logica condivisa (domain, supabase clients, utilities)
  supabase/        — server.ts (SSR anon-key) + admin.ts (service role)
  domain/          — funds, transactions, budgets, csv-import, sinking-funds-tree (logica pura — domain-dev)
  ingestion/       — generic-csv parser + amex (parser/normalize/rate-limit), utility riusabili
src/components/    — componenti React condivisi (auth/, funds/, transactions/, budgets/, csv-import/, ...)
src/proxy.ts       — Next.js 16 edge: kill switch + /admin auth + session redirect + security headers
supabase/          — schema, migrations, RLS policies (PLpgSQL), GRANT column-level
scripts/           — ops scripts (kill-fdf.sh, ecc.)
.github/workflows/ — CI (lint, test, build)
.claude/           — Claude Code config (settings, agents, hooks)
docs/              — runbook, pilot docs, smoke test, brief feature
```

`pnpm-workspace.yaml` esiste nel repo ma contiene solo
`ignoredBuiltDependencies` — non definisce un workspace effettivo.
Test colocated ai sorgenti via convention `*.test.ts` / `*.spec.ts`,
nessuna directory top-level `tests/`.

### Edge middleware: `src/proxy.ts`, NON `middleware.ts`

Next.js 16 ha rinominato `middleware.ts` → `proxy.ts`. **I due file sono
mutuamente esclusivi**: la presenza di entrambi rompe il build con
`Both middleware file and proxy file are detected`. Tutta la logica edge
di FdF vive in `src/proxy.ts` con quest'ordine non negoziabile:

1. **Kill switch** (`MAINTENANCE_MODE=1` → 503) — sempre primo.
2. **`/admin` Basic auth** (matcher `/admin/*` e `/api/admin/*`).
3. **Auth redirect Supabase** — solo per `/funds/*`, `/login`, `/signup`
   (per evitare round-trip `getUser()` su path non rilevanti). Cookie
   pattern moderno `getAll`/`setAll` con doppia-write request+response.
4. **Security headers** (`strict-transport-security`, `x-frame-options`,
   `referrer-policy`, `permissions-policy`) sul response finale.

Estensioni a `src/proxy.ts` sono ASK al lead anche quando puramente
additive: il kill switch ha precedenza costituzionale (§4.6) e l'ordine
dei check non è alterabile.

## Comandi standard

```bash
pnpm install              # install workspace
pnpm dev                  # dev server
pnpm lint                 # ESLint su tutto il workspace
pnpm test                 # Vitest --run su tutto il workspace
pnpm test --watch         # Vitest watch mode
pnpm build                # production build
./scripts/kill-fdf.sh     # kill switch (deploy disable < 5 min)
```

**Tutti questi comandi devono passare prima di un merge su `main`.** Il
`task-completed.sh` hook li esegue automaticamente come quality gate.

## Matrice di Autonomia (specifica FdF)

Adattata da `CONSTITUTION.md §8` v2.0 e da `companies/fdf/CLAUDE.md`.

| Modalità | Comportamento | Esempi specifici FdF |
|---|---|---|
| **AUTO** | Agent decide ed esegue | Refactor interni, fix bug non-breaking, lint/format, dipendenze patch-version, docs interne, test aggiuntivi, migration **additive** (nuova tabella/colonna nullable), nuovi route segments, modifiche UI non-pubblica |
| **ASK** | Agent pausa e propone | Merge su `main`, deploy prod, modifica **schema esistente** (drop/rename column, change type), modifica **RLS policy esistente**, nuove dipendenze npm, modifica copy pubblico, modifica **tassonomia sinking funds** (Fondo/Categoria/Classe), spesa fuori budget, task cross-company |
| **ESCALATE** | Solo CEO decide | Apertura/chiusura company, decisioni legali/fiscali, **dati personali utenti** (export, deletion request), risposte ufficiali pubbliche, deviazioni Constitution, **secret rotation in prod**, modifiche al kill switch |

**Default:** in ambiguità, declina verso **ASK**, mai verso AUTO.

**Specifico per dati finanziari:** ogni modifica che tocca tabelle con
dati monetari o di transazione utente richiede ASK + audit RLS pre-merge
(vedi `security-reviewer` agent per audit automatizzato).

## File ownership convention (Agent Teams)

Quando un Agent Team è attivo su questo repo, ogni teammate ha
responsabilità su un sottoinsieme disgiunto del filesystem. **Due
teammate non scrivono mai sullo stesso file.**

| Teammate | Owns (write) | Reads (read-only) |
|---|---|---|
| `backend-dev` | `supabase/**`, `src/app/api/**`, `src/lib/supabase/**` | `src/lib/domain/**` |
| `domain-dev` | `src/lib/domain/**` (logica pura) | `supabase/**` (schema), `src/app/api/**` |
| `frontend-dev` | `src/app/**` (escluso `app/api/`), `src/components/**` | `src/lib/**` |
| `test-engineer` | `**/*.test.ts`, `**/*.spec.ts` | tutto il repo |
| `security-reviewer` | nessuno (read-only) | tutto il repo |

**`src/lib/supabase/`** è `backend-dev` territory: include `server.ts`
(client SSR autenticato anon-key, usato dalle route handler) e `admin.ts`
(service-role, da usare con parsimonia per bootstrap operations dopo
aver validato `auth.uid()`). Vedi `docs/SMOKE-TEST-FEATURE-2.md` per il
pattern di uso combinato in `src/app/api/auth/signup/route.ts`.

**Altri sotto-path di `src/lib/`** (es. `src/lib/utils/`,
`src/lib/ingestion/`, `src/lib/waitlist/`) non sono assegnati a un
teammate specifico. Modifica via ASK al lead.

**`src/proxy.ts`** è file condiviso (kill switch sensitivo): qualsiasi
modifica — anche additiva — richiede ASK al lead. Dettaglio sopra in
§"Edge middleware".

**File condivisi (modifica solo via ASK al lead):**
`package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `next.config.ts`,
`vercel.json`, `vitest.config.ts`, `eslint.config.mjs`, `.env.example`,
`src/proxy.ts`, `AGENTS.md`, `CLAUDE.md`, `README.md`,
`.github/workflows/**`.

## Communication protocol

Pattern obbligatorio per tutti gli agent (lead + teammate) in
comunicazione tra loro e col CEO:

- **ACK** — task ricevuto, intenzione di partire, vincoli/dipendenze viste
- **PROGRESS** — heartbeat ogni 5-7 min su task lunghi, cosa fatto e cosa
  resta
- **BLOCK** — incontrato un ostacolo che richiede decisione lead/CEO; mai
  procedere autonomamente in caso di dubbio (default verso ASK)
- **COMPLETION** — task chiuso, cosa è stato fatto, file toccati, gate
  passati, prossimo step suggerito

## Agent Teams — pilot attivo

Vedi `docs/AGENT-TEAMS-PILOT.md` per il runbook completo del pilot
cross-layer in corso (ADR
`gargency-context/companies/fdf/decisions/ADR-0005-agent-teams-pilot.md`).

Subagent definitions: `.claude/agents/*.md` (5 ruoli).
Hooks quality gate: `.claude/hooks/{task-completed,teammate-idle}.sh`.

## Principi non negoziabili

1. **Kill switch testato day-1** (Constitution §4.6 v2.0). Non
   modificare `scripts/kill-fdf.sh` senza ESCALATE.
2. **GDPR & data residency.** Supabase region EU obbligatoria. Nessun
   data store US-based per dati utente.
3. **Brand-neutral nei copy pubblici.** Nomi di banche italiane (Intesa,
   UniCredit, ecc.) e di provider (Supabase, Stripe, FMP, ecc.) non
   compaiono nella UI utente — solo nel codice e in docs interne.
4. **No console.log con PII.** Mai loggare email, IBAN, numeri carta,
   importi associati a utenti identificabili. Pattern: log con user UUID,
   non con email.
5. **Migration reversibili.** Ogni migration in `supabase/migrations/`
   deve avere counter-migration documentata (anche solo come commento)
   per rollback rapido.

## Pattern noti

### Bootstrap household al signup (Feature 2)

Le RLS policies attuali su `households` e `household_members` non
supportano il flusso bootstrap "utente crea il proprio primo household
+ membership" via SSR anon-key client:

- `households_select_member` USING blocca il `RETURNING` implicito di
  `.insert(...).select(...)` perché l'utente non è ancora membro.
- `household_members_insert_self_or_owner` ha sub-query ricorsiva su sé
  stesso → SQLSTATE 42P17 "infinite recursion detected in policy".

Workaround corrente in `src/app/api/auth/signup/route.ts`:
1. SSR client (`getServerSupabaseClient()`) per signUp + signInWithPassword
   + getUser (validazione `auth.uid()`).
2. Admin client (`getAdminClient()`, service role) per i due insert
   (households + household_members), con `userId` pinned al valore
   verificato lato auth — nessun input utente raggiunge il service role.

Schema fix vero (RPC SECURITY DEFINER o riscrittura policy ricorsiva)
deferito a Feature 3+ (ASK su RLS esistenti). Documentato in
`docs/SMOKE-TEST-FEATURE-2.md` §"Bug Found and Fixed" e in
`supabase/README.md` §"Known schema issues".

### Bulk ingestion via service-role per audit columns (Feature 8)

Pattern distinto dal bootstrap F2 ma con stesso scaffold (admin-client
post-validation SSR). Il `GRANT INSERT` su `transactions` per
`authenticated` esclude tre colonne — vedi
`supabase/migrations/20260424000004_grants.sql` L120-125 e il commento
"raw_description e external_id sono scritti da ingestion server-side
(service-role), non da client":

- `raw_description` — bank feed PII (GDPR art. 9)
- `external_id` — dedup key, fingerprinting risk
- `created_by` — audit trail

Conseguenza: ogni endpoint di ingestion bulk che popola `external_id`
(per `ON CONFLICT (account_id, external_id)`) o audit fields **deve**
usare admin client. Pattern in
`src/app/api/transactions/import-csv/route.ts`:

1. SSR client (`getServerSupabaseClient()`) → `getUser()` (auth) →
   rate-limit (`hitRateLimit("import-csv:${userId}")`).
2. Multipart parse + file validation (size, MIME, extension).
3. SSR client (RLS attiva) per ownership check su account:
   `SELECT household_id FROM accounts WHERE id = $1` — 0 rows = 404.
4. Estrai `household_id` dal record account; questo è il valore pinned
   server-side per il bulk insert.
5. Parse CSV via domain layer (puro, niente I/O).
6. Admin client (`getAdminClient()`) per `.upsert(rows, { onConflict:
   "account_id,external_id", ignoreDuplicates: true })`. `household_id`,
   `created_by`, `external_id`, `source: "import_csv"` sono **pinned
   lato server**, mai da input utente raw. Chunking 500 righe.

Validazione SSR-prima-di-admin è **non negoziabile** (security review
FDFA-62 §I-1 confermato).

**Riuso utility ingestion** (read-only per domain-dev, non riassegnate):
- `src/lib/ingestion/generic-csv.ts` — `parseCsv`, `stripBom`,
  `detectSeparator` (BOM strip, quoted fields, separator auto-detect)
- `src/lib/ingestion/amex/normalize.ts` — `parseItalianAmount`
  (separatori it-IT)
- `src/lib/ingestion/amex/rate-limit.ts` — `hitRateLimit(key)` con
  bucket per-user, in-memory globalThis (caveat multi-instance Vercel
  documentato — accettabile pre-launch)

**Convenzione `amount_cents`**: nel codebase il tipo è
`z.number().int()`, NON `z.bigint()`. Supabase JS serializza
Postgres `bigint` come JS `number` — usare `z.bigint()` causerebbe
parse failure runtime. Confermato in `transactions.ts`, `budgets.ts`,
`csv-import.ts`.

**Debt aperto F8** (security review FDFA-62, post-merge):
- M-2: documentare memory limits operativi (5MB CSV → ~80-120MB peak/req
  in heap), considerare `MAX_BYTES = 2MB` o streaming parse.
- L-1: sanitize formula characters (`=`, `+`, `-`, `@`) **on export**
  (CSV/XLSX), NON nel dominio. Tracked per quando arriverà export
  feature. La UI HTML attuale non è vettore.

## Riferimenti rapidi

- Constitution holding: `gargency-context/CONSTITUTION.md` (v2.0+)
- Framework patterns: `gargency-context/framework/` (n≥2 validati)
- ADR company FdF: `gargency-context/companies/fdf/decisions/`
- State live FdF: `gargency-context/companies/fdf/state.md`
