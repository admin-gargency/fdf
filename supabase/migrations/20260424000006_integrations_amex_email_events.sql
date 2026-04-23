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
