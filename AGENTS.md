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
- **Package manager:** pnpm (workspace monorepo)
- **CI:** GitHub Actions

## Layout monorepo

```
apps/web/          — Next.js App Router (landing, /api/health, future product UI)
packages/          — (reserved) shared libs cross-app
supabase/          — schema, migrations, RLS policies (PLpgSQL)
scripts/           — ops scripts (kill-fdf.sh, ecc.)
tests/             — top-level integration tests
.github/workflows/ — CI (lint, test, build)
.claude/           — Claude Code config (settings, agents, hooks)
docs/              — runbook, pilot docs
```

## Comandi standard

```bash
pnpm install              # install workspace
pnpm dev                  # dev server (apps/web)
pnpm lint                 # ESLint su tutto il workspace
pnpm test                 # Vitest --run su tutto il workspace
pnpm test --watch         # Vitest watch mode
pnpm --filter web build   # production build (solo apps/web)
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
| `backend-dev` | `supabase/**`, `apps/web/app/api/**` | `packages/**`, `apps/web/lib/**` |
| `domain-dev` | `packages/**`, `apps/web/lib/**` (logica pura) | `supabase/**` (schema), `apps/web/app/api/**` |
| `frontend-dev` | `apps/web/app/**` (escluso `app/api/`), `apps/web/components/**` | `packages/**`, `apps/web/lib/**` |
| `test-engineer` | `tests/**`, `**/*.test.ts`, `**/*.spec.ts` | tutto il repo |
| `security-reviewer` | nessuno (read-only) | tutto il repo |

**File condivisi (modifica solo via ASK al lead):**
`package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `next.config.ts`,
`vercel.json`, `vitest.config.ts`, `eslint.config.mjs`, `.env.example`,
`AGENTS.md`, `CLAUDE.md`, `README.md`, `.github/workflows/**`.

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

## Riferimenti rapidi

- Constitution holding: `gargency-context/CONSTITUTION.md` (v2.0+)
- Framework patterns: `gargency-context/framework/` (n≥2 validati)
- ADR company FdF: `gargency-context/companies/fdf/decisions/`
- State live FdF: `gargency-context/companies/fdf/state.md`
