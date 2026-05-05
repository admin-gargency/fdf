/**
 * TransactionList — Lista transazioni raggruppate per data.
 *
 * Server-friendly (nessun "use client"). Raggruppa le righe per booked_at
 * e mostra un'intestazione di data per ogni giorno.
 *
 * Renderizza TransactionRow (client) per le azioni inline.
 *
 * Ownership: frontend-dev (AGENTS.md §File ownership convention).
 */

import { formatItalianDate } from "@/lib/format/currency";
import { TransactionRow } from "./TransactionRow";
import type { TransactionItem } from "./TransactionRow";
import type { ClassOption } from "./TransactionForm";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TransactionListProps {
  transactions: TransactionItem[];
  classes: ClassOption[];
}

// ---------------------------------------------------------------------------
// Helper: raggruppa per booked_at
// ---------------------------------------------------------------------------

function groupByDate(items: TransactionItem[]): [string, TransactionItem[]][] {
  const map = new Map<string, TransactionItem[]>();
  for (const item of items) {
    const day = item.booked_at.slice(0, 10);
    const existing = map.get(day);
    if (existing) {
      existing.push(item);
    } else {
      map.set(day, [item]);
    }
  }
  // Mantieni l'ordine già dato dall'API (booked_at DESC)
  return Array.from(map.entries());
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function TransactionList({ transactions, classes }: TransactionListProps) {
  if (transactions.length === 0) {
    return (
      <p className="text-base text-zinc-600 dark:text-zinc-400">
        Nessuna transazione. Aggiungi la prima.
      </p>
    );
  }

  const groups = groupByDate(transactions);

  return (
    <div className="flex flex-col gap-6">
      {groups.map(([day, items]) => (
        <section key={day}>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            {formatItalianDate(day)}
          </h2>
          <ul className="flex flex-col gap-2">
            {items.map((tx) => (
              <TransactionRow key={tx.id} transaction={tx} classes={classes} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
