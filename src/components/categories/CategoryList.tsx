/**
 * CategoryList — Server Component che renderizza la lista di categorie.
 *
 * Ogni riga è un CategoryRowItem ("use client") per gestire edit/delete.
 * Il Server Component può contenere Client Components come foglie.
 *
 * Ownership: frontend-dev (AGENTS.md §File ownership convention).
 */

import { CategoryRowItem, type CategoryRow } from "./CategoryRow";
import type { FundOption } from "./FundSelector";

interface CategoryListProps {
  categories: CategoryRow[];
  funds: FundOption[];
  includeArchived: boolean;
}

export function CategoryList({
  categories,
  funds,
  includeArchived,
}: CategoryListProps) {
  // Se include_archived=false (default), le righe archiviate non arrivano
  // dall'API. Se include_archived=true, filtriamo visivamente solo per
  // distinguerle — il badge ArchivedBadge viene mostrato nella riga stessa.
  const visible = includeArchived
    ? categories
    : categories.filter((c) => c.archived_at === null);

  return (
    <ul className="flex flex-col gap-3" aria-label="Lista categorie">
      {visible.map((category) => (
        <CategoryRowItem key={category.id} category={category} funds={funds} />
      ))}
    </ul>
  );
}
