/**
 * CategorySelector — Selettore a due livelli Fondo → Categoria via <form method="get">.
 *
 * Server Component: nessuna interattività client. Il submit ricarica la pagina
 * con i nuovi searchParams, SSR-friendly e funzionante senza JavaScript.
 *
 * Mostra il selettore Fondo sempre.
 * Mostra il selettore Categoria solo quando selectedFundId è valorizzato.
 *
 * Ownership: frontend-dev (AGENTS.md §File ownership convention).
 */

export interface FundOption {
  id: string;
  name: string;
}

export interface CategoryOption {
  id: string;
  name: string;
}

interface CategorySelectorProps {
  funds: FundOption[];
  categories?: CategoryOption[];
  selectedFundId?: string;
  selectedCategoryId?: string;
  includeArchived?: boolean;
}

const selectClass =
  "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-500/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20";

const labelClass = "text-sm font-medium text-zinc-700 dark:text-zinc-300";

export function CategorySelector({
  funds,
  categories,
  selectedFundId,
  selectedCategoryId,
  includeArchived,
}: CategorySelectorProps) {
  return (
    <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
      {/* Selettore Fondo */}
      <div className="flex flex-1 flex-col gap-1.5">
        <label htmlFor="fund_id" className={labelClass}>
          Fondo
        </label>
        <select
          id="fund_id"
          name="fund_id"
          defaultValue={selectedFundId ?? ""}
          className={selectClass}
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

      {/* Selettore Categoria — solo quando fondo selezionato */}
      {selectedFundId && categories && (
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor="category_id" className={labelClass}>
            Categoria
          </label>
          <select
            id="category_id"
            name="category_id"
            defaultValue={selectedCategoryId ?? ""}
            className={selectClass}
          >
            <option value="" disabled>
              Seleziona una categoria…
            </option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Preserva include_archived se attivo */}
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
