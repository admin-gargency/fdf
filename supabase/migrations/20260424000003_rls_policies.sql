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
