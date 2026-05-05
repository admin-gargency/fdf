/**
 * TransactionFilters — Filtri GET per le transazioni.
 *
 * Server-friendly (nessun "use client"). Form GET puro senza client JS.
 * Invia account_id, class_id, month a /transactions.
 *
 * Ownership: frontend-dev (AGENTS.md §File ownership convention).
 */

import Link from "next/link";
import type { AccountOption } from "./TransactionForm";
import type { FundTreeNode } from "@/lib/domain/funds";

// ---------------------------------------------------------------------------
// Tipi props
// ---------------------------------------------------------------------------

interface TransactionFiltersProps {
  accounts: AccountOption[];
  fundTree: FundTreeNode[];
  selectedAccountId?: string;
  selectedClassId?: string;
  selectedMonth?: string;
}

// ---------------------------------------------------------------------------
// Stili condivisi
// ---------------------------------------------------------------------------

const selectClass =
  "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-500/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20";

const labelClass = "text-xs font-medium text-zinc-500 uppercase tracking-wider dark:text-zinc-400";

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function TransactionFilters({
  accounts,
  fundTree,
  selectedAccountId,
  selectedClassId,
  selectedMonth,
}: TransactionFiltersProps) {
  return (
    <form
      action="/transactions"
      method="GET"
      className="flex flex-wrap items-end gap-4"
    >
      {/* Conto */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="filter-account" className={labelClass}>
          Conto
        </label>
        <select
          id="filter-account"
          name="account_id"
          defaultValue={selectedAccountId ?? ""}
          className={selectClass}
        >
          <option value="">Tutti i conti</option>
          {accounts.map((acc) => (
            <option key={acc.id} value={acc.id}>
              {acc.name}
            </option>
          ))}
        </select>
      </div>

      {/* Categoria di spesa */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="filter-class" className={labelClass}>
          Categoria
        </label>
        <select
          id="filter-class"
          name="class_id"
          defaultValue={selectedClassId ?? ""}
          className={selectClass}
        >
          <option value="">Tutte le categorie</option>
          {fundTree.map((fund) =>
            fund.categories.map((cat) =>
              cat.classes.length > 0 ? (
                <optgroup key={`${fund.id}-${cat.id}`} label={`${fund.name} › ${cat.name}`}>
                  {cat.classes.map((cls) => (
                    <option key={cls.id} value={cls.id}>
                      {cls.name}
                    </option>
                  ))}
                </optgroup>
              ) : null,
            ),
          )}
        </select>
      </div>

      {/* Mese */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="filter-month" className={labelClass}>
          Mese
        </label>
        <input
          id="filter-month"
          name="month"
          type="month"
          defaultValue={selectedMonth ?? ""}
          className={selectClass}
        />
      </div>

      {/* Azioni */}
      <div className="flex items-end gap-3">
        <button
          type="submit"
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-900/40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200 dark:focus:ring-zinc-50/40"
        >
          Filtra
        </button>
        <Link
          href="/transactions"
          className="text-sm font-medium text-zinc-500 underline-offset-4 hover:text-zinc-900 hover:underline focus:outline-none focus:ring-2 focus:ring-zinc-900/40 dark:text-zinc-400 dark:hover:text-zinc-50 dark:focus:ring-zinc-50/40"
        >
          Azzera
        </Link>
      </div>
    </form>
  );
}
