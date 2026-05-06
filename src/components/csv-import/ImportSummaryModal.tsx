"use client";

/**
 * ImportSummaryModal — Modal di riepilogo post-importazione CSV.
 *
 * Mostra: transazioni importate, saltate (duplicati), lista errori collassabile.
 * Pulsante "Categorizza automaticamente" — DISABLED (Feature 9 futura).
 * Pulsante "Vai a Transazioni" → /transactions?month=YYYY-MM corrente.
 * Pulsante "Chiudi" → callback al genitore (reset form).
 *
 * Ownership: frontend-dev (AGENTS.md §File ownership convention).
 */

import { useState } from "react";

// ---------------------------------------------------------------------------
// Tipi
// ---------------------------------------------------------------------------

export interface ImportError {
  line: number;
  field?: string;
  message: string;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: ImportError[];
}

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

const MAX_ERRORS_VISIBLE = 20;

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function currentMonthIso(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ImportSummaryModalProps {
  result: ImportResult;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function ImportSummaryModal({
  result,
  onClose,
}: ImportSummaryModalProps) {
  const [showAllErrors, setShowAllErrors] = useState(false);

  const { imported, skipped, errors } = result;
  const visibleErrors = showAllErrors
    ? errors
    : errors.slice(0, MAX_ERRORS_VISIBLE);
  const hiddenCount = errors.length - MAX_ERRORS_VISIBLE;

  const transactionsUrl = `/transactions?month=${currentMonthIso()}`;

  return (
    // Overlay
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-modal-title"
      data-testid="import-summary-modal"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-4 pb-4 pt-16 sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Pannello modale */}
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl dark:bg-zinc-900">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2
              id="import-modal-title"
              className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
            >
              Importazione completata
            </h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Le transazioni sono state elaborate.
            </p>
          </div>

          {/* Close X */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Chiudi finestra di riepilogo"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-zinc-500/40 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-5 w-5"
              aria-hidden="true"
            >
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>

        {/* Statistiche */}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-0.5 rounded-lg bg-green-50 px-4 py-3 dark:bg-green-900/20">
            <span className="text-2xl font-bold tabular-nums text-green-700 dark:text-green-400">
              {imported}
            </span>
            <span className="text-xs font-medium text-green-600 dark:text-green-500">
              transazioni importate
            </span>
          </div>

          <div className="flex flex-col gap-0.5 rounded-lg bg-zinc-50 px-4 py-3 dark:bg-zinc-800">
            <span className="text-2xl font-bold tabular-nums text-zinc-700 dark:text-zinc-300">
              {skipped}
            </span>
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              saltate (duplicati)
            </span>
          </div>
        </div>

        {/* Sezione errori (collassabile) */}
        {errors.length > 0 && (
          <details className="mt-4 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800/50 dark:bg-amber-900/10">
            <summary className="flex cursor-pointer select-none items-center justify-between px-4 py-3 text-sm font-medium text-amber-800 dark:text-amber-400">
              <span>
                {errors.length}{" "}
                {errors.length === 1 ? "riga con errore" : "righe con errore"}
              </span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-4 w-4"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
                  clipRule="evenodd"
                />
              </svg>
            </summary>

            <ul className="divide-y divide-amber-100 px-4 pb-3 dark:divide-amber-800/30">
              {visibleErrors.map((err) => (
                <li
                  key={err.line}
                  className="py-2 text-xs text-amber-700 dark:text-amber-400"
                  data-testid={`import-error-${err.line}`}
                >
                  <span className="font-medium">Riga {err.line}</span>
                  {err.field && (
                    <span className="text-amber-600 dark:text-amber-500">
                      {" "}
                      [{err.field}]
                    </span>
                  )}
                  {": "}
                  {err.message}
                </li>
              ))}
            </ul>

            {!showAllErrors && hiddenCount > 0 && (
              <div className="px-4 pb-3">
                <button
                  type="button"
                  onClick={() => setShowAllErrors(true)}
                  className="text-xs font-medium text-amber-700 underline-offset-2 hover:underline dark:text-amber-400"
                >
                  Mostra altri {hiddenCount} errori
                </button>
              </div>
            )}
          </details>
        )}

        {/* Pulsanti azione */}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-between">
          {/* Categorizza automaticamente — DISABLED (Feature 9) */}
          <div className="group relative">
            <button
              type="button"
              disabled
              aria-disabled="true"
              aria-describedby="auto-cat-tooltip"
              className="cursor-not-allowed rounded-lg border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-400 dark:border-zinc-700 dark:text-zinc-600"
            >
              Categorizza automaticamente
            </button>
            <span
              id="auto-cat-tooltip"
              role="tooltip"
              className="pointer-events-none absolute bottom-full left-0 mb-2 w-max max-w-xs rounded-md bg-zinc-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100 dark:bg-zinc-700"
            >
              Disponibile in Feature 9
            </span>
          </div>

          {/* Azioni primarie */}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-500/40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 sm:flex-none"
            >
              Chiudi
            </button>

            <a
              href={transactionsUrl}
              className="flex-1 rounded-lg bg-zinc-900 px-4 py-2.5 text-center text-sm font-medium text-white hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-900/40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200 dark:focus:ring-zinc-50/40 sm:flex-none"
            >
              Vai a Transazioni
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
