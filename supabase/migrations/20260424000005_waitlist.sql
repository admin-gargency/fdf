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
