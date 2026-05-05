/**
 * MonthlyAggregation — Tabella riepilogo mensile delle transazioni.
 *
 * Server-friendly (nessun "use client").
 * Props: monthly: MonthlyTotals[] prodotti upstream da aggregateByMonth.
 * Se vuoto, il componente non renderizza nulla.
 *
 * Colonne: Mese, Entrate, Uscite, Saldo, N.
 *
 * Ownership: frontend-dev (AGENTS.md §File ownership convention).
 */

import { formatEuroFromCents } from "@/lib/format/currency";
import type { MonthlyTotals } from "@/lib/domain/transactions";

// ---------------------------------------------------------------------------
// Helper: etichetta mese italiano (es. "maggio 2026")
// ---------------------------------------------------------------------------

function formatMonthLabel(ym: string): string {
  // ym = "YYYY-MM"
  if (!/^\d{4}-\d{2}$/.test(ym)) return ym;
  const [year, month] = ym.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString("it-IT", {
    year: "numeric",
    month: "long",
  });
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MonthlyAggregationProps {
  monthly: MonthlyTotals[];
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function MonthlyAggregation({ monthly }: MonthlyAggregationProps) {
  if (monthly.length === 0) return null;

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className="w-full min-w-[480px] text-sm">
        <caption className="sr-only">Riepilogo mensile delle transazioni</caption>
        <thead>
          <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
            <th
              scope="col"
              className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400"
            >
              Mese
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400"
            >
              Entrate
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400"
            >
              Uscite
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400"
            >
              Saldo
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400"
            >
              N.
            </th>
          </tr>
        </thead>
        <tbody>
          {monthly.map((row) => {
            const isPositiveNet = row.net_cents >= 0;
            return (
              <tr
                key={row.month}
                className="border-b border-zinc-100 last:border-0 dark:border-zinc-800"
              >
                <td className="px-4 py-3 font-medium text-zinc-900 capitalize dark:text-zinc-50">
                  {formatMonthLabel(row.month)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                  {formatEuroFromCents(row.inflow_cents)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                  {formatEuroFromCents(Math.abs(row.outflow_cents))}
                </td>
                <td
                  className={`px-4 py-3 text-right tabular-nums font-semibold ${
                    isPositiveNet
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-zinc-900 dark:text-zinc-50"
                  }`}
                >
                  {isPositiveNet ? "+" : ""}
                  {formatEuroFromCents(row.net_cents)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-zinc-500 dark:text-zinc-400">
                  {row.count}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
