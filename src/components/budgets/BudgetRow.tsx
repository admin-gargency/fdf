"use client";

/**
 * BudgetRow — Riga budget con editing inline importo ed eliminazione.
 *
 * "use client": gestisce useState (editing, error, loading), useRouter
 * (refresh dopo mutazione), input inline onBlur/Enter.
 *
 * Mutazioni:
 * - Modifica importo: click → input → blur o Enter → PUT /api/budgets/{id}
 * - Eliminazione: window.confirm → DELETE /api/budgets/{id}
 *
 * Colori progress bar:
 *   < 90%             → verde
 *   >= 90% && <= 100% → giallo
 *   > 100%            → rosso
 *
 * Ownership: frontend-dev (AGENTS.md §File ownership convention).
 */

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { formatEuroFromCents } from "@/lib/format/currency";
import type { BudgetSummary } from "@/lib/domain/budgets";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface BudgetRowItem extends BudgetSummary {
  id: string;
  category_name: string;
}

interface BudgetRowProps {
  row: BudgetRowItem;
}

// ---------------------------------------------------------------------------
// Helper: colore progress bar
// ---------------------------------------------------------------------------

function progressColor(pct: number): string {
  if (pct > 100) return "bg-red-500 dark:bg-red-400";
  if (pct >= 90) return "bg-yellow-400 dark:bg-yellow-300";
  return "bg-emerald-500 dark:bg-emerald-400";
}

function progressTextColor(pct: number): string {
  if (pct > 100) return "text-red-600 dark:text-red-400";
  if (pct >= 90) return "text-yellow-600 dark:text-yellow-400";
  return "text-emerald-600 dark:text-emerald-400";
}

// ---------------------------------------------------------------------------
// Stili condivisi
// ---------------------------------------------------------------------------

const inputClass =
  "w-28 rounded border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 tabular-nums focus:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-500/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20";

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function BudgetRow({ row }: BudgetRowProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // ---------------------------------------------------------------------------
  // Modifica importo inline
  // ---------------------------------------------------------------------------

  function handleBudgetClick() {
    if (!editing && !saving && !deleting) {
      setEditing(true);
      setEditError(null);
      // Focus dopo il prossimo render
      setTimeout(() => inputRef.current?.select(), 0);
    }
  }

  async function commitEdit() {
    if (!editing) return;
    const raw = inputRef.current?.value.trim() ?? "";
    const euro = parseFloat(raw.replace(",", "."));

    if (raw === "") {
      // Annulla senza modificare
      setEditing(false);
      return;
    }

    if (isNaN(euro) || euro < 0) {
      setEditError("Importo non valido (≥ 0).");
      return;
    }

    const amount_cents = Math.round(euro * 100);
    setSaving(true);
    setEditError(null);

    let res: Response;
    try {
      res = await fetch(`/api/budgets/${row.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount_cents }),
      });
    } catch {
      setEditError("Errore di rete. Riprova più tardi.");
      setSaving(false);
      return;
    }

    setSaving(false);

    if (res.status === 401) {
      setEditError("Sessione scaduta. Accedi di nuovo.");
      return;
    }
    if (res.status === 400) {
      setEditError("Importo non valido.");
      return;
    }
    if (res.status === 404) {
      setEditError("Budget non trovato. Ricarica la pagina.");
      return;
    }
    if (!res.ok) {
      setEditError("Si è verificato un errore. Riprova più tardi.");
      return;
    }

    setEditing(false);
    router.refresh();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void commitEdit();
    }
    if (e.key === "Escape") {
      setEditing(false);
      setEditError(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Eliminazione
  // ---------------------------------------------------------------------------

  async function handleDelete() {
    setDeleteError(null);
    const confirmed = window.confirm(
      "Eliminare questo budget? L'operazione è definitiva.",
    );
    if (!confirmed) return;

    setDeleting(true);

    let res: Response;
    try {
      res = await fetch(`/api/budgets/${row.id}`, { method: "DELETE" });
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
      setDeleteError("Sessione scaduta. Accedi di nuovo.");
    } else if (res.status === 404) {
      setDeleteError("Budget non trovato. Ricarica la pagina.");
    } else {
      setDeleteError("Si è verificato un errore. Riprova più tardi.");
    }
    setDeleting(false);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const progressClamped = Math.min(row.progress_pct, 100);
  const isOverBudget = row.delta_cents < 0;

  return (
    <li
      data-testid={`budget-row-${row.class_id}`}
      className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        {/* Info classe */}
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
            {row.class_name ?? row.class_id}
          </span>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {row.category_name}
          </span>
        </div>

        {/* Importi */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 sm:shrink-0">
          {/* Budget — cliccabile per editing inline */}
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              Pianificato
            </span>
            {editing ? (
              <div className="flex items-center gap-1">
                <input
                  ref={inputRef}
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={(row.budget_cents / 100).toFixed(2)}
                  onBlur={() => void commitEdit()}
                  onKeyDown={handleKeyDown}
                  aria-label={`Modifica budget per ${row.class_name ?? row.class_id}`}
                  className={inputClass}
                />
                {saving && (
                  <span className="text-xs text-zinc-400 dark:text-zinc-500">
                    Salvo…
                  </span>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={handleBudgetClick}
                disabled={saving || deleting}
                aria-label={`Modifica importo budget per ${row.class_name ?? row.class_id}`}
                className="text-sm font-semibold tabular-nums text-zinc-900 underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-zinc-900/30 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-50 dark:focus:ring-zinc-50/30"
              >
                {formatEuroFromCents(row.budget_cents)}
              </button>
            )}
            {editError && (
              <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                {editError}
              </p>
            )}
          </div>

          {/* Actual (speso) */}
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              Speso
            </span>
            <span className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
              {formatEuroFromCents(row.actual_cents)}
            </span>
          </div>

          {/* Delta */}
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              Differenza
            </span>
            <span
              className={`text-sm font-semibold tabular-nums ${
                isOverBudget
                  ? "text-red-600 dark:text-red-400"
                  : "text-emerald-600 dark:text-emerald-400"
              }`}
            >
              {isOverBudget ? "" : "+"}
              {formatEuroFromCents(row.delta_cents)}
            </span>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-3">
        <div
          role="progressbar"
          aria-valuenow={row.progress_pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Utilizzo budget: ${row.progress_pct}%`}
          data-testid="progress-bar"
          className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
        >
          <div
            className={`h-full rounded-full transition-all ${progressColor(row.progress_pct)}`}
            style={{ width: `${progressClamped}%` }}
          />
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span
            className={`text-xs font-medium ${progressTextColor(row.progress_pct)}`}
          >
            {row.progress_pct.toFixed(1)}%
          </span>
          {row.progress_pct > 100 && (
            <span className="text-xs font-medium text-red-600 dark:text-red-400">
              Sforato di {formatEuroFromCents(Math.abs(row.delta_cents))}
            </span>
          )}
        </div>
      </div>

      {/* Errori / azioni */}
      <div className="mt-3 flex items-center justify-between">
        {deleteError && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {deleteError}
          </p>
        )}
        <div className="ml-auto">
          <button
            type="button"
            onClick={() => void handleDelete()}
            disabled={deleting || editing || saving}
            aria-label={`Elimina budget per ${row.class_name ?? row.class_id}`}
            className="text-sm font-medium text-zinc-400 underline-offset-4 hover:text-red-600 hover:underline focus:outline-none focus:ring-2 focus:ring-red-500/40 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-500 dark:hover:text-red-400"
          >
            {deleting ? "Eliminazione…" : "Elimina"}
          </button>
        </div>
      </div>
    </li>
  );
}
