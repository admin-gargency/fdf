/**
 * CategoryRow — Server Component che renderizza una singola Categoria
 * con saldo, obiettivo, barra di avanzamento e classi nested.
 *
 * Ownership: frontend-dev (AGENTS.md §File ownership convention).
 * Feature 5: FEATURE-5-BRIEF.md §"Frontend".
 */

import type { SinkingCategoryTreeNode } from "@/lib/domain/sinking-funds-tree";
import { formatEuroFromCents } from "@/lib/format/currency";
import { ClassRow } from "./ClassRow";

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export interface CategoryRowProps {
  category: SinkingCategoryTreeNode;
}

export function CategoryRow({ category }: CategoryRowProps) {
  const hasTarget = category.target_amount_cents !== null;
  const progressRatio =
    hasTarget && category.target_amount_cents! > 0
      ? Math.min(
          1,
          Math.max(0, category.current_amount_cents / category.target_amount_cents!),
        )
      : null;

  return (
    <li className="mt-3 first:mt-0">
      <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
        {category.name}
      </h3>

      <dl className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-zinc-500 dark:text-zinc-400">
        <div className="flex gap-1">
          <dt>Saldo</dt>
          <dd className="font-medium text-zinc-800 dark:text-zinc-200">
            {formatEuroFromCents(category.current_amount_cents)}
          </dd>
        </div>
        {hasTarget && (
          <div className="flex gap-1">
            <dt>Obiettivo</dt>
            <dd className="font-medium text-zinc-800 dark:text-zinc-200">
              {formatEuroFromCents(category.target_amount_cents!)}
            </dd>
          </div>
        )}
      </dl>

      {progressRatio !== null && (
        <div
          className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700"
          role="progressbar"
          aria-label={`Avanzamento categoria ${category.name}`}
          aria-valuenow={Math.round(progressRatio * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-blue-500 transition-all dark:bg-blue-400"
            style={{ width: `${progressRatio * 100}%` }}
          />
        </div>
      )}

      {category.classes.length > 0 && (
        <ul
          className="mt-2 border-l-2 border-zinc-100 pl-3 dark:border-zinc-800"
          aria-label={`Classi di ${category.name}`}
        >
          {category.classes.map((klass) => (
            <ClassRow key={klass.id} klass={klass} />
          ))}
        </ul>
      )}
    </li>
  );
}
