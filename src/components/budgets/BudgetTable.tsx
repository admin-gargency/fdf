/**
 * BudgetTable — Tabella budget raggruppata per categoria.
 *
 * Server Component. Raggruppa i BudgetRowItem per categoria e renderizza
 * CategoryGroup per ciascun gruppo.
 *
 * Ownership: frontend-dev (AGENTS.md §File ownership convention).
 */

import { CategoryGroup } from "./CategoryGroup";
import type { BudgetRowItem } from "./BudgetRow";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface BudgetTableProps {
  rows: BudgetRowItem[];
}

// ---------------------------------------------------------------------------
// Helper: raggruppa per categoria
// ---------------------------------------------------------------------------

function groupByCategory(items: BudgetRowItem[]): [string, BudgetRowItem[]][] {
  const map = new Map<string, BudgetRowItem[]>();
  for (const item of items) {
    const cat = item.category_name;
    const existing = map.get(cat);
    if (existing) {
      existing.push(item);
    } else {
      map.set(cat, [item]);
    }
  }
  return Array.from(map.entries());
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function BudgetTable({ rows }: BudgetTableProps) {
  if (rows.length === 0) {
    return null;
  }

  const groups = groupByCategory(rows);

  return (
    <div className="flex flex-col gap-8" data-testid="budget-table">
      {groups.map(([categoryName, categoryRows]) => (
        <CategoryGroup
          key={categoryName}
          categoryName={categoryName}
          rows={categoryRows}
        />
      ))}
    </div>
  );
}
