/**
 * ClassRow — Server Component che renderizza una singola Classe
 * all'interno dell'albero Sinking Funds.
 *
 * Ownership: frontend-dev (AGENTS.md §File ownership convention).
 * Feature 5: FEATURE-5-BRIEF.md §"Frontend".
 */

import type { SinkingClassNode } from "@/lib/domain/sinking-funds-tree";
import type { Tipologia } from "@/lib/domain/funds";
import { formatEuroFromCents, formatItalianDate } from "@/lib/format/currency";

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

const TIPOLOGIA_LABEL: Record<Tipologia, string> = {
  addebito_immediato: "Addebito immediato",
  fondo_breve: "Fondo breve",
  fondo_lungo: "Fondo lungo",
};

const TIPOLOGIA_BADGE_CLASS: Record<Tipologia, string> = {
  addebito_immediato:
    "inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  fondo_breve:
    "inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  fondo_lungo:
    "inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
};

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export interface ClassRowProps {
  klass: SinkingClassNode;
}

export function ClassRow({ klass }: ClassRowProps) {
  const tipologiaLabel = TIPOLOGIA_LABEL[klass.tipologia];
  const badgeClass = TIPOLOGIA_BADGE_CLASS[klass.tipologia];
  const sf = klass.sinking_fund;

  return (
    <li className="py-1.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
          {klass.name}
        </span>
        <span className={badgeClass} title={klass.tipologia}>
          {tipologiaLabel}
        </span>
      </div>

      {sf !== null && (
        <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          <div className="flex gap-1">
            <dt>Obiettivo</dt>
            <dd className="font-medium text-zinc-700 dark:text-zinc-300">
              {formatEuroFromCents(sf.target_cents)}
            </dd>
          </div>
          <div className="flex gap-1">
            <dt>Contributo</dt>
            <dd className="font-medium text-zinc-700 dark:text-zinc-300">
              {formatEuroFromCents(sf.monthly_contribution_cents)}/mese
            </dd>
          </div>
          {sf.target_date !== null && (
            <div className="flex gap-1">
              <dt>Scadenza</dt>
              <dd className="font-medium text-zinc-700 dark:text-zinc-300">
                {formatItalianDate(sf.target_date)}
              </dd>
            </div>
          )}
        </dl>
      )}
    </li>
  );
}
