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
