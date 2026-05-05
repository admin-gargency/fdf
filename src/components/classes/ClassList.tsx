/**
 * ClassList — Server Component che renderizza la lista di classi.
 *
 * Ogni riga è un ClassRowItem ("use client") per gestire edit/archive.
 * Il Server Component può contenere Client Components come foglie.
 *
 * Ownership: frontend-dev (AGENTS.md §File ownership convention).
 */

import { ClassRowItem, type ClassRow } from "./ClassRow";
import type { CategoryOption } from "./CategorySelector";

interface ClassListProps {
  classes: ClassRow[];
  categories: CategoryOption[];
  includeArchived: boolean;
}

export function ClassList({
  classes,
  categories,
  includeArchived,
}: ClassListProps) {
  // Se include_archived=false (default), le righe archiviate non arrivano
  // dall'API. Se include_archived=true, le mostriamo tutte con il badge.
  const visible = includeArchived
    ? classes
    : classes.filter((c) => c.archived_at === null);

  return (
    <ul className="flex flex-col gap-3" aria-label="Lista classi">
      {visible.map((classItem) => (
        <ClassRowItem
          key={classItem.id}
          classItem={classItem}
          categories={categories}
        />
      ))}
    </ul>
  );
}
