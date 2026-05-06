"use client";

/**
 * AccountSelector — Dropdown selezione conto per l'import CSV.
 *
 * Riceve la lista account come props (fetch server-side dalla page).
 * Empty state: mostra avviso con link a /transactions/new per creare il primo conto.
 *
 * Ownership: frontend-dev (AGENTS.md §File ownership convention).
 */

import Link from "next/link";

// ---------------------------------------------------------------------------
// Tipi
// ---------------------------------------------------------------------------

export interface AccountOption {
  id: string;
  name: string;
  kind: string;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AccountSelectorProps {
  accounts: AccountOption[];
  value: string;
  onChange: (accountId: string) => void;
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function AccountSelector({
  accounts,
  value,
  onChange,
  disabled = false,
}: AccountSelectorProps) {
  if (accounts.length === 0) {
    return (
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="account-selector"
          className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          Conto di destinazione <span aria-hidden="true">*</span>
        </label>
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Nessun conto disponibile.{" "}
            <Link
              href="/transactions/new"
              className="font-medium text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-50"
            >
              Crea conto
            </Link>{" "}
            prima di importare le transazioni.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor="account-selector"
        className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
      >
        Conto di destinazione <span aria-hidden="true">*</span>
      </label>
      <select
        id="account-selector"
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        disabled={disabled}
        data-testid="account-selector"
        className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20"
      >
        <option value="">— Seleziona un conto</option>
        {accounts.map((acc) => (
          <option key={acc.id} value={acc.id}>
            {acc.name}
          </option>
        ))}
      </select>
    </div>
  );
}
