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
  funds/           — pagina /funds (protected via src/proxy.ts)
src/lib/           — logica condivisa (domain, supabase clients SSR + admin)
src/components/    — componenti React condivisi (auth/, funds/)
src/proxy.ts       — Next.js 16 edge: kill switch + /admin auth + session redirect + security headers
supabase/          — schema SQL, migrations, RLS policies
scripts/           — ops scripts (kill-fdf.sh)
.github/workflows/ — CI (lint, test, build)
.claude/           — Claude Code config (settings, agents, hooks)
docs/              — runbook, smoke test, infra status, brief feature
```

## Stato prodotto

- **Feature 1 — Tassonomia Sinking Funds (read-only)**: `/funds` legge il tree Fondo→Categoria→Classe via `GET /api/funds`. Empty state. Commit `8febe21`.
- **Feature 2 — Auth System**: signup/login/logout con Supabase Auth + sessione cookie SSR; `/funds` protetto via `src/proxy.ts` (redirect intelligente fra `/login`, `/signup`, `/funds`); household + membership creati al signup (role `owner`). Smoke test: `docs/SMOKE-TEST-FEATURE-2.md`. Commit `380c579`.

## Ops

- **Kill switch:** `./scripts/kill-fdf.sh` — disabilita la app entro <5 min (<60 min soglia massima per §4.6 Constitution v2.0). Implementato in `src/proxy.ts` come primo check (env `MAINTENANCE_MODE=1` → 503 su tutti i path).
- **Deploy:** Vercel (main branch → production); smoke kill-switch obbligatorio day-1.
- **DB/Auth:** Supabase (EU, GDPR). Email confirmation **OFF** in Auth providers (vedi `docs/INFRA-STATUS.md`).

## License

MIT — vedi [`LICENSE`](./LICENSE).
