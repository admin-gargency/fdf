"use client";

/**
 * ColumnMapper — Anteprima CSV e mapping colonne per formato generico.
 *
 * Parsa le prime 5 righe del file via parseCsv (client-side).
 * Mostra tabella di anteprima + 3 dropdown obbligatori (data, importo,
 * descrizione) + 1 dropdown opzionale (categoria).
 *
 * Il mapping viene confermato con il pulsante "Conferma mapping" e
 * comunicato al genitore via onConfirm.
 *
 * Ownership: frontend-dev (AGENTS.md §File ownership convention).
 */

import { useState, useEffect } from "react";
import { parseCsv } from "@/lib/ingestion/generic-csv";
import type { GenericColumnMap } from "@/lib/domain/csv-import";

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

const PREVIEW_ROWS = 5;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ColumnMapperProps {
  file: File;
  confirmedMap: GenericColumnMap | null;
  onConfirm: (map: GenericColumnMap) => void;
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Stili condivisi
// ---------------------------------------------------------------------------

const selectClass =
  "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-500/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20";

const labelClass = "text-sm font-medium text-zinc-700 dark:text-zinc-300";

// ---------------------------------------------------------------------------
// Stato parsed CSV (solo headers + prime righe preview)
// ---------------------------------------------------------------------------

interface ParsedPreview {
  headers: string[];
  rows: Record<string, string>[];
  error: string | null;
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function ColumnMapper({
  file,
  confirmedMap,
  onConfirm,
  disabled = false,
}: ColumnMapperProps) {
  const [preview, setPreview] = useState<ParsedPreview | null>(null);
  const [dateCol, setDateCol] = useState<string>("");
  const [amountCol, setAmountCol] = useState<string>("");
  const [descriptionCol, setDescriptionCol] = useState<string>("");
  const [categoryCol, setCategoryCol] = useState<string>("");
  const [mapError, setMapError] = useState<string | null>(null);

  // Parse CSV lato client al mount o al cambio file
  useEffect(() => {
    let cancelled = false;
    file
      .text()
      .then((text) => {
        if (cancelled) return;
        try {
          const parsed = parseCsv(text);
          const rows = parsed.rows.slice(0, PREVIEW_ROWS);
          setPreview({ headers: parsed.headers, rows, error: null });
          // Reset mapping on new file
          setDateCol("");
          setAmountCol("");
          setDescriptionCol("");
          setCategoryCol("");
          setMapError(null);
        } catch {
          setPreview({
            headers: [],
            rows: [],
            error: "Impossibile leggere il file CSV.",
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPreview({
            headers: [],
            rows: [],
            error: "Errore durante la lettura del file.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [file]);

  function handleConfirm() {
    if (!dateCol || !amountCol || !descriptionCol) {
      setMapError(
        "Seleziona le colonne obbligatorie: Data, Importo e Descrizione.",
      );
      return;
    }
    setMapError(null);
    const map: GenericColumnMap = {
      date: dateCol,
      amount: amountCol,
      description: descriptionCol,
    };
    if (categoryCol) {
      map.category = categoryCol;
    }
    onConfirm(map);
  }

  if (!preview) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 p-6 dark:border-zinc-800 dark:bg-zinc-900"
        data-testid="column-mapper"
      >
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Lettura del file in corso...
        </p>
      </div>
    );
  }

  if (preview.error) {
    return (
      <div
        className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20"
        data-testid="column-mapper"
      >
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {preview.error}
        </p>
      </div>
    );
  }

  const headers = preview.headers;
  const previewRows = preview.rows;
  const isConfirmed =
    confirmedMap !== null &&
    confirmedMap.date === dateCol &&
    confirmedMap.amount === amountCol &&
    confirmedMap.description === descriptionCol;

  return (
    <div
      className="flex flex-col gap-5"
      data-testid="column-mapper"
    >
      {/* Titolo sezione */}
      <div>
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Mapping colonne
        </h3>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          Indica quali colonne del tuo CSV corrispondono a data, importo e
          descrizione.
        </p>
      </div>

      {/* Tabella anteprima */}
      {previewRows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="min-w-full divide-y divide-zinc-200 text-xs dark:divide-zinc-800">
            <thead className="bg-zinc-50 dark:bg-zinc-900">
              <tr>
                {headers.map((h) => (
                  <th
                    key={h}
                    scope="col"
                    className="px-3 py-2 text-left font-medium text-zinc-600 dark:text-zinc-400"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 bg-white dark:divide-zinc-800/60 dark:bg-zinc-950">
              {previewRows.map((row, idx) => (
                <tr key={idx}>
                  {headers.map((h) => (
                    <td
                      key={h}
                      className="max-w-[160px] truncate px-3 py-2 text-zinc-700 dark:text-zinc-300"
                    >
                      {row[h] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-3 py-1.5 text-right text-xs text-zinc-400 dark:text-zinc-500">
            Anteprima prime {Math.min(PREVIEW_ROWS, previewRows.length)} righe
          </p>
        </div>
      )}

      {/* Dropdown mapping */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Colonna Data */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="col-map-date" className={labelClass}>
            Colonna Data <span aria-hidden="true">*</span>
          </label>
          <select
            id="col-map-date"
            value={dateCol}
            onChange={(e) => setDateCol(e.currentTarget.value)}
            disabled={disabled}
            className={selectClass}
            data-testid="column-map-date"
          >
            <option value="">— Seleziona colonna</option>
            {headers.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </div>

        {/* Colonna Importo */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="col-map-amount" className={labelClass}>
            Colonna Importo <span aria-hidden="true">*</span>
          </label>
          <select
            id="col-map-amount"
            value={amountCol}
            onChange={(e) => setAmountCol(e.currentTarget.value)}
            disabled={disabled}
            className={selectClass}
            data-testid="column-map-amount"
          >
            <option value="">— Seleziona colonna</option>
            {headers.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </div>

        {/* Colonna Descrizione */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="col-map-description" className={labelClass}>
            Colonna Descrizione <span aria-hidden="true">*</span>
          </label>
          <select
            id="col-map-description"
            value={descriptionCol}
            onChange={(e) => setDescriptionCol(e.currentTarget.value)}
            disabled={disabled}
            className={selectClass}
            data-testid="column-map-description"
          >
            <option value="">— Seleziona colonna</option>
            {headers.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </div>

        {/* Colonna Categoria (opzionale) */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="col-map-category" className={labelClass}>
            Colonna Categoria{" "}
            <span className="font-normal text-zinc-400 dark:text-zinc-500">
              (opzionale)
            </span>
          </label>
          <select
            id="col-map-category"
            value={categoryCol}
            onChange={(e) => setCategoryCol(e.currentTarget.value)}
            disabled={disabled}
            className={selectClass}
          >
            <option value="">— Nessuna</option>
            {headers.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Errore mapping */}
      {mapError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {mapError}
        </p>
      )}

      {/* Pulsante conferma */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleConfirm}
          disabled={disabled}
          className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-500/40 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800"
        >
          Conferma mapping
        </button>

        {isConfirmed && (
          <span className="flex items-center gap-1 text-sm text-zinc-600 dark:text-zinc-400">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-4 w-4 text-green-600 dark:text-green-400"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z"
                clipRule="evenodd"
              />
            </svg>
            Mapping confermato
          </span>
        )}
      </div>
    </div>
  );
}
