# INFRA-SETUP-CHECKLIST — FdF (Finanza di Famiglia)

> Handoff dal teammate `infra-engineer` (Agent Teams pilot) al CEO.
> Subordinato a `AGENTS.md` e alla Constitution holding (`gargency-context/CONSTITUTION.md`).
> Prerequisito al merge della PR #4 e a qualunque ulteriore lavoro su backend / API.

## 1. Stato corrente

L'Agent Teams pilot ha aperto questa run con un BLOCK pre-implementazione, atteso e voluto, perché la baseline infrastrutturale richiesta dal codice non è ancora presente sul filesystem locale.

Diagnosi (cheap reads completate dal lead):

- `.env.local` contiene **solo** `VERCEL_OIDC_TOKEN` (token Vercel CLI). Mancano tutte e tre le chiavi del backend dati:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
- Non esistono credenziali admin Supabase locali. L'Agent Teams **non** è autorizzato a chiamare la Supabase Management API; quindi non può discriminare i due scenari possibili:
  1. Il progetto Supabase non è mai stato creato.
  2. Il progetto esiste sul cloud Supabase ma non è linkato a questo working tree (no `supabase/.temp/`, no `supabase link` eseguito).

In entrambi i casi la lista di azioni di seguito è la stessa: il CEO crea o conferma il progetto, copia le chiavi, popola `.env.local`, applica le migration, poi ri-spawna l'Agent Teams per il verification gate.

Il file `.env.local` **non è stato modificato** dal teammate: il CEO deve incollarci manualmente le chiavi ottenute dal dashboard del provider, perché sono materiale segreto a tutti gli effetti (vedi punto 4 del template).

## 2. Azioni richieste al CEO

Step ordinati. Dove possibile è riportato il comando esatto o il click path.

### 2.1 Creazione (o conferma) del progetto sul provider managed Postgres

Se il progetto non esiste:

1. Aprire <https://supabase.com/dashboard/projects> e cliccare **New project**.
2. Compilare il form:
   - **Name:** `Fair Value Star` (oppure il nome che preferisci; lascia esplicito al team il nome scelto).
   - **Region:** `Europe (Frankfurt) — eu-central-1`. Vincolo non negoziabile per data residency GDPR — riferimento `gargency-context/companies/fdf/decisions/ADR-0003-security-baseline.md` §2.
   - **Database password:** generare con un gestore di password (almeno 24 caratteri, no riuso). Salvarla nel vault personale; non c'è recovery lato Supabase se la perdi.
3. Confermare la creazione e attendere il provisioning (tipicamente 1–2 min).

Se il progetto esiste già su un account a te accessibile, salta direttamente al passo 2.2.

### 2.2 Verifica region post-creazione

1. Aprire `Project Settings → General` e verificare che il campo **Region** riporti esattamente `eu-central-1` o equivalente FRA.
2. Se per qualunque ragione la region risulta US, AP o altro: **ricreare il progetto da zero** seguendo 2.1. Non migrare dati: il progetto è ancora vuoto, una migrazione cross-region introduce vincoli legali che non vogliamo aprire (ADR-0003 §2). Eliminare il progetto US e ripartire.

### 2.3 Estrazione delle chiavi

1. Aprire `Project Settings → API`.
2. Copiare i tre valori, in ordine:
   - **Project URL** → andrà in `NEXT_PUBLIC_SUPABASE_URL`.
   - **Project API keys → anon (public)** → andrà in `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
   - **Project API keys → service_role (secret)** → andrà in `SUPABASE_SERVICE_ROLE_KEY`.

`service_role` è equivalente a una credenziale admin: bypassa RLS by design. Non deve mai comparire in variabili `NEXT_PUBLIC_*`, non deve mai finire in un componente client React, non deve mai essere committata.

### 2.4 Popolamento `.env.local`

Aggiungere le tre righe del template (sezione 3 di questo documento) al file `/Users/admin_gargency/dev/fdf/.env.local`, sostituendo i placeholder con i valori reali. Lasciare invariata la riga `VERCEL_OIDC_TOKEN` esistente.

Verifica veloce post-edit (deve stampare 4 righe):

```bash
grep -E '^(NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY|VERCEL_OIDC_TOKEN)=' /Users/admin_gargency/dev/fdf/.env.local | wc -l
```

`.env.local` è già coperto dal `.gitignore` del repo (commit `908ab5a`); non serve azione.

### 2.5 Applicazione delle migration

Due percorsi alternativi. Il primo è quello consigliato per questa fase (pre-CLI link).

**Percorso A — SQL Editor (consigliato per il bootstrap iniziale):**

1. Aprire `SQL Editor → New query` nel dashboard Supabase del progetto appena creato.
2. Aprire localmente `/Users/admin_gargency/dev/fdf/supabase/migrations/_BOOTSTRAP.sql` (script consolidato generato dall'infra-engineer).
3. Copiare l'intero contenuto, incollarlo nell'editor, eseguire (`Cmd+Enter`).
4. Verificare che il risultato sia "Success. No rows returned" senza messaggi di errore. Lo script è avvolto in `BEGIN; … COMMIT;` quindi un eventuale errore esegue rollback completo: nessuno stato parziale.

**Percorso B — Supabase CLI (per iterazioni successive, se preferisci link locale):**

```bash
# Una tantum, dopo aver creato il progetto
cd /Users/admin_gargency/dev/fdf
supabase link --project-ref <PROJECT_REF>
supabase db push
```

`supabase db push` applica solo le migration in ordine cronologico dal nome file, ignora `_BOOTSTRAP.sql` (il prefisso underscore lo esclude dal path migrations). I due percorsi convergono allo stesso schema.

### 2.6 Smoke test schema

Da SQL Editor, dopo l'applicazione:

```sql
SELECT count(*) FROM information_schema.tables
 WHERE table_schema = 'public'
   AND table_name IN (
     'households','household_members','accounts','funds','categories',
     'classes','transactions','budgets','sinking_funds',
     'contribution_splits','waitlist','integrations','amex_email_events'
   );
```

Atteso: `13`.

```sql
SELECT count(*) FROM pg_policies WHERE schemaname = 'public';
```

Atteso: ≥ 38 policy (10 tabelle core × 4 verbi -2 households senza CHECK su INSERT scoped + 2 per integrations + 2 per amex_email_events; numero esatto dipende dalla revisione Postgres ma >35 è il segnale corretto). Se è 0, le RLS policy non sono state applicate: ripetere l'esecuzione.

## 3. Template `.env.local` da incollare

Aggiungere queste tre righe al file esistente (non sovrascrivere la riga `VERCEL_OIDC_TOKEN`).

```dotenv
# Backend dati (managed Postgres + Auth provider, region EU Frankfurt)
NEXT_PUBLIC_SUPABASE_URL=https://<PROJECT_REF>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<ANON_KEY>

# server-only — bypassa RLS, NON deve mai comparire in NEXT_PUBLIC_*, mai in client React, mai in commit
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY>
```

Promemoria operativo: i valori reali sono recuperabili in qualunque momento da `Project Settings → API` del dashboard del provider. La password DB è invece **non recuperabile**: vive solo nel vault personale del CEO.

## 4. Re-spawn dell'Agent Teams

Una volta completati gli step 2.1–2.6 e verificato lo smoke test, l'Agent Teams pilot va ri-eseguito per chiudere il verification gate. In questa run il `qa-engineer` non è stato spawnato proprio perché il BLOCK era garantito sul backend non disponibile; ora che `.env.local` è popolato e lo schema è applicato, la prossima run può procedere fino a `pnpm test` e `pnpm build` su backend reale.

Comandi che il prossimo run dovrebbe poter eseguire senza errori di connessione:

```bash
cd /Users/admin_gargency/dev/fdf
pnpm install
pnpm lint
pnpm test
pnpm build
```

Se uno dei comandi fallisce per credenziali (errori `supabaseUrl is required` o `Invalid API key`) significa che il `.env.local` non è stato letto: verifica che il file sia in repo root, non in sotto-cartelle, e ripeti.

## 5. Riferimenti

- Decisione region EU vincolante: `gargency-context/companies/fdf/decisions/ADR-0003-security-baseline.md` §2.
- Tassonomia sinking funds e ragione del cambiamento di schema in `20260504120000`: `gargency-context/companies/fdf/decisions/ADR-0006-sinking-funds-taxonomy.md`.
- Bootstrap SQL consolidato (questa run): `supabase/migrations/_BOOTSTRAP.sql`.
- AGENTS.md (governance repo): `AGENTS.md`.
- Runbook pilot: `docs/AGENT-TEAMS-PILOT.md`.
- Kill switch: `scripts/kill-fdf.sh` (Constitution §4.6 — non toccare senza ESCALATE).
