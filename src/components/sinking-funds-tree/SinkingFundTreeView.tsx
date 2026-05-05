/**
 * SinkingFundTreeView — Server Component contenitore dell'albero
 * Fondo → Categoria → Classe con sinking funds.
 *
 * Riceve l'albero pre-costruito dalla pagina (Server Component) e
 * si occupa solo del rendering. Nessun I/O, nessun useEffect.
 *
 * Ownership: frontend-dev (AGENTS.md §File ownership convention).
 * Feature 5: FEATURE-5-BRIEF.md §"Frontend".
 */

import type { SinkingFundTreeNode } from "@/lib/domain/sinking-funds-tree";
import { FundCard } from "./FundCard";

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export interface SinkingFundTreeViewProps {
  tree: SinkingFundTreeNode[];
}

export function SinkingFundTreeView({ tree }: SinkingFundTreeViewProps) {
  return (
    <section aria-label="Albero sinking funds">
      <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Piano di accantonamento
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Vista gerarchia Fondo&nbsp;&rarr; Categoria&nbsp;&rarr; Classe
      </p>

      {tree.length === 0 ? (
        <div className="mt-10 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-8 text-center dark:border-zinc-700 dark:bg-zinc-900">
          <p className="text-base text-zinc-600 dark:text-zinc-400">
            Nessun fondo configurato.{" "}
            <a
              href="/funds"
              className="font-medium text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
            >
              Vai alla pagina Fondi
            </a>{" "}
            per crearne uno.
          </p>
        </div>
      ) : (
        <ul
          className="mt-6 flex flex-col gap-4"
          aria-label="Lista fondi con piano di accantonamento"
        >
          {tree.map((fund) => (
            <FundCard key={fund.id} fund={fund} />
          ))}
        </ul>
      )}
    </section>
  );
}
