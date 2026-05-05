/**
 * funds.ts — Branded types, Zod schemas, and pure tree-building logic
 * for the Fondo → Categoria → Classe taxonomy (ADR-0006).
 *
 * Ownership: domain-dev (AGENTS.md §File ownership convention).
 * Consumed by: src/app/api/funds/route.ts, src/lib/domain/sinking-funds-tree.ts,
 *   frontend-dev (read-only).
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Branded primitives
// ---------------------------------------------------------------------------

declare const _FundId: unique symbol;
declare const _CategoryId: unique symbol;
declare const _ClassId: unique symbol;
declare const _AccountId: unique symbol;
declare const _Cents: unique symbol;
declare const _SinkingFundId: unique symbol;

export type FundId = string & { readonly [_FundId]: void };
export type CategoryId = string & { readonly [_CategoryId]: void };
export type ClassId = string & { readonly [_ClassId]: void };
export type AccountId = string & { readonly [_AccountId]: void };
export type Cents = number & { readonly [_Cents]: void };
/** Branded type for `sinking_funds.id` UUID. */
export type SinkingFundId = string & { readonly [_SinkingFundId]: void };

export type Tipologia =
  | "addebito_immediato"
  | "fondo_breve"
  | "fondo_lungo";

// ---------------------------------------------------------------------------
// Zod schemas — aligned to DB columns exposed via column-level GRANTs
// (migrations 20260424000004_grants.sql + 20260504120000_funds_categories_amounts.sql)
// ---------------------------------------------------------------------------

export const FundRowSchema = z.object({
  id: z.string().uuid(),
  household_id: z.string().uuid(),
  default_account_id: z.string().uuid().nullable(),
  name: z.string().min(1),
  sort_order: z.number().int(),
  archived_at: z.string().nullable(),
  target_amount_cents: z.number().int().nullable(),
  current_amount_cents: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
});

/**
 * CategoryRowSchema
 *
 * NOTA (deviazione da API contract iniziale): `default_account_id` NON è
 * incluso in questo schema perché la tabella `categories` reale (migration
 * 20260424000001_core_schema.sql) non ha tale colonna — esiste solo su
 * `funds`. Il contratto API originale prevedeva la colonna su categories,
 * ma è stato rimosso in fase di revisione schema (decisione lead,
 * 2026-05-04, ADR-0006 Decision 1). Qualsiasi consumer che si aspettava
 * `default_account_id` sul payload categoria deve usare
 * `fund.default_account_id` risalendo al nodo padre.
 */
export const CategoryRowSchema = z.object({
  id: z.string().uuid(),
  household_id: z.string().uuid(),
  fund_id: z.string().uuid(),
  name: z.string().min(1),
  sort_order: z.number().int(),
  archived_at: z.string().nullable(),
  target_amount_cents: z.number().int().nullable(),
  current_amount_cents: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
});

/**
 * ClassRowSchema — nessun campo importo (ADR-0006 Decision 1).
 * Le colonne target_amount_cents / current_amount_cents non esistono su classes.
 */
export const ClassRowSchema = z.object({
  id: z.string().uuid(),
  household_id: z.string().uuid(),
  category_id: z.string().uuid(),
  name: z.string().min(1),
  tipologia: z.enum(["addebito_immediato", "fondo_breve", "fondo_lungo"]),
  sort_order: z.number().int(),
  archived_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type FundRow = z.infer<typeof FundRowSchema>;
export type CategoryRow = z.infer<typeof CategoryRowSchema>;
export type ClassRow = z.infer<typeof ClassRowSchema>;

/**
 * SinkingFundRowSchema — aligned to the GRANT SELECT columns in
 * `supabase/migrations/20260424000004_grants.sql` L162-163.
 *
 * `notes` is deliberately excluded: it is ungranted PII
 * (grants.sql L159-160; DO NOT add it here).
 *
 * `target_date` is a Postgres `date` — serialised as ISO date string
 * ("YYYY-MM-DD") or null.
 *
 * Feature 5 context: FEATURE-5-BRIEF.md §"Data model".
 */
export const SinkingFundRowSchema = z.object({
  id: z.string().uuid(),
  household_id: z.string().uuid(),
  class_id: z.string().uuid(),
  target_cents: z.number().int(),
  target_date: z.string().nullable(),
  monthly_contribution_cents: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
});

/** TypeScript type inferred from {@link SinkingFundRowSchema}. */
export type SinkingFundRow = z.infer<typeof SinkingFundRowSchema>;

// ---------------------------------------------------------------------------
// Tree output types
// ---------------------------------------------------------------------------

export interface ClassNode {
  id: ClassId;
  name: string;
  tipologia: Tipologia;
  sort_order: number;
  archived_at: string | null;
}

export interface CategoryTreeNode {
  id: CategoryId;
  fund_id: FundId;
  name: string;
  sort_order: number;
  archived_at: string | null;
  target_amount_cents: Cents | null;
  current_amount_cents: Cents;
  /**
   * `default_account_id` è deliberatamente omesso qui (vedi JSDoc su
   * CategoryRowSchema sopra). Usa `FundTreeNode.default_account_id`.
   */
  classes: ClassNode[];
}

export interface FundTreeNode {
  id: FundId;
  name: string;
  default_account_id: AccountId | null;
  sort_order: number;
  archived_at: string | null;
  target_amount_cents: Cents | null;
  current_amount_cents: Cents;
  categories: CategoryTreeNode[];
}

// ---------------------------------------------------------------------------
// buildFundTree — pure function, no I/O
// ---------------------------------------------------------------------------

/**
 * Composes raw DB rows into a hierarchical Fondo → Categoria → Classe tree.
 *
 * ## Deviazione dal contratto API iniziale
 * Il payload `CategoryTreeNode` NON include `default_account_id`.
 * La colonna non esiste nella tabella `categories` dello schema reale
 * (migration `20260424000001_core_schema.sql`). La colonna esiste solo su
 * `funds`. Consumer che necessitano dell'account predefinito per una
 * categoria devono risalire al nodo `FundTreeNode.default_account_id`.
 * Decisione approvata dal lead il 2026-05-04 (ADR-0006 Decision 1).
 *
 * @param funds - Righe della tabella `funds` (già filtrate: archived_at IS NULL, ordinate per sort_order)
 * @param categories - Righe della tabella `categories` (già filtrate e ordinate)
 * @param classes - Righe della tabella `classes` (già filtrate e ordinate)
 * @returns Array di `FundTreeNode` nell'ordine ricevuto
 */
export function buildFundTree(
  funds: FundRow[],
  categories: CategoryRow[],
  classes: ClassRow[],
): FundTreeNode[] {
  // Build lookup: category_id → ClassNode[]
  const classesByCategory = new Map<string, ClassNode[]>();
  for (const cls of classes) {
    const existing = classesByCategory.get(cls.category_id);
    const node: ClassNode = {
      id: cls.id as ClassId,
      name: cls.name,
      tipologia: cls.tipologia,
      sort_order: cls.sort_order,
      archived_at: cls.archived_at,
    };
    if (existing) {
      existing.push(node);
    } else {
      classesByCategory.set(cls.category_id, [node]);
    }
  }

  // Build lookup: fund_id → CategoryTreeNode[]
  const categoriesByFund = new Map<string, CategoryTreeNode[]>();
  for (const cat of categories) {
    const existing = categoriesByFund.get(cat.fund_id);
    const node: CategoryTreeNode = {
      id: cat.id as CategoryId,
      fund_id: cat.fund_id as FundId,
      name: cat.name,
      sort_order: cat.sort_order,
      archived_at: cat.archived_at,
      target_amount_cents: cat.target_amount_cents as Cents | null,
      current_amount_cents: cat.current_amount_cents as Cents,
      classes: classesByCategory.get(cat.id) ?? [],
    };
    if (existing) {
      existing.push(node);
    } else {
      categoriesByFund.set(cat.fund_id, [node]);
    }
  }

  // Build FundTreeNode[]
  return funds.map((fund): FundTreeNode => ({
    id: fund.id as FundId,
    name: fund.name,
    default_account_id: fund.default_account_id as AccountId | null,
    sort_order: fund.sort_order,
    archived_at: fund.archived_at,
    target_amount_cents: fund.target_amount_cents as Cents | null,
    current_amount_cents: fund.current_amount_cents as Cents,
    categories: categoriesByFund.get(fund.id) ?? [],
  }));
}
