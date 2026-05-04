-- =============================================================================
-- _BOOTSTRAP.sql — Dump consolidato delle migration Supabase per FdF
-- =============================================================================
--
-- Generato dal teammate `infra-engineer` (Agent Teams pilot).
--
-- QUESTO FILE NON È UNA MIGRATION.
-- È un dump consolidato a uso esclusivo del CEO per il bootstrap one-shot via
-- SQL Editor del dashboard Supabase, quando il progetto è ancora vuoto e la
-- Supabase CLI non è linkata.
--
-- Le singole migration in questa stessa cartella restano la SORGENTE DI VERITÀ
-- per `supabase db push` e per qualunque CI futura. Il prefisso underscore
-- (`_BOOTSTRAP.sql`) esclude questo file dal path migrations della CLI, quindi
-- non rischia di essere applicato due volte.
--
-- Ordine cronologico delle migration concatenate (verbatim, senza modifiche
-- semantiche):
--   1. 20260424000001_core_schema.sql
--   2. 20260424000002_rls_enable.sql
--   3. 20260424000003_rls_policies.sql
--   4. 20260424000004_grants.sql
--   5. 20260424000005_waitlist.sql
--   6. 20260424000006_integrations_amex_email_events.sql
--   7. 20260504120000_funds_categories_amounts.sql
--
-- Note di esecuzione:
--   - L'intero blocco è avvolto in BEGIN; … COMMIT;. Un errore qualunque produce
--     rollback completo: nessuno stato parziale.
--   - `CREATE EXTENSION IF NOT EXISTS "pgcrypto"` è transaction-safe in Postgres
--     moderno (>= 9.x) ed è il pattern standard delle migration Supabase. Resta
--     dentro la transazione.
--   - Tutti gli statement DDL usano `IF NOT EXISTS` o `CREATE OR REPLACE` quando
--     possibile. Le `CREATE POLICY` non hanno `IF NOT EXISTS` (sintassi Postgres
--     non lo supporta su POLICY): in caso di re-run su DB già inizializzato, la
--     transazione fallirà con `policy "..." for table "..." already exists` e
--     il rollback ripristinerà lo stato. Comportamento atteso e safe.
--
-- WARNING (nessuno emerso durante la generazione):
--   - Le 7 migration sono pure SQL standard. Nessun metacommando psql (`\i`,
--     `\c`, `\copy`). Nessuna dipendenza cross-file irrisolvibile.
--   - L'ordine delle FK è rispettato dal naming cronologico: `households` ←
--     `household_members` ← `accounts` ← `funds` ← `categories` ← `classes` ←
--     `transactions`/`budgets`/`sinking_funds`/`contribution_splits`. Le
--     migration successive (waitlist, integrations, funds_categories_amounts)
--     sono additive su questa base.
-- =============================================================================

BEGIN;

-- ============ 20260424000001_core_schema.sql ============

-- FDFA-11 · Core schema multi-tenant multi-household
-- Ref: ADR-0003 §3 RLS, domain/taxonomy.md (Conto → Fondo → Categoria → Classe → Spesa)
-- Template: framework/stack-playbooks/supabase/templates/rls-safe-migration.sql

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- Helper: updated_at touch trigger
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- households — tenant boundary
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.households (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL CHECK (length(btrim(name)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_households_updated_at
  BEFORE UPDATE ON public.households
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- household_members — (user_id, household_id, role)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.household_members (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid        NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role         text        NOT NULL DEFAULT 'member'
                 CHECK (role IN ('owner', 'member', 'viewer')),
  display_name text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_household_members_user
  ON public.household_members (user_id);

CREATE TRIGGER trg_household_members_updated_at
  BEFORE UPDATE ON public.household_members
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- accounts (Conto) — conto bancario; kind = corrente | fondi
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.accounts (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id   uuid        NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  name           text        NOT NULL CHECK (length(btrim(name)) > 0),
  bank           text,
  account_last4  text        CHECK (account_last4 IS NULL OR account_last4 ~ '^[0-9]{4}$'),
  kind           text        NOT NULL CHECK (kind IN ('corrente', 'fondi')),
  scope          text        NOT NULL DEFAULT 'family' CHECK (scope IN ('family', 'personal')),
  owner_user_id  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  currency       text        NOT NULL DEFAULT 'EUR' CHECK (currency ~ '^[A-Z]{3}$'),
  archived_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, name)
);

CREATE INDEX IF NOT EXISTS idx_accounts_household ON public.accounts (household_id);

CREATE TRIGGER trg_accounts_updated_at
  BEFORE UPDATE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- funds (Fondo) — aggregato per scopo
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.funds (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id        uuid        NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  default_account_id  uuid        REFERENCES public.accounts(id) ON DELETE SET NULL,
  name                text        NOT NULL CHECK (length(btrim(name)) > 0),
  sort_order          integer     NOT NULL DEFAULT 0,
  archived_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, name)
);

CREATE INDEX IF NOT EXISTS idx_funds_household ON public.funds (household_id);

CREATE TRIGGER trg_funds_updated_at
  BEFORE UPDATE ON public.funds
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- categories (Categoria) — taglio funzionale orizzontale
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.categories (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid        NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  fund_id      uuid        NOT NULL REFERENCES public.funds(id) ON DELETE CASCADE,
  name         text        NOT NULL CHECK (length(btrim(name)) > 0),
  sort_order   integer     NOT NULL DEFAULT 0,
  archived_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fund_id, name)
);

CREATE INDEX IF NOT EXISTS idx_categories_household ON public.categories (household_id);
CREATE INDEX IF NOT EXISTS idx_categories_fund      ON public.categories (fund_id);

CREATE TRIGGER trg_categories_updated_at
  BEFORE UPDATE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- classes (Classe) — foglia, unità di budget; tipologia determina UX sinking
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.classes (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid        NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  category_id  uuid        NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  name         text        NOT NULL CHECK (length(btrim(name)) > 0),
  tipologia    text        NOT NULL
                 CHECK (tipologia IN ('addebito_immediato', 'fondo_breve', 'fondo_lungo')),
  sort_order   integer     NOT NULL DEFAULT 0,
  archived_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category_id, name)
);

CREATE INDEX IF NOT EXISTS idx_classes_household ON public.classes (household_id);
CREATE INDEX IF NOT EXISTS idx_classes_category  ON public.classes (category_id);

CREATE TRIGGER trg_classes_updated_at
  BEFORE UPDATE ON public.classes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- transactions (Spesa) — singola transazione
-- amount_cents bigint signed: negativo = outflow, positivo = inflow.
-- raw_description è PII-sensitive (descrizione originale bank feed) → NO GRANT a anon/authenticated.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.transactions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id     uuid        NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  account_id       uuid        NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  class_id         uuid        REFERENCES public.classes(id) ON DELETE SET NULL,
  booked_at        date        NOT NULL,
  amount_cents     bigint      NOT NULL,
  currency         text        NOT NULL DEFAULT 'EUR' CHECK (currency ~ '^[A-Z]{3}$'),
  description      text,
  raw_description  text,
  external_id      text,
  source           text        NOT NULL DEFAULT 'manual'
                     CHECK (source IN ('manual', 'psd2', 'amex_pdf', 'import_csv')),
  needs_review     boolean     NOT NULL DEFAULT false,
  created_by       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_account_external
  ON public.transactions (account_id, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_household_date
  ON public.transactions (household_id, booked_at DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_class
  ON public.transactions (class_id);

CREATE INDEX IF NOT EXISTS idx_transactions_review
  ON public.transactions (household_id)
  WHERE needs_review;

CREATE TRIGGER trg_transactions_updated_at
  BEFORE UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- budgets — valore mensile per Classe. period = primo giorno del mese.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.budgets (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid        NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  class_id     uuid        NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  period       date        NOT NULL CHECK (period = date_trunc('month', period)::date),
  amount_cents bigint      NOT NULL CHECK (amount_cents >= 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, period)
);

CREATE INDEX IF NOT EXISTS idx_budgets_household_period
  ON public.budgets (household_id, period);

CREATE TRIGGER trg_budgets_updated_at
  BEFORE UPDATE ON public.budgets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- sinking_funds — balance target per Classe con tipologia fondo_breve|fondo_lungo.
-- notes può contenere PII (aspettative famiglia) → NO GRANT a anon/authenticated.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.sinking_funds (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id                uuid        NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  class_id                    uuid        NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  target_cents                bigint      NOT NULL CHECK (target_cents >= 0),
  target_date                 date,
  monthly_contribution_cents  bigint      NOT NULL DEFAULT 0 CHECK (monthly_contribution_cents >= 0),
  notes                       text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id)
);

CREATE INDEX IF NOT EXISTS idx_sinking_funds_household
  ON public.sinking_funds (household_id);

CREATE TRIGGER trg_sinking_funds_updated_at
  BEFORE UPDATE ON public.sinking_funds
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- contribution_splits — FFMMO/QPMM/FFMO per household_member per periodo.
-- Modello partner (es. Antonio/Annalisa): split contributivo coniugi.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.contribution_splits (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id          uuid        NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  member_id             uuid        NOT NULL REFERENCES public.household_members(id) ON DELETE CASCADE,
  period                date        NOT NULL CHECK (period = date_trunc('month', period)::date),
  kind                  text        NOT NULL CHECK (kind IN ('ffmmo', 'qpmm', 'ffmo')),
  share_pct             numeric(5,2) NOT NULL CHECK (share_pct BETWEEN 0 AND 100),
  monthly_amount_cents  bigint      NOT NULL DEFAULT 0 CHECK (monthly_amount_cents >= 0),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, period, kind)
);

CREATE INDEX IF NOT EXISTS idx_contribution_splits_household_period
  ON public.contribution_splits (household_id, period);

CREATE TRIGGER trg_contribution_splits_updated_at
  BEFORE UPDATE ON public.contribution_splits
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Helper: households reachable by auth.uid() senza ricorsione RLS.
-- SECURITY DEFINER bypassa RLS interno su household_members, necessario perché
-- la policy di household_members userà questa funzione per evitare recursion.
-- Definita dopo la creazione di household_members perché il body SQL è
-- validato al CREATE time.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.current_household_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT household_id
  FROM public.household_members
  WHERE user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.current_household_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_household_ids() TO authenticated;

-- ============ 20260424000002_rls_enable.sql ============

-- FDFA-11 · Enable Row Level Security + revoca default privileges
-- Pattern: partiamo chiusi (REVOKE ALL) e riapriamo esplicitamente in 000004_grants.sql.
-- Ref: framework/stack-playbooks/supabase/templates/rls-safe-migration.sql §3

ALTER TABLE public.households           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.household_members    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funds                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classes              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budgets              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sinking_funds        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contribution_splits  ENABLE ROW LEVEL SECURITY;

-- Supabase: force RLS anche per il ruolo owner della tabella; impedisce bypass accidentale.
ALTER TABLE public.households           FORCE ROW LEVEL SECURITY;
ALTER TABLE public.household_members    FORCE ROW LEVEL SECURITY;
ALTER TABLE public.accounts             FORCE ROW LEVEL SECURITY;
ALTER TABLE public.funds                FORCE ROW LEVEL SECURITY;
ALTER TABLE public.categories           FORCE ROW LEVEL SECURITY;
ALTER TABLE public.classes              FORCE ROW LEVEL SECURITY;
ALTER TABLE public.transactions         FORCE ROW LEVEL SECURITY;
ALTER TABLE public.budgets              FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sinking_funds        FORCE ROW LEVEL SECURITY;
ALTER TABLE public.contribution_splits  FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.households          FROM anon, authenticated;
REVOKE ALL ON public.household_members   FROM anon, authenticated;
REVOKE ALL ON public.accounts            FROM anon, authenticated;
REVOKE ALL ON public.funds               FROM anon, authenticated;
REVOKE ALL ON public.categories          FROM anon, authenticated;
REVOKE ALL ON public.classes             FROM anon, authenticated;
REVOKE ALL ON public.transactions        FROM anon, authenticated;
REVOKE ALL ON public.budgets             FROM anon, authenticated;
REVOKE ALL ON public.sinking_funds       FROM anon, authenticated;
REVOKE ALL ON public.contribution_splits FROM anon, authenticated;

-- ============ 20260424000003_rls_policies.sql ============

-- FDFA-11 · RLS policies — pattern household scope per GDPR art. 9 (ADR-0003 §3)
--
-- Pattern canonico: household_id IN (SELECT public.current_household_ids())
-- La funzione è SECURITY DEFINER e bypassa RLS interno su household_members,
-- quindi è safe usarla anche dentro le policy di household_members.
--
-- Per ciascuna tabella: SELECT + INSERT + UPDATE + DELETE.
-- Le mutazioni richiedono household membership sia in USING (riga pre-esistente)
-- che in WITH CHECK (riga post-mutazione), per impedire spostamenti cross-household.

-- ---------------------------------------------------------------------------
-- households
-- ---------------------------------------------------------------------------

CREATE POLICY households_select_member
  ON public.households
  FOR SELECT TO authenticated
  USING (id IN (SELECT public.current_household_ids()));

-- Creazione household è un'operazione di onboarding: l'utente crea il suo
-- household e poi si self-joina via insert in household_members.
CREATE POLICY households_insert_any_authenticated
  ON public.households
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY households_update_member
  ON public.households
  FOR UPDATE TO authenticated
  USING (id IN (SELECT public.current_household_ids()))
  WITH CHECK (id IN (SELECT public.current_household_ids()));

CREATE POLICY households_delete_owner
  ON public.households
  FOR DELETE TO authenticated
  USING (
    id IN (
      SELECT household_id FROM public.household_members
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

-- ---------------------------------------------------------------------------
-- household_members
-- ---------------------------------------------------------------------------

CREATE POLICY household_members_select_member
  ON public.household_members
  FOR SELECT TO authenticated
  USING (household_id IN (SELECT public.current_household_ids()));

-- INSERT: l'utente può aggiungere sé stesso al proprio primo household (bootstrap),
-- oppure un owner esistente può aggiungere altri membri.
CREATE POLICY household_members_insert_self_or_owner
  ON public.household_members
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR household_id IN (
      SELECT household_id FROM public.household_members
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

CREATE POLICY household_members_update_owner
  ON public.household_members
  FOR UPDATE TO authenticated
  USING (
    household_id IN (
      SELECT household_id FROM public.household_members
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  )
  WITH CHECK (
    household_id IN (
      SELECT household_id FROM public.household_members
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

CREATE POLICY household_members_delete_self_or_owner
  ON public.household_members
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR household_id IN (
      SELECT household_id FROM public.household_members
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

-- ---------------------------------------------------------------------------
-- accounts
-- ---------------------------------------------------------------------------

CREATE POLICY accounts_select_member
  ON public.accounts
  FOR SELECT TO authenticated
  USING (household_id IN (SELECT public.current_household_ids()));

CREATE POLICY accounts_insert_member
  ON public.accounts
  FOR INSERT TO authenticated
  WITH CHECK (household_id IN (SELECT public.current_household_ids()));

CREATE POLICY accounts_update_member
  ON public.accounts
  FOR UPDATE TO authenticated
  USING (household_id IN (SELECT public.current_household_ids()))
  WITH CHECK (household_id IN (SELECT public.current_household_ids()));

CREATE POLICY accounts_delete_member
  ON public.accounts
  FOR DELETE TO authenticated
  USING (household_id IN (SELECT public.current_household_ids()));

-- ---------------------------------------------------------------------------
-- funds
-- ---------------------------------------------------------------------------

CREATE POLICY funds_select_member
  ON public.funds
  FOR SELECT TO authenticated
  USING (household_id IN (SELECT public.current_household_ids()));

CREATE POLICY funds_insert_member
  ON public.funds
  FOR INSERT TO authenticated
  WITH CHECK (household_id IN (SELECT public.current_household_ids()));

CREATE POLICY funds_update_member
  ON public.funds
  FOR UPDATE TO authenticated
  USING (household_id IN (SELECT public.current_household_ids()))
  WITH CHECK (household_id IN (SELECT public.current_household_ids()));

CREATE POLICY funds_delete_member
  ON public.funds
  FOR DELETE TO authenticated
  USING (household_id IN (SELECT public.current_household_ids()));

-- ---------------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------------

CREATE POLICY categories_select_member
  ON public.categories
  FOR SELECT TO authenticated
  USING (household_id IN (SELECT public.current_household_ids()));

CREATE POLICY categories_insert_member
  ON public.categories
  FOR INSERT TO authenticated
  WITH CHECK (household_id IN (SELECT public.current_household_ids()));

CREATE POLICY categories_update_member
  ON public.categories
  FOR UPDATE TO authenticated
  USING (household_id IN (SELECT public.current_household_ids()))
  WITH CHECK (household_id IN (SELECT public.current_household_ids()));

CREATE POLICY categories_delete_member
  ON public.categories
  FOR DELETE TO authenticated
  USING (household_id IN (SELECT public.current_household_ids()));

-- ---------------------------------------------------------------------------
-- classes
-- ---------------------------------------------------------------------------

CREATE POLICY classes_select_member
  ON public.classes
  FOR SELECT TO authenticated
  USING (household_id IN (SELECT public.current_household_ids()));

CREATE POLICY classes_insert_member
  ON public.classes
  FOR INSERT TO authenticated
  WITH CHECK (household_id IN (SELECT public.current_household_ids()));

CREATE POLICY classes_update_member
  ON public.classes
  FOR UPDATE TO authenticated
  USING (household_id IN (SELECT public.current_household_ids()))
  WITH CHECK (household_id IN (SELECT public.current_household_ids()));

CREATE POLICY classes_delete_member
  ON public.classes
  FOR DELETE TO authenticated
  USING (household_id IN (SELECT public.current_household_ids()));

-- ---------------------------------------------------------------------------
-- transactions
-- ---------------------------------------------------------------------------

CREATE POLICY transactions_select_member
  ON public.transactions
  FOR SELECT TO authenticated
  USING (household_id IN (SELECT public.current_household_ids()));

CREATE POLICY transactions_insert_member
  ON public.transactions
  FOR INSERT TO authenticated
  WITH CHECK (household_id IN (SELECT public.current_household_ids()));

CREATE POLICY transactions_update_member
  ON public.transactions
  FOR UPDATE TO authenticated
  USING (household_id IN (SELECT public.current_household_ids()))
  WITH CHECK (household_id IN (SELECT public.current_household_ids()));

CREATE POLICY transactions_delete_member
  ON public.transactions
  FOR DELETE TO authenticated
  USING (household_id IN (SELECT public.current_household_ids()));

-- ---------------------------------------------------------------------------
-- budgets
-- ---------------------------------------------------------------------------

CREATE POLICY budgets_select_member
  ON public.budgets
  FOR SELECT TO authenticated
  USING (household_id IN (SELECT public.current_household_ids()));

CREATE POLICY budgets_insert_member
  ON public.budgets
  FOR INSERT TO authenticated
  WITH CHECK (household_id IN (SELECT public.current_household_ids()));

CREATE POLICY budgets_update_member
  ON public.budgets
  FOR UPDATE TO authenticated
  USING (household_id IN (SELECT public.current_household_ids()))
  WITH CHECK (household_id IN (SELECT public.current_household_ids()));

CREATE POLICY budgets_delete_member
  ON public.budgets
  FOR DELETE TO authenticated
  USING (household_id IN (SELECT public.current_household_ids()));

-- ---------------------------------------------------------------------------
-- sinking_funds
-- ---------------------------------------------------------------------------

CREATE POLICY sinking_funds_select_member
  ON public.sinking_funds
  FOR SELECT TO authenticated
  USING (household_id IN (SELECT public.current_household_ids()));

CREATE POLICY sinking_funds_insert_member
  ON public.sinking_funds
  FOR INSERT TO authenticated
  WITH CHECK (household_id IN (SELECT public.current_household_ids()));

CREATE POLICY sinking_funds_update_member
  ON public.sinking_funds
  FOR UPDATE TO authenticated
  USING (household_id IN (SELECT public.current_household_ids()))
  WITH CHECK (household_id IN (SELECT public.current_household_ids()));

CREATE POLICY sinking_funds_delete_member
  ON public.sinking_funds
  FOR DELETE TO authenticated
  USING (household_id IN (SELECT public.current_household_ids()));

-- ---------------------------------------------------------------------------
-- contribution_splits
-- ---------------------------------------------------------------------------

CREATE POLICY contribution_splits_select_member
  ON public.contribution_splits
  FOR SELECT TO authenticated
  USING (household_id IN (SELECT public.current_household_ids()));

CREATE POLICY contribution_splits_insert_member
  ON public.contribution_splits
  FOR INSERT TO authenticated
  WITH CHECK (household_id IN (SELECT public.current_household_ids()));

CREATE POLICY contribution_splits_update_member
  ON public.contribution_splits
  FOR UPDATE TO authenticated
  USING (household_id IN (SELECT public.current_household_ids()))
  WITH CHECK (household_id IN (SELECT public.current_household_ids()));

CREATE POLICY contribution_splits_delete_member
  ON public.contribution_splits
  FOR DELETE TO authenticated
  USING (household_id IN (SELECT public.current_household_ids()));

-- ============ 20260424000004_grants.sql ============

-- FDFA-11 · Column-level GRANTs (PostgREST exposure)
-- Ref: ADR-0003 §3 "PII/flags mai a anon/authenticated"
-- Checklist: ogni colonna esposta è deliberatamente GRANTed.
--
-- Ruolo anon: NON ha accesso a nessuna tabella utente (RLS comunque bloccherebbe,
-- ma chiudiamo anche la superficie PostgREST).
-- Ruolo authenticated: solo colonne non sensibili elencate qui.
--
-- Colonne deliberatamente NON concesse a authenticated:
--   - transactions.raw_description (descrizione bank feed, PII GDPR art. 9)
--   - transactions.external_id (aggregator/bank internal id, fingerprinting)
--   - transactions.created_by (audit, non esposto al client)
--   - accounts.account_last4 (last4 del conto, PII bancario limitato)
--   - sinking_funds.notes (aspettative famiglia, potenzialmente sensibile)
-- Queste restano visibili via service-role tramite createAdminClient().

-- ---------------------------------------------------------------------------
-- households
-- ---------------------------------------------------------------------------

GRANT SELECT (id, name, created_at, updated_at)
  ON public.households TO authenticated;

GRANT INSERT (name)
  ON public.households TO authenticated;

GRANT UPDATE (name)
  ON public.households TO authenticated;

GRANT DELETE
  ON public.households TO authenticated;

-- ---------------------------------------------------------------------------
-- household_members
-- ---------------------------------------------------------------------------

GRANT SELECT (id, household_id, user_id, role, display_name, created_at, updated_at)
  ON public.household_members TO authenticated;

GRANT INSERT (household_id, user_id, role, display_name)
  ON public.household_members TO authenticated;

GRANT UPDATE (role, display_name)
  ON public.household_members TO authenticated;

GRANT DELETE
  ON public.household_members TO authenticated;

-- ---------------------------------------------------------------------------
-- accounts — account_last4 escluso dalle colonne esposte al client
-- ---------------------------------------------------------------------------

GRANT SELECT (id, household_id, name, bank, kind, scope, owner_user_id,
              currency, archived_at, created_at, updated_at)
  ON public.accounts TO authenticated;

GRANT INSERT (household_id, name, bank, account_last4, kind, scope,
              owner_user_id, currency)
  ON public.accounts TO authenticated;

GRANT UPDATE (name, bank, account_last4, kind, scope, owner_user_id,
              currency, archived_at)
  ON public.accounts TO authenticated;

GRANT DELETE
  ON public.accounts TO authenticated;

-- ---------------------------------------------------------------------------
-- funds
-- ---------------------------------------------------------------------------

GRANT SELECT (id, household_id, default_account_id, name, sort_order,
              archived_at, created_at, updated_at)
  ON public.funds TO authenticated;

GRANT INSERT (household_id, default_account_id, name, sort_order)
  ON public.funds TO authenticated;

GRANT UPDATE (default_account_id, name, sort_order, archived_at)
  ON public.funds TO authenticated;

GRANT DELETE
  ON public.funds TO authenticated;

-- ---------------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------------

GRANT SELECT (id, household_id, fund_id, name, sort_order, archived_at,
              created_at, updated_at)
  ON public.categories TO authenticated;

GRANT INSERT (household_id, fund_id, name, sort_order)
  ON public.categories TO authenticated;

GRANT UPDATE (fund_id, name, sort_order, archived_at)
  ON public.categories TO authenticated;

GRANT DELETE
  ON public.categories TO authenticated;

-- ---------------------------------------------------------------------------
-- classes
-- ---------------------------------------------------------------------------

GRANT SELECT (id, household_id, category_id, name, tipologia, sort_order,
              archived_at, created_at, updated_at)
  ON public.classes TO authenticated;

GRANT INSERT (household_id, category_id, name, tipologia, sort_order)
  ON public.classes TO authenticated;

GRANT UPDATE (category_id, name, tipologia, sort_order, archived_at)
  ON public.classes TO authenticated;

GRANT DELETE
  ON public.classes TO authenticated;

-- ---------------------------------------------------------------------------
-- transactions — raw_description, external_id, created_by esclusi dal SELECT
-- ---------------------------------------------------------------------------

GRANT SELECT (id, household_id, account_id, class_id, booked_at, amount_cents,
              currency, description, source, needs_review, created_at, updated_at)
  ON public.transactions TO authenticated;

-- Insert: il client può fornire description manuale; raw_description e external_id
-- sono scritti da ingestion server-side (service-role), non da client.
GRANT INSERT (household_id, account_id, class_id, booked_at, amount_cents,
              currency, description, source, needs_review)
  ON public.transactions TO authenticated;

-- Update: il client può solo rivedere classificazione + descrizione user-facing
-- e togliere needs_review. Non tocca raw_description / external_id / source.
GRANT UPDATE (class_id, description, needs_review)
  ON public.transactions TO authenticated;

GRANT DELETE
  ON public.transactions TO authenticated;

-- ---------------------------------------------------------------------------
-- budgets
-- ---------------------------------------------------------------------------

GRANT SELECT (id, household_id, class_id, period, amount_cents,
              created_at, updated_at)
  ON public.budgets TO authenticated;

GRANT INSERT (household_id, class_id, period, amount_cents)
  ON public.budgets TO authenticated;

GRANT UPDATE (amount_cents)
  ON public.budgets TO authenticated;

GRANT DELETE
  ON public.budgets TO authenticated;

-- ---------------------------------------------------------------------------
-- sinking_funds — notes escluso dal SELECT (potenziale PII)
-- ---------------------------------------------------------------------------

GRANT SELECT (id, household_id, class_id, target_cents, target_date,
              monthly_contribution_cents, created_at, updated_at)
  ON public.sinking_funds TO authenticated;

GRANT INSERT (household_id, class_id, target_cents, target_date,
              monthly_contribution_cents, notes)
  ON public.sinking_funds TO authenticated;

GRANT UPDATE (target_cents, target_date, monthly_contribution_cents, notes)
  ON public.sinking_funds TO authenticated;

GRANT DELETE
  ON public.sinking_funds TO authenticated;

-- ---------------------------------------------------------------------------
-- contribution_splits
-- ---------------------------------------------------------------------------

GRANT SELECT (id, household_id, member_id, period, kind, share_pct,
              monthly_amount_cents, created_at, updated_at)
  ON public.contribution_splits TO authenticated;

GRANT INSERT (household_id, member_id, period, kind, share_pct,
              monthly_amount_cents)
  ON public.contribution_splits TO authenticated;

GRANT UPDATE (share_pct, monthly_amount_cents)
  ON public.contribution_splits TO authenticated;

GRANT DELETE
  ON public.contribution_splits TO authenticated;

-- ============ 20260424000005_waitlist.sql ============

-- FDFA-6 · Landing waitlist (pre-auth signups)
-- Ref: ADR-0001 §K1 (count waitlist), ADR-0003 §GDPR-proportional
-- Questa tabella vive fuori dal modello auth'd (households/members): nessun RLS
-- per utenti anon/authenticated, accesso solo via service-role da /api/waitlist
-- e /admin/waitlist. Retention 24 mesi (vedi §cleanup job in H2).

CREATE TABLE IF NOT EXISTS public.waitlist (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text        NOT NULL CHECK (email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  source      text,
  user_agent  text,
  ip_hash     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  UNIQUE (email)
);

CREATE INDEX IF NOT EXISTS idx_waitlist_created_at
  ON public.waitlist (created_at DESC);

-- RLS ON con nessuna policy = chiusura totale per anon/authenticated.
-- Service-role bypassa RLS by design (PostgREST + createAdminClient()).
ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;

-- Explicit revoke per coerenza con template FDFA-11 000002_rls_enable.sql
REVOKE ALL ON public.waitlist FROM anon, authenticated;

-- ============ 20260424000006_integrations_amex_email_events.sql ============

-- FDFA-30 · Ingestion Amex email alert — schema integrations + amex_email_events
-- Ref: ADR-0005 §Decision opzione D (dual fallback: PDF + email alert + CSV manual)
-- Ref: ADR-0003 §3 RLS household-scoped + token encrypted at rest
-- Pattern: estende FDFA-11 (core_schema + rls_policies + grants) mantenendo
-- la stessa regola `household_id IN (SELECT public.current_household_ids())`.
--
-- Due tabelle in questa migrazione:
--   1. integrations         — OAuth connection state + refresh/access token
--                             encrypted at rest (bytea, pgp_sym_encrypt app-side).
--   2. amex_email_events    — append-only log dei messaggi Gmail processati,
--                             dedupe via PRIMARY KEY (household_id, msg_id).
--
-- Token crypto: i campi *_encrypted sono bytea. La cifratura/decifratura vive
-- nel client admin (createAdminClient, ADR-0003 §3), usando una master key
-- da `SUPABASE_INGESTION_KMS_KEY` (Vault Supabase o GCP KMS in futuro).
-- La migrazione non impone l'algoritmo, ma la colonna è opaque per RLS/PostgREST.

-- ---------------------------------------------------------------------------
-- integrations — OAuth connection per household × provider × account
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.integrations (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id              uuid        NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  provider                  text        NOT NULL CHECK (provider IN ('gmail')),
  account_email             text        NOT NULL CHECK (length(btrim(account_email)) > 0),
  status                    text        NOT NULL DEFAULT 'active'
                                        CHECK (status IN ('active', 'revoked', 'error')),
  scope                     text        NOT NULL,
  refresh_token_encrypted   bytea       NOT NULL,
  access_token_encrypted    bytea,
  access_token_expires_at   timestamptz,
  last_synced_at            timestamptz,
  last_error                text,
  connected_by_user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, provider, account_email)
);

CREATE INDEX IF NOT EXISTS idx_integrations_household_provider_status
  ON public.integrations (household_id, provider, status);

CREATE INDEX IF NOT EXISTS idx_integrations_active_sync
  ON public.integrations (last_synced_at)
  WHERE status = 'active';

CREATE TRIGGER trg_integrations_updated_at
  BEFORE UPDATE ON public.integrations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMENT ON TABLE public.integrations IS
  'OAuth connection state per household × provider. Refresh/access token cifrati app-side (pgp_sym_encrypt con SUPABASE_INGESTION_KMS_KEY). RLS household-scoped.';
COMMENT ON COLUMN public.integrations.refresh_token_encrypted IS
  'Token OAuth refresh cifrato. Decifratura solo via service-role client.';
COMMENT ON COLUMN public.integrations.access_token_encrypted IS
  'Cache opzionale del token di accesso corrente. Nullable: rigenerabile dal refresh token.';

-- ---------------------------------------------------------------------------
-- amex_email_events — dedupe log per email alert Amex processate
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.amex_email_events (
  household_id        uuid        NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  msg_id              text        NOT NULL CHECK (length(btrim(msg_id)) > 0),
  integration_id      uuid        NOT NULL REFERENCES public.integrations(id) ON DELETE CASCADE,
  received_at         timestamptz NOT NULL,
  parse_status        text        NOT NULL DEFAULT 'parsed'
                                  CHECK (parse_status IN ('parsed', 'unrecognized', 'error')),
  parse_error         text,
  parsed_merchant     text,
  parsed_amount_cents integer,
  parsed_currency     text        DEFAULT 'EUR'
                                  CHECK (parsed_currency IS NULL OR length(parsed_currency) = 3),
  parsed_card_last4   text        CHECK (parsed_card_last4 IS NULL OR parsed_card_last4 ~ '^[0-9]{4}$'),
  raw_subject         text,
  raw_sender          text,
  transaction_id      uuid        REFERENCES public.transactions(id) ON DELETE SET NULL,
  parsed_at           timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, msg_id)
);

CREATE INDEX IF NOT EXISTS idx_amex_email_events_household_received
  ON public.amex_email_events (household_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_amex_email_events_integration
  ON public.amex_email_events (integration_id);

CREATE INDEX IF NOT EXISTS idx_amex_email_events_unreconciled
  ON public.amex_email_events (household_id, received_at DESC)
  WHERE transaction_id IS NULL AND parse_status = 'parsed';

COMMENT ON TABLE public.amex_email_events IS
  'Append-only log dei messaggi Gmail alert Amex. Dedupe via PK (household_id, msg_id). Scritto da service-role (cron), letto da authenticated per review queue.';
COMMENT ON COLUMN public.amex_email_events.raw_subject IS
  'Subject email originale, PII — non esposto a authenticated via GRANT.';
COMMENT ON COLUMN public.amex_email_events.raw_sender IS
  'Sender email originale, fingerprinting — non esposto a authenticated via GRANT.';

-- ---------------------------------------------------------------------------
-- RLS enable + REVOKE anon/authenticated
-- ---------------------------------------------------------------------------

ALTER TABLE public.integrations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integrations       FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.amex_email_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amex_email_events  FORCE  ROW LEVEL SECURITY;

REVOKE ALL ON public.integrations      FROM anon, authenticated;
REVOKE ALL ON public.amex_email_events FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS policies — integrations
-- Il client può VEDERE lo stato dell'integrazione (per UI reconnect CTA)
-- ma NON può mai toccare i token. Scritture solo service-role (OAuth callback).
-- ---------------------------------------------------------------------------

CREATE POLICY integrations_select_member
  ON public.integrations
  FOR SELECT TO authenticated
  USING (household_id IN (SELECT public.current_household_ids()));

CREATE POLICY integrations_delete_member
  ON public.integrations
  FOR DELETE TO authenticated
  USING (household_id IN (SELECT public.current_household_ids()));

-- Nessuna INSERT/UPDATE policy per authenticated: scritture solo via service-role.
-- Il client disconnette → DELETE riga → OAuth callback ricrea la riga al re-connect.

-- ---------------------------------------------------------------------------
-- RLS policies — amex_email_events
-- Il client può VEDERE gli eventi (per review queue FDFA-32) e può UPDATE
-- solo la FK transaction_id quando riconcilia manualmente. INSERT/DELETE sono
-- server-only (cron + retention).
-- ---------------------------------------------------------------------------

CREATE POLICY amex_email_events_select_member
  ON public.amex_email_events
  FOR SELECT TO authenticated
  USING (household_id IN (SELECT public.current_household_ids()));

CREATE POLICY amex_email_events_update_member
  ON public.amex_email_events
  FOR UPDATE TO authenticated
  USING (household_id IN (SELECT public.current_household_ids()))
  WITH CHECK (household_id IN (SELECT public.current_household_ids()));

-- ---------------------------------------------------------------------------
-- Column-level GRANTs
-- Ref: ADR-0003 §3 — PII/flags mai a anon/authenticated.
--
-- Esposti a authenticated (integrations):
--   id, household_id, provider, account_email, status, scope,
--   access_token_expires_at, last_synced_at, last_error,
--   connected_by_user_id, created_at, updated_at
-- Deliberatamente ESCLUSI (server-only):
--   refresh_token_encrypted, access_token_encrypted
--
-- Esposti a authenticated (amex_email_events):
--   household_id, msg_id, integration_id, received_at, parse_status,
--   parse_error, parsed_merchant, parsed_amount_cents, parsed_currency,
--   parsed_card_last4, transaction_id, parsed_at, created_at
-- Deliberatamente ESCLUSI (PII):
--   raw_subject, raw_sender
-- ---------------------------------------------------------------------------

GRANT SELECT (id, household_id, provider, account_email, status, scope,
              access_token_expires_at, last_synced_at, last_error,
              connected_by_user_id, created_at, updated_at)
  ON public.integrations TO authenticated;

GRANT DELETE
  ON public.integrations TO authenticated;

GRANT SELECT (household_id, msg_id, integration_id, received_at, parse_status,
              parse_error, parsed_merchant, parsed_amount_cents,
              parsed_currency, parsed_card_last4, transaction_id,
              parsed_at, created_at)
  ON public.amex_email_events TO authenticated;

GRANT UPDATE (transaction_id)
  ON public.amex_email_events TO authenticated;

-- ============ 20260504120000_funds_categories_amounts.sql ============

-- 20260504120000_funds_categories_amounts.sql
-- Aggiunge colonne di importo a funds e categories per la pagina MVP
-- sinking funds (FDFA-SF-MVP). Solo funds e categories — ADR-0006 Decision 1.
--
-- ROLLBACK:
--   ALTER TABLE public.categories DROP COLUMN IF EXISTS current_amount_cents;
--   ALTER TABLE public.categories DROP COLUMN IF EXISTS target_amount_cents;
--   ALTER TABLE public.funds      DROP COLUMN IF EXISTS current_amount_cents;
--   ALTER TABLE public.funds      DROP COLUMN IF EXISTS target_amount_cents;
--   REVOKE UPDATE (target_amount_cents, current_amount_cents) ON public.categories FROM authenticated;
--   REVOKE UPDATE (target_amount_cents, current_amount_cents) ON public.funds      FROM authenticated;
--   REVOKE INSERT (target_amount_cents, current_amount_cents) ON public.categories FROM authenticated;
--   REVOKE INSERT (target_amount_cents, current_amount_cents) ON public.funds      FROM authenticated;
--   REVOKE SELECT (target_amount_cents, current_amount_cents) ON public.categories FROM authenticated;
--   REVOKE SELECT (target_amount_cents, current_amount_cents) ON public.funds      FROM authenticated;

-- ---------------------------------------------------------------------------
-- funds
-- target_amount_cents: bigint NULL (obiettivo facoltativo per il fondo)
-- current_amount_cents: bigint NOT NULL DEFAULT 0 (saldo corrente snapshot)
-- ---------------------------------------------------------------------------

ALTER TABLE public.funds
  ADD COLUMN IF NOT EXISTS target_amount_cents  bigint,
  ADD COLUMN IF NOT EXISTS current_amount_cents bigint NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- categories
-- Stesso pattern di funds: target nullable, current non-null con default 0.
-- ---------------------------------------------------------------------------

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS target_amount_cents  bigint,
  ADD COLUMN IF NOT EXISTS current_amount_cents bigint NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- GRANT column-level per authenticated
-- Additive rispetto a 20260424000004_grants.sql.
-- Solo funds e categories — nessun GRANT su classes (ADR-0006 Decision 1).
-- ---------------------------------------------------------------------------

-- funds
GRANT SELECT (target_amount_cents, current_amount_cents)
  ON public.funds TO authenticated;

GRANT INSERT (target_amount_cents, current_amount_cents)
  ON public.funds TO authenticated;

GRANT UPDATE (target_amount_cents, current_amount_cents)
  ON public.funds TO authenticated;

-- categories
GRANT SELECT (target_amount_cents, current_amount_cents)
  ON public.categories TO authenticated;

GRANT INSERT (target_amount_cents, current_amount_cents)
  ON public.categories TO authenticated;

GRANT UPDATE (target_amount_cents, current_amount_cents)
  ON public.categories TO authenticated;

COMMIT;

-- =============================================================================
-- Fine _BOOTSTRAP.sql — al successo l'output è "Success. No rows returned".
-- Eseguire lo smoke test indicato in docs/INFRA-SETUP-CHECKLIST.md §2.6.
-- =============================================================================
