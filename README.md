# FdF — Finanza di Famiglia

PFM (Personal Finance Management) italiano per famiglie tech-savvy con multi-conto bancario, carta Amex Personal e un modello di budget a **sinking funds** (tassonomia Fondo → Categoria → Classe) che riflette come le famiglie italiane già gestiscono mentalmente il denaro.

## Contesto

Company v2.0 native della holding Gargency, fast-lane, pre-launch. Context di dominio, mission, target, pitch e kill criteria in:

- Pitch — [`gargency-context/incubator/fdf.md`](https://github.com/admin-gargency/gargency-context/blob/main/incubator/fdf.md) (§5.3.2 v2.0).
- Apertura — [`decisions/ADR-H-0008-open-fdf-first-v2-native.md`](https://github.com/admin-gargency/gargency-context/blob/main/decisions/ADR-H-0008-open-fdf-first-v2-native.md).
- Scaffold company — [`companies/fdf/`](https://github.com/admin-gargency/gargency-context/tree/main/companies/fdf) (CLAUDE.md, state.md, domain/).

Stack + security decisions vivono in `gargency-context` come ADR company-level (0001-bootstrap, 0002-stack, 0003-security-baseline).

## Setup

```bash
pnpm install
cp .env.example .env.local   # compila le variabili locali (vedi .env.example)
pnpm dev                     # http://localhost:3000
```

Variabili minime per il flow auth + funds:
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — client SSR
- `SUPABASE_SERVICE_ROLE_KEY` — server-only, usato dal signup per il bootstrap household (vedi `docs/SMOKE-TEST-FEATURE-2.md` §"Bug Found and Fixed")

## Layout

Repo flat single-package, **non monorepo** (vedi `AGENTS.md` per dettagli).

```
src/app/           — Next.js App Router (pages, layouts, /api/* route handlers)
  (auth)/          — route group login + signup (no URL prefix)
  api/auth/        — POST signup | login | logout
  api/{funds,categories,classes,transactions,budgets}/         — CRUD route handlers
  api/transactions/import-csv/                                 — POST bulk import multipart (F8)
  funds/, categories/, classes/, transactions/, budgets/, sinking-funds-tree/ — pagine protette
  transactions/import/                                         — UI import CSV (F8)
src/lib/           — logica condivisa
  supabase/        — server.ts (SSR anon-key) + admin.ts (service-role)
  domain/          — funds, transactions, budgets, csv-import, sinking-funds-tree (logica pura)
  ingestion/       — generic-csv parser + amex (parser/normalize/rate-limit), riusabili
src/components/    — componenti React condivisi (auth/, funds/, transactions/, budgets/, csv-import/, ...)
src/proxy.ts       — Next.js 16 edge: kill switch + /admin auth + session redirect + security headers
supabase/          — schema SQL, migrations, RLS policies, GRANT column-level
scripts/           — ops scripts (kill-fdf.sh)
.github/workflows/ — CI (lint, test, build)
.claude/           — Claude Code config (settings, agents, hooks)
docs/              — runbook, smoke test, infra status, brief feature
```

## Stato prodotto

- **Feature 1 — Tassonomia Sinking Funds (read-only)**: `/funds` legge il tree Fondo→Categoria→Classe via `GET /api/funds`. Empty state. Commit `8febe21`.
- **Feature 2 — Auth System**: signup/login/logout con Supabase Auth + sessione cookie SSR; `/funds` protetto via `src/proxy.ts` (redirect intelligente fra `/login`, `/signup`, `/funds`); household + membership creati al signup (role `owner`). Smoke test: `docs/SMOKE-TEST-FEATURE-2.md`. Commit `380c579`.
- **Feature 3 — Categorie CRUD**: lista/create/edit/archive su `/categories` con RLS household-scoped, derivazione `household_id` da fund parent, soft delete via `archived_at`. Smoke test: `docs/SMOKE-TEST-FEATURE-3.md`. Commit `210308e`.
- **Feature 4 — Classi CRUD**: gerarchia Fondo→Categoria→Classe completata su `/classes` con tipologia (`addebito_immediato | fondo_breve | fondo_lungo`). Stesso pattern di F3 (5-step skeleton, household derivation, soft delete idempotente). Smoke test: `docs/SMOKE-TEST-FEATURE-4.md`. Commit `9c3c1bf`.
- **Feature 5 — Sinking-Fund Tree (read view)**: `/sinking-funds-tree` aggrega hierarchical Fondo→Categoria→Classe con target/current amounts (cents), read-only. Commit `5a5a7a4`.
- **Feature 6 — Transactions CRUD**: lista filtrabile per mese, create, edit, soft delete su `/transactions`. Schema include `raw_description` (PII service-role-only), `external_id` (dedupe), `source` enum-like, `needs_review` flag. Smoke test: `docs/SMOKE-TEST-FEATURE-6.md`. Commit `7240d38`.
- **Feature 7 — Budgets CRUD**: budget mensili per Classe su `/budgets` con vista budget-vs-actual e progress bar tricolore (verde <90%, giallo 90-100%, rosso >100%); inline edit; upsert idempotente su `(class_id, period)`. Commit `f6a40bc` (PR #9).
- **Feature 8 — CSV Import Pipeline**: import bulk CSV su `/transactions/import`, formati Fineco auto-detect e generic con column-mapping UI. Dedupe SHA-256 → `external_id`; partial unique index `(account_id, external_id)`. Admin client server-side per scrittura colonne audit (`raw_description`/`external_id`/`created_by` non sono nei `GRANT INSERT` a `authenticated`). Rate-limit per-user 10/h. Sblocca migrazione K7 (~13k transazioni Excel). Commit `149f80b` (PR #10), debt fix M-1+L-2 in `b643a9e` (PR #11).

## Ops

- **Kill switch:** `./scripts/kill-fdf.sh` — disabilita la app entro <5 min (<60 min soglia massima per §4.6 Constitution v2.0). Implementato in `src/proxy.ts` come primo check (env `MAINTENANCE_MODE=1` → 503 su tutti i path).
- **Deploy:** Vercel (main branch → production); smoke kill-switch obbligatorio day-1.
- **DB/Auth:** Supabase (EU, GDPR). Email confirmation **OFF** in Auth providers (vedi `docs/INFRA-STATUS.md`).

## License

MIT — vedi [`LICENSE`](./LICENSE).
