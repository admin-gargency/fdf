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
