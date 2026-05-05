/**
 * FundSelector — Selettore fondo via <form method="get">.
 *
 * Server Component: nessuna interattività client. Il submit ricarica la pagina
 * con il nuovo ?fund_id, SSR-friendly e funzionante senza JavaScript.
 *
 * Ownership: frontend-dev (AGENTS.md §File ownership convention).
 */

export interface FundOption {
  id: string;
  name: string;
}

interface FundSelectorProps {
  funds: FundOption[];
  selectedFundId?: string;
  includeArchived?: boolean;
}

export function FundSelector({
  funds,
  selectedFundId,
  includeArchived,
}: FundSelectorProps) {
  return (
    <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex flex-1 flex-col gap-1.5">
        <label
          htmlFor="fund_id"
          className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          Fondo
        </label>
        <select
          id="fund_id"
          name="fund_id"
          defaultValue={selectedFundId ?? ""}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-500/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20"
        >
          <option value="" disabled>
            Seleziona un fondo…
          </option>
          {funds.map((fund) => (
            <option key={fund.id} value={fund.id}>
              {fund.name}
            </option>
          ))}
        </select>
      </div>

      {/* Preserva il parametro include_archived se attivo */}
      {includeArchived && (
        <input type="hidden" name="include_archived" value="true" />
      )}

      <button
        type="submit"
        className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-900/40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200 dark:focus:ring-zinc-50/40"
      >
        Visualizza
      </button>
    </form>
  );
}
