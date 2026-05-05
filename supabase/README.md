# FdF — Supabase

Schema DB canonico multi-tenant multi-household, RLS GDPR-proportional.

## Struttura

```
supabase/
├── config.toml              — Supabase CLI config (ports, auth, storage)
├── migrations/              — Migrazioni SQL idempotenti (ordered)
│   ├── 20260424000001_core_schema.sql                       — tabelle core + helper current_household_ids()
│   ├── 20260424000002_rls_enable.sql                        — ENABLE + FORCE RLS, REVOKE ALL FROM authenticated
│   ├── 20260424000003_rls_policies.sql                      — policies SELECT/INSERT/UPDATE/DELETE
│   ├── 20260424000004_grants.sql                            — GRANT colonna-level espliciti
│   ├── 20260424000005_waitlist.sql                          — tabella waitlist landing
│   ├── 20260424000006_integrations_amex_email_events.sql    — ingestion Gmail OAuth + email_events
│   ├── 20260504120000_funds_categories_amounts.sql          — target/current amount cents su funds e categories
│   └── _BOOTSTRAP.sql                                       — superset idempotente delle precedenti (per `db reset`)
└── README.md                — questo file
```

## Modello dati (tassonomia `domain/taxonomy.md`)

```
households ─┬─ household_members ─── auth.users
            │
            ├─ accounts (Conto: corrente|fondi)
            │
            ├─ funds (Fondo)
            │   └─ categories (Categoria)
            │       └─ classes (Classe, tipologia: addebito_immediato|fondo_breve|fondo_lungo)
            │           ├─ budgets (monthly per class)
            │           ├─ sinking_funds (target+contribution per class)
            │           └─ transactions (Spesa)
            │
            └─ contribution_splits (FFMMO/QPMM/FFMO per member per period)
```

## Pattern RLS

Helper `public.current_household_ids()` (`SECURITY DEFINER`) restituisce gli
household ID raggiungibili da `auth.uid()` senza ricorsione.

Ogni policy usa:

```sql
USING (household_id IN (SELECT public.current_household_ids()))
```

Policy `household_members_*` usano path espliciti con `auth.uid()` perché
riguardano la relazione stessa che la helper interroga.

## Column-level GRANT (ADR-0003 §3)

`REVOKE ALL ... FROM anon, authenticated` in `000002_rls_enable.sql`.
`GRANT SELECT/INSERT/UPDATE` espliciti in `000004_grants.sql`.

Colonne NON esposte via PostgREST (solo service-role via `createAdminClient()`):
- `transactions.raw_description` — bank feed raw text, PII GDPR art. 9
- `transactions.external_id` — aggregator id, fingerprinting
- `transactions.created_by` — audit
- `accounts.account_last4` — PII bancario (mascherato comunque, ma not-exposed)
- `sinking_funds.notes` — note famiglia potenzialmente sensibili

## Apply locale

```bash
# prerequisito: supabase CLI installato (brew install supabase/tap/supabase)
supabase start              # avvia stack locale (postgres + postgrest + studio)
supabase db reset           # applica tutte le migrazioni da zero
supabase db lint            # lint SQL
```

## Apply remote (staging/prod)

```bash
supabase link --project-ref <project-ref>
supabase db push            # applica migrazioni non ancora presenti remote
```

## Smoke test RLS

```bash
# Richiede SUPABASE_URL + due JWT (household A user, household B user).
./scripts/rls-smoke-test.sh
```

Cfr. `framework/stack-playbooks/supabase/rls-smoke-tests.md`.

## Known schema issues (deferred)

Identificate durante il smoke test di Feature 2 (vedi
`docs/SMOKE-TEST-FEATURE-2.md` §"Bug Found and Fixed"). Non bloccano la
funzionalità grazie al workaround service-role nel signup, ma vanno
risolte prima di abilitare flussi multi-utente / inviti.

### 1. `households_select_member` blocca il bootstrap INSERT con RETURNING

```sql
CREATE POLICY households_select_member
  ON public.households
  FOR SELECT TO authenticated
  USING (id IN (SELECT public.current_household_ids()));
```

Quando l'utente esegue `INSERT ... RETURNING` (come fa supabase-js
`.insert(...).select(...)`), PostgreSQL applica anche la policy SELECT
USING al RETURNING. Il neo-creato household non è ancora in
`current_household_ids()` (la membership viene creata dopo) → 0 righe
restituite → PostgREST 403 "permission denied for table households"
(SQLSTATE 42501).

### 2. `household_members_insert_self_or_owner` è ricorsiva

```sql
WITH CHECK (
  user_id = auth.uid()
  OR household_id IN (
    SELECT household_id FROM public.household_members
    WHERE user_id = auth.uid() AND role = 'owner'
  )
)
```

La sub-query su `household_members` dentro la WITH CHECK su
`household_members` causa recursion → SQLSTATE 42P17 "infinite recursion
detected in policy". `auth.uid() = user_id` non short-circuita
sempre a runtime.

### Fix candidate (Feature 3+, ASK su RLS esistenti)

- **Opzione A — RPC SECURITY DEFINER:** funzione
  `public.create_household_with_owner(p_name text, p_display_name text)
  RETURNS uuid` che esegue entrambe le INSERT atomicamente bypassando
  RLS interna. Signup chiama `supabase.rpc(...)`.
- **Opzione B — riscrivere la policy ricorsiva** usando
  `current_household_ids()` (già SECURITY DEFINER, sicura nel contesto
  RLS) al posto della sub-query inline. Per il SELECT-after-INSERT
  serve comunque un fix lato applicativo (no `.select()` chained, oppure
  policy con eccezione per il creator).

Workaround attuale: `src/app/api/auth/signup/route.ts` usa
`getAdminClient()` (service role) per i due insert dopo aver validato
`auth.uid()` via SSR client. `userId` è il valore verificato, non input
utente.
