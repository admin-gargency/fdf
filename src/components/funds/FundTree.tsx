/**
 * FundTree — Server Component che renderizza il tree Fondo → Categoria → Classe.
 *
 * Ownership: frontend-dev (AGENTS.md §File ownership convention).
 */

import type {
  FundTreeNode,
  CategoryTreeNode,
  ClassNode,
  Tipologia,
} from "@/lib/domain/funds";

// ---------------------------------------------------------------------------
// Formatter EUR — memoizzato a livello modulo, NON dentro JSX
// ---------------------------------------------------------------------------

const eurFormatter = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
});

function formatEur(cents: number): string {
  return eurFormatter.format(cents / 100);
}

// ---------------------------------------------------------------------------
// Mapping tipologia → label italiana human-readable
// ---------------------------------------------------------------------------

const TIPOLOGIA_LABEL: Record<Tipologia, string> = {
  addebito_immediato: "Addebito immediato",
  fondo_breve: "Fondo breve",
  fondo_lungo: "Fondo lungo",
};

// ---------------------------------------------------------------------------
// Sub-componenti (tutti server, nessun hook)
// ---------------------------------------------------------------------------

function ClassItem({ cls }: { cls: ClassNode }) {
  const label = TIPOLOGIA_LABEL[cls.tipologia];
  return (
    <li className="flex items-baseline gap-2 py-0.5 text-sm text-zinc-700 dark:text-zinc-300">
      <span>{cls.name}</span>
      <span
        className="text-xs text-zinc-400 dark:text-zinc-500"
        title={cls.tipologia}
      >
        {label}
      </span>
    </li>
  );
}

function CategoryItem({ category }: { category: CategoryTreeNode }) {
  return (
    <li className="mt-3">
      <h3 className="text-base font-medium text-zinc-800 dark:text-zinc-200">
        {category.name}
      </h3>
      <dl className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-zinc-600 dark:text-zinc-400">
        <div className="flex gap-1">
          <dt>Saldo</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">
            {formatEur(category.current_amount_cents)}
          </dd>
        </div>
        {category.target_amount_cents !== null && (
          <div className="flex gap-1">
            <dt>Obiettivo</dt>
            <dd className="font-medium text-zinc-900 dark:text-zinc-50">
              {formatEur(category.target_amount_cents)}
            </dd>
          </div>
        )}
      </dl>
      {category.classes.length > 0 && (
        <ul
          className="mt-1.5 border-l border-zinc-200 pl-3 dark:border-zinc-700"
          aria-label={`Classi di ${category.name}`}
        >
          {category.classes.map((cls) => (
            <ClassItem key={cls.id} cls={cls} />
          ))}
        </ul>
      )}
    </li>
  );
}

function FundItem({ fund }: { fund: FundTreeNode }) {
  return (
    <li className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        {fund.name}
      </h2>
      <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-zinc-600 dark:text-zinc-400">
        <div className="flex gap-1">
          <dt>Saldo</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">
            {formatEur(fund.current_amount_cents)}
          </dd>
        </div>
        {fund.target_amount_cents !== null && (
          <div className="flex gap-1">
            <dt>Obiettivo</dt>
            <dd className="font-medium text-zinc-900 dark:text-zinc-50">
              {formatEur(fund.target_amount_cents)}
            </dd>
          </div>
        )}
      </dl>
      {fund.categories.length > 0 && (
        <ul
          className="mt-4 space-y-1 divide-y divide-zinc-100 dark:divide-zinc-800"
          aria-label={`Categorie di ${fund.name}`}
        >
          {fund.categories.map((cat) => (
            <CategoryItem key={cat.id} category={cat} />
          ))}
        </ul>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Esportazione principale
// ---------------------------------------------------------------------------

export interface FundTreeProps {
  tree: FundTreeNode[];
}

export function FundTree({ tree }: FundTreeProps) {
  return (
    <ul className="flex flex-col gap-4" aria-label="Lista fondi">
      {tree.map((fund) => (
        <FundItem key={fund.id} fund={fund} />
      ))}
    </ul>
  );
}
