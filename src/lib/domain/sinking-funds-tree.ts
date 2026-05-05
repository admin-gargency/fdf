/**
 * sinking-funds-tree.ts — Pure aggregator that extends the
 * Fondo → Categoria → Classe tree with sinking-fund payloads.
 *
 * Ownership: domain-dev (AGENTS.md §File ownership convention).
 * Consumed by: src/app/api/sinking-funds-tree/route.ts (backend-dev),
 *   frontend-dev (read-only via the API response type).
 *
 * ## Design notes
 * - Delegates all tree construction to {@link buildFundTree} from
 *   `funds.ts`; does NOT duplicate any hierarchy logic (ADR-0006 Decision 1).
 * - Uses a `Map<class_id, SinkingFundRow>` for O(1) lookup when attaching
 *   the sinking-fund payload to each {@link ClassNode}.
 * - Pure function: no I/O, no Supabase imports, no `fetch`. Same input →
 *   same output. All side-effectful work belongs in the API route
 *   (backend-dev territory).
 * - Input ordering is preserved; no re-sorting is performed.
 * - Filtering (e.g. `archived_at IS NULL`) is the caller's responsibility.
 *
 * Feature 5 context: docs/FEATURE-5-BRIEF.md §"Domain layer".
 */

import {
  buildFundTree,
  type CategoryId,
  type CategoryTreeNode,
  type Cents,
  type CategoryRow,
  type ClassId,
  type ClassNode,
  type FundId,
  type FundRow,
  type FundTreeNode,
  type ClassRow,
  type SinkingFundRow,
} from "./funds";

// ---------------------------------------------------------------------------
// Output node types — extensions of the base tree types
// ---------------------------------------------------------------------------

/**
 * A leaf node that extends {@link ClassNode} with an optional sinking-fund
 * payload.
 *
 * `sinking_fund` is `null` when the class has `tipologia = "addebito_immediato"`
 * (or any other tipologia without a `sinking_funds` row). The brief guarantees
 * a 1:1 relationship between a `sinking_funds` row and its class (UNIQUE on
 * `class_id` — core_schema.sql L239).
 *
 * Amount fields use the {@link Cents} branded type (integers, never floats).
 * Feature 5: FEATURE-5-BRIEF.md §"API contract".
 * ADR-0006 Decision 1: classes carry no amount columns of their own.
 */
export interface SinkingClassNode extends ClassNode {
  sinking_fund: {
    /** Accrual target in integer cents. */
    target_cents: Cents;
    /** ISO date string ("YYYY-MM-DD") or null if open-ended. */
    target_date: string | null;
    /** Planned monthly contribution in integer cents. */
    monthly_contribution_cents: Cents;
  } | null;
}

/**
 * A category node whose class children are {@link SinkingClassNode}s.
 * All other fields mirror {@link CategoryTreeNode}.
 */
export interface SinkingCategoryTreeNode
  extends Omit<CategoryTreeNode, "classes"> {
  classes: SinkingClassNode[];
}

/**
 * A fund node whose category children are {@link SinkingCategoryTreeNode}s.
 * All other fields mirror {@link FundTreeNode}.
 */
export interface SinkingFundTreeNode extends Omit<FundTreeNode, "categories"> {
  categories: SinkingCategoryTreeNode[];
}

// ---------------------------------------------------------------------------
// buildSinkingFundTree — pure function, no I/O
// ---------------------------------------------------------------------------

/**
 * Composes raw DB rows into a hierarchical
 * Fondo → Categoria → Classe tree enriched with sinking-fund payloads.
 *
 * ## Delegation
 * Hierarchy construction is fully delegated to {@link buildFundTree} from
 * `funds.ts`. This function only adds the `sinking_fund` field to each
 * {@link ClassNode} via a `Map<class_id, SinkingFundRow>` lookup — O(n)
 * total time.
 *
 * ## Filtering
 * Input rows are trusted as-is. The caller (backend-dev route handler) is
 * responsible for filtering out archived rows (`archived_at IS NULL`) before
 * passing them here.
 *
 * ## Ordering
 * Input ordering is preserved throughout; no re-sorting is performed.
 *
 * @param funds - Rows from `funds` table (pre-filtered, pre-ordered).
 * @param categories - Rows from `categories` table (pre-filtered, pre-ordered).
 * @param classes - Rows from `classes` table (pre-filtered, pre-ordered).
 * @param sinkingFunds - Rows from `sinking_funds` table. May be a subset
 *   (e.g. only fondo_breve/fondo_lungo classes). Rows with no matching class
 *   in `classes` are silently ignored.
 * @returns Array of {@link SinkingFundTreeNode} in the same order as `funds`.
 */
export function buildSinkingFundTree(
  funds: FundRow[],
  categories: CategoryRow[],
  classes: ClassRow[],
  sinkingFunds: SinkingFundRow[],
): SinkingFundTreeNode[] {
  // Build O(1) lookup: class_id → SinkingFundRow
  const sfByClassId = new Map<string, SinkingFundRow>();
  for (const sf of sinkingFunds) {
    sfByClassId.set(sf.class_id, sf);
  }

  // Delegate hierarchy construction entirely to buildFundTree.
  const baseTree: FundTreeNode[] = buildFundTree(funds, categories, classes);

  // Map over the base tree, enriching each ClassNode with sinking_fund.
  // No hierarchy logic is duplicated here.
  return baseTree.map(
    (fund): SinkingFundTreeNode => ({
      id: fund.id as FundId,
      name: fund.name,
      default_account_id: fund.default_account_id,
      sort_order: fund.sort_order,
      archived_at: fund.archived_at,
      target_amount_cents: fund.target_amount_cents,
      current_amount_cents: fund.current_amount_cents,
      categories: fund.categories.map(
        (cat): SinkingCategoryTreeNode => ({
          id: cat.id as CategoryId,
          fund_id: cat.fund_id as FundId,
          name: cat.name,
          sort_order: cat.sort_order,
          archived_at: cat.archived_at,
          target_amount_cents: cat.target_amount_cents,
          current_amount_cents: cat.current_amount_cents,
          classes: cat.classes.map(
            (cls): SinkingClassNode => {
              const sf = sfByClassId.get(cls.id as string);
              return {
                id: cls.id as ClassId,
                name: cls.name,
                tipologia: cls.tipologia,
                sort_order: cls.sort_order,
                archived_at: cls.archived_at,
                sinking_fund: sf
                  ? {
                      target_cents: sf.target_cents as Cents,
                      target_date: sf.target_date,
                      monthly_contribution_cents:
                        sf.monthly_contribution_cents as Cents,
                    }
                  : null,
              };
            },
          ),
        }),
      ),
    }),
  );
}
