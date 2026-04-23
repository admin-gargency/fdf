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
