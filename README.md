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
cp .env.example .env.local   # compila le variabili locali
pnpm dev
```

## Layout

```
apps/web/       — Next.js App Router: landing + /api/health + (future) product UI
packages/       — (reserved) shared libs
scripts/        — ops scripts (kill-fdf.sh)
.github/        — CI workflows
.claude/        — settings baseline (framework/runtime/claude-settings.baseline.json)
```

## Ops

- **Kill switch:** `./scripts/kill-fdf.sh` — disabilita la app entro <5 min (<60 min soglia massima per §4.6 Constitution v2.0).
- **Deploy:** Vercel (main branch → production); smoke kill-switch obbligatorio day-1.
- **DB/Auth:** Supabase (EU, GDPR).

## License

MIT — vedi [`LICENSE`](./LICENSE).
