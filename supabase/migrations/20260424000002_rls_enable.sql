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
