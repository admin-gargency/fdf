"use client";

/**
 * MonthSelector — Selettore mese per la pagina budget.
 *
 * "use client": usa useRouter per aggiornare il querystring period=YYYY-MM
 * senza perdere altri searchParams. Riflette il valore scelto nell'URL
 * per shareability e navigazione back/forward.
 *
 * Ownership: frontend-dev (AGENTS.md §File ownership convention).
 */

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useCallback } from "react";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MonthSelectorProps {
  currentPeriod: string; // "YYYY-MM"
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function MonthSelector({ currentPeriod }: MonthSelectorProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.currentTarget.value; // "YYYY-MM"
      if (!value) return;

      const params = new URLSearchParams(searchParams.toString());
      params.set("period", value);
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );

  return (
    <div className="flex items-center gap-2">
      <label
        htmlFor="period-selector"
        className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
      >
        Mese:
      </label>
      <input
        id="period-selector"
        type="month"
        value={currentPeriod}
        onChange={handleChange}
        aria-label="Seleziona il mese del budget"
        className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-500/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20"
      />
    </div>
  );
}
