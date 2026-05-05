"use client";

/**
 * TransactionRow — Riga singola transazione con cambio classe inline e
 * eliminazione definitiva.
 *
 * "use client": gestisce useState (error, loading), useRouter (refresh dopo
 * mutazione), window.confirm (eliminazione hard-delete).
 *
 * Mutazioni:
 * - Cambio classe: client fetch PUT /api/transactions/{id} con { class_id }
 * - Eliminazione: window.confirm → client fetch DELETE /api/transactions/{id}
 *
 * Colori importo: entrata → emerald, spesa → default zinc.
 *
 * Ownership: frontend-dev (AGENTS.md §File ownership convention).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatEuroFromCents, formatItalianDate } from "@/lib/format/currency";
import type { ClassOption } from "./TransactionForm";

// ---------------------------------------------------------------------------
// Tipo riga transazione (sottoinsieme di TransactionRow dal dominio)
// ---------------------------------------------------------------------------

export interface TransactionItem {
  id: string;
  account_id: string;
  accountName: string;
  class_id: string | null;
  className: string | null;
  booked_at: string;
  amount_cents: number;
  description: string | null;
}

// ---------------------------------------------------------------------------
// Stili condivisi
// ---------------------------------------------------------------------------

const selectClass =
  "rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-500/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TransactionRowProps {
  transaction: TransactionItem;
  classes: ClassOption[];
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function TransactionRow({ transaction, classes }: TransactionRowProps) {
  const router = useRouter();

  const [classError, setClassError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [changingClass, setChangingClass] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isInflow = transaction.amount_cents > 0;

  // ---------------------------------------------------------------------------
  // Cambio classe inline
  // ---------------------------------------------------------------------------

  async function handleClassChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setClassError(null);
    setChangingClass(true);

    const selectedValue = e.currentTarget.value;
    const body: Record<string, unknown> = {};
    if (selectedValue === "") {
      body.class_id = null;
    } else {
      body.class_id = selectedValue;
    }

    let res: Response;
    try {
      res = await fetch(`/api/transactions/${transaction.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      setClassError("Errore di rete. Riprova più tardi.");
      setChangingClass(false);
      return;
    }

    if (res.status === 401) {
      setClassError("Sessione scaduta. Accedi di nuovo per continuare.");
      setChangingClass(false);
      return;
    }

    if (res.status === 403) {
      setClassError("Categoria non valida per il tuo nucleo.");
      setChangingClass(false);
      return;
    }

    if (res.status === 404) {
      setClassError("Transazione non trovata. Ricarica la pagina.");
      setChangingClass(false);
      return;
    }

    if (!res.ok) {
      setClassError("Si è verificato un errore. Riprova più tardi.");
      setChangingClass(false);
      return;
    }

    setChangingClass(false);
    router.refresh();
  }

  // ---------------------------------------------------------------------------
  // Eliminazione definitiva
  // ---------------------------------------------------------------------------

  async function handleDelete() {
    setDeleteError(null);

    const confirmed = window.confirm(
      "Eliminare questa transazione? L’operazione è definitiva.",
    );
    if (!confirmed) return;

    setDeleting(true);

    let res: Response;
    try {
      res = await fetch(`/api/transactions/${transaction.id}`, {
        method: "DELETE",
      });
    } catch {
      setDeleteError("Errore di rete. Riprova più tardi.");
      setDeleting(false);
      return;
    }

    if (res.status === 204) {
      router.refresh();
      return;
    }

    if (res.status === 401) {
      setDeleteError("Sessione scaduta. Accedi di nuovo per continuare.");
      setDeleting(false);
      return;
    }

    if (res.status === 404) {
      setDeleteError("Transazione non trovata. Ricarica la pagina.");
      setDeleting(false);
      return;
    }

    setDeleteError("Si è verificato un errore. Riprova più tardi.");
    setDeleting(false);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <li className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-start justify-between gap-4">
        {/* Info transazione */}
        <div className="flex min-w-0 flex-col gap-1">
          {/* Importo */}
          <span
            className={`text-base font-semibold tabular-nums ${
              isInflow
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-zinc-900 dark:text-zinc-50"
            }`}
          >
            {isInflow ? "+" : ""}
            {formatEuroFromCents(transaction.amount_cents)}
          </span>

          {/* Descrizione */}
          {transaction.description && (
            <p className="truncate text-sm text-zinc-700 dark:text-zinc-300">
              {transaction.description}
            </p>
          )}

          {/* Conto e data */}
          <dl className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            <div className="flex gap-1">
              <dt>Conto</dt>
              <dd className="font-medium text-zinc-700 dark:text-zinc-300">
                {transaction.accountName}
              </dd>
            </div>
            <div className="flex gap-1">
              <dt>Data</dt>
              <dd className="font-medium text-zinc-700 dark:text-zinc-300">
                {formatItalianDate(transaction.booked_at)}
              </dd>
            </div>
          </dl>

          {/* Categoria — select inline */}
          <div className="mt-1 flex items-center gap-2">
            <label
              htmlFor={`class-${transaction.id}`}
              className="text-xs text-zinc-500 dark:text-zinc-400"
            >
              Categoria:
            </label>
            <select
              id={`class-${transaction.id}`}
              defaultValue={transaction.class_id ?? ""}
              onChange={handleClassChange}
              disabled={changingClass || deleting}
              aria-label="Cambia categoria di spesa"
              className={selectClass}
            >
              <option value="">— Non assegnata</option>
              {classes.map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {cls.fundName} › {cls.categoryName} › {cls.name}
                </option>
              ))}
            </select>
            {changingClass && (
              <span className="text-xs text-zinc-400 dark:text-zinc-500">
                Salvataggio…
              </span>
            )}
          </div>

          {classError && (
            <p
              role="alert"
              className="text-xs text-red-600 dark:text-red-400"
            >
              {classError}
            </p>
          )}
          {deleteError && (
            <p
              role="alert"
              className="text-xs text-red-600 dark:text-red-400"
            >
              {deleteError}
            </p>
          )}
        </div>

        {/* Azione eliminazione */}
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting || changingClass}
          aria-label="Elimina transazione"
          className="shrink-0 text-sm font-medium text-zinc-400 underline-offset-4 hover:text-red-600 hover:underline focus:outline-none focus:ring-2 focus:ring-red-500/40 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-500 dark:hover:text-red-400"
        >
          {deleting ? "Eliminazione…" : "Elimina"}
        </button>
      </div>
    </li>
  );
}
