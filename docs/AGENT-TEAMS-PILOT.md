# Agent Teams Pilot — FdF

**Status:** active
**Owner:** CEO (lead) + Agent Teams (teammate)
**ADR:** `gargency-context/companies/fdf/decisions/ADR-0005-agent-teams-pilot.md`
**Started:** _(da compilare al primo run)_

> Runbook operativo per il pilot Agent Teams su FdF. Aggiornato live
> durante il pilot. Output finale → board report mensile + decisione
> kill/promote/extend.

## Goal

Validare se Agent Teams accelera lo sviluppo applicativo cross-layer su
una company Gargency, in regime di pre-launch (gate 60 giorni
Constitution v2.0 §4.1).

**Ipotesi:** team di 4-5 teammate paralleli su feature cross-layer
ridurrà il wall-clock time del 30%+ rispetto a single-session, mantenendo
qualità (test verdi al primo merge ≥ 90%, regressioni ≤ 1 per feature a
7gg).

## Pre-flight checklist (prima di ogni feature)

Eseguire **una volta** all'inizio del pilot:

- [ ] `claude --version` ≥ 2.1.32
- [ ] `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` attivo (in
      `.claude/settings.json` o env)
- [ ] `pnpm install --frozen-lockfile` passa
- [ ] `pnpm test --run` passa al baseline (zero failing su `main`)
- [ ] Hook eseguibili: `chmod +x .claude/hooks/*.sh`
- [ ] Subagent definition presenti in `.claude/agents/` (5 file)
- [ ] Working tree clean su `main`, branch creato per la feature

Eseguire **prima di ogni feature**:

- [ ] Branch dedicato `feat/<feature-slug>` creato da `main` aggiornato
- [ ] Lead briefato con AGENTS.md + questo runbook nel contesto
- [ ] Spawn prompt preparato (vedi sezione successiva)
- [ ] Timer di wall-clock attivo (per metriche)

## Spawn prompt — Feature 1: Tassonomia Sinking Funds (read-only)

**Scope minimo deliberato.** Prima feature cross-layer, no scrittura
utente, per validare il team agentico prima di esporre operazioni
distruttive.

```
Crea un Agent Team per implementare la feature "Tassonomia Sinking Funds —
schema + read" su FdF.

Modello di dominio (riferimento AGENTS.md §"Modello di dominio FdF" del
domain-dev):
- Fondo (Fund): macro-aggregato di budget con saldo target e corrente
- Categoria (Category): sotto-divisione di un Fondo
- Classe (Class): atomico, voce di spesa ricorrente o one-shot
Vincolo gerarchico: ogni Classe → una Categoria → un Fondo.

Spawna 4 teammate usando le subagent definition in .claude/agents/:

1. **backend-dev** — schema Supabase:
   - migration con 3 tabelle: funds, categories, classes
   - chiavi: id (uuid), user_id (uuid, FK auth.users), name (text),
     timestamps. categories.fund_id FK funds.id, classes.category_id
     FK categories.id
   - target_amount_cents (bigint, nullable) su funds e categories
   - current_amount_cents (bigint, default 0) su funds e categories
   - RLS user-scoped: anon DENY, authenticated SELECT/INSERT/UPDATE/
     DELETE solo su righe con user_id = auth.uid(), UPDATE con WITH
     CHECK
   - endpoint GET /api/funds che ritorna tree gerarchico
     [{fund, categories: [{category, classes: [...]}]}] per l'utente
     autenticato

2. **domain-dev** — tipi e validazione:
   - packages/domain/src/funds.ts (creare package se non esiste)
   - tipi Fund, Category, Class (branded ID, importi in Cents)
   - schemi Zod corrispondenti
   - funzione pura buildFundTree(funds, categories, classes) che
     compone il tree gerarchico (testabile in isolamento)

3. **frontend-dev** — UI read-only:
   - apps/web/app/funds/page.tsx server component
   - fetch da GET /api/funds via server-side fetch o supabase client
     server-side
   - render tree gerarchico (può essere semplice: <ul> nested) con
     saldi formattati in EUR
   - empty state in italiano se l'utente non ha ancora fondi
   - protezione auth: redirect a login se non autenticato

4. **test-engineer** — test:
   - unit test buildFundTree (vari scenari: vuoto, fondo senza
     categorie, gerarchia completa, orfani)
   - integration test GET /api/funds: verifica RLS (utente A non vede
     fondi di utente B), verifica empty state, verifica tree shape
   - se possibile, test SQL diretto su RLS per le 3 tabelle (anon
     deve essere DENY)

File ownership: vedi AGENTS.md §"File ownership convention". Due
teammate non scrivono mai sullo stesso file.

Comunicazione: protocollo ACK/PROGRESS/BLOCK/COMPLETION (vedi AGENTS.md).

Quality gate: il task-completed.sh hook deve passare prima che ciascun
teammate marchi un task come complete. Se fallisce, BLOCK e riprova.

Attendi che TUTTI i teammate completino prima di considerare la feature
chiusa. Poi spawna **security-reviewer** in modalità read-only per audit
RLS e scan PII; aspetta il suo APPROVE prima di proporre il merge a me
(CEO).

Modalità di plan approval: per backend-dev (schema + RLS), richiedi plan
approval prima dell'implementazione. Per gli altri, plan approval non
necessario (il modello di dominio è già definito sopra).
```

## Metriche di successo (per feature)

Compilate dal lead a fine feature, salvate in `state.md` di FdF.

| Metrica | Target | Misurato |
|---|---|---|
| Wall-clock time (start → ready-to-merge) | < 70% del tempo single-session stimato | _(compilare)_ |
| Test verdi al primo merge | ≥ 90% | _(compilare)_ |
| Token consumption totale (lead + 5 teammate) | < 4× single-session equivalente | _(compilare)_ |
| Conflict rate (file overwrite tra teammate) | 0 | _(compilare)_ |
| Iterazioni di rework richieste dal CEO post-PR | ≤ 2 | _(compilare)_ |
| Regressioni rilevate a 7 giorni post-merge | ≤ 1 | _(compilare)_ |
| BLOCK escalati al CEO durante esecuzione | informativo, no soglia | _(compilare)_ |

## Stima single-session di riferimento

Per calibrare il "wall-clock time" della tabella sopra, prima di ogni
feature **stima** quanto tempo userebbe un singolo agente CC senza team:

- Feature 1 (Tassonomia Sinking Funds — read): stima single-session
  3-5 ore. Target Agent Teams: < 2-3 ore wall-clock.

## Kill criterion del pilot

Il pilot si chiude (kill o promote) quando si verifica una di queste:

1. **5 feature complete** sotto Agent Teams → analisi metriche
   aggregate, decisione del Board.
2. **3 settimane di pilot** → analisi anche se < 5 feature.
3. **Wall-clock peggiore del single-session di oltre 2×** in 2+ feature
   consecutive → kill immediato.
4. **Token cost > 6× single-session** in 2+ feature consecutive → kill
   immediato (oltre Max 20x sostenibile).
5. **Regressioni > 3 per feature in 2+ feature consecutive** → kill
   immediato (qualità inaccettabile).
6. **CEO escalate > 5 per feature** in 2+ feature consecutive → kill
   immediato (overhead governance > beneficio).

## Esiti possibili

- **Kill:** pilot chiuso, ADR-0005 superseded, lessons learned
  documentate. Pattern non promosso a framework.
- **Continue:** pilot prolungato di altre 2-3 feature per dati più solidi.
- **Promote a company-level:** Agent Teams diventa modalità default per
  feature cross-layer su FdF. NON ancora promosso a holding-level
  (richiede n=2: replica su una seconda company).
- **Promote a holding-level (framework):** dopo replica su una seconda
  company. ADR holding + ratifica Board + pattern in
  `framework/stack-playbooks/`.

## Riferimenti

- ADR del pilot: `gargency-context/companies/fdf/decisions/ADR-0005-agent-teams-pilot.md`
- Governance company FdF: `gargency-context/companies/fdf/CLAUDE.md`
- Constitution v2.0: `gargency-context/CONSTITUTION.md`
- Doc Anthropic Agent Teams: https://code.claude.com/docs/en/agent-teams
- Subagent definitions: `.claude/agents/` (5 file)
- Hooks quality gate: `.claude/hooks/` (2 file)

## Diario del pilot

(Da compilare live durante il pilot — un'entry per feature.)

### Feature 1 — Tassonomia Sinking Funds (read)

- **Started:** _(compilare)_
- **Completed:** _(compilare)_
- **Outcome:** _(compilare)_
- **Metrics:** _(compilare la tabella)_
- **Lessons learned:** _(compilare)_
