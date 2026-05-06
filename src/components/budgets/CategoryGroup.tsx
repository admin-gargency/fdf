/**
 * CategoryGroup — Gruppo budget per categoria.
 *
 * Server Component: mostra il nome della categoria, il subtotale
 * e la lista di BudgetRow.
 *
 * Ownership: frontend-dev (AGENTS.md §File ownership convention).
 */

import { formatEuroFromCents } from "@/lib/format/currency";
import { BudgetRow } from "./BudgetRow";
import type { BudgetRowItem } from "./BudgetRow";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CategoryGroupProps {
  categoryName: string;
  rows: BudgetRowItem[];
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function CategoryGroup({ categoryName, rows }: CategoryGroupProps) {
  const totalBudget = rows.reduce((sum, r) => sum + r.budget_cents, 0);
  const totalActual = rows.reduce((sum, r) => sum + r.actual_cents, 0);
  const totalDelta = totalBudget - totalActual;
  const isOverBudget = totalDelta < 0;

  return (
    <section aria-label={`Categoria: ${categoryName}`}>
      {/* Intestazione categoria con subtotale */}
      <div className="mb-3 flex items-center justify-between gap-4 border-b border-zinc-200 pb-2 dark:border-zinc-800">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          {categoryName}
        </h2>
        <div className="flex items-center gap-4 text-xs text-zinc-500 dark:text-zinc-400">
          <span>
            Pianificato:{" "}
            <span className="font-medium tabular-nums text-zinc-900 dark:text-zinc-50">
              {formatEuroFromCents(totalBudget)}
            </span>
          </span>
          <span>
            Speso:{" "}
            <span className="font-medium tabular-nums text-zinc-900 dark:text-zinc-50">
              {formatEuroFromCents(totalActual)}
            </span>
          </span>
          <span>
            Differenza:{" "}
            <span
              className={`font-medium tabular-nums ${
                isOverBudget
                  ? "text-red-600 dark:text-red-400"
                  : "text-emerald-600 dark:text-emerald-400"
              }`}
            >
              {isOverBudget ? "" : "+"}
              {formatEuroFromCents(totalDelta)}
            </span>
          </span>
        </div>
      </div>

      {/* Righe budget */}
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <BudgetRow key={row.class_id} row={row} />
        ))}
      </ul>
    </section>
  );
}
