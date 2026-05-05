/**
 * FundCard — Server Component che renderizza un singolo Fondo
 * con saldo, obiettivo, barra di avanzamento e categorie nested.
 *
 * Ownership: frontend-dev (AGENTS.md §File ownership convention).
 * Feature 5: FEATURE-5-BRIEF.md §"Frontend".
 */

import type { SinkingFundTreeNode } from "@/lib/domain/sinking-funds-tree";
import { formatEuroFromCents } from "@/lib/format/currency";
import { CategoryRow } from "./CategoryRow";

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export interface FundCardProps {
  fund: SinkingFundTreeNode;
}

export function FundCard({ fund }: FundCardProps) {
  const hasTarget = fund.target_amount_cents !== null;
  const progressRatio =
    hasTarget && fund.target_amount_cents! > 0
      ? Math.min(
          1,
          Math.max(0, fund.current_amount_cents / fund.target_amount_cents!),
        )
      : null;

  return (
    <li className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      {/* Intestazione fondo */}
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        {fund.name}
      </h2>

      {/* Importi */}
      <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-zinc-600 dark:text-zinc-400">
        <div className="flex gap-1">
          <dt>Saldo</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">
            {formatEuroFromCents(fund.current_amount_cents)}
          </dd>
        </div>
        {hasTarget && (
          <div className="flex gap-1">
            <dt>Obiettivo</dt>
            <dd className="font-medium text-zinc-900 dark:text-zinc-50">
              {formatEuroFromCents(fund.target_amount_cents!)}
            </dd>
          </div>
        )}
      </dl>

      {/* Barra avanzamento — solo se target presente */}
      {progressRatio !== null && (
        <div
          className="mt-2 h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700"
          role="progressbar"
          aria-label={`Avanzamento fondo ${fund.name}`}
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

      {/* Categorie */}
      {fund.categories.length > 0 && (
        <ul
          className="mt-4 space-y-0 divide-y divide-zinc-100 dark:divide-zinc-800"
          aria-label={`Categorie di ${fund.name}`}
        >
          {fund.categories.map((category) => (
            <CategoryRow key={category.id} category={category} />
          ))}
        </ul>
      )}
    </li>
  );
}
