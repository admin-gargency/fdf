# FdF — Supabase

Schema DB canonico multi-tenant multi-household, RLS GDPR-proportional.

## Struttura

```
supabase/
├── config.toml              — Supabase CLI config (ports, auth, storage)
├── migrations/              — Migrazioni SQL idempotenti (ordered)
│   ├── 20260424000001_core_schema.sql
│   ├── 20260424000002_rls_enable.sql
│   ├── 20260424000003_rls_policies.sql
│   └── 20260424000004_grants.sql
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
