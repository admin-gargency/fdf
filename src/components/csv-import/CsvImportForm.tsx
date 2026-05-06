"use client";

/**
 * CsvImportForm — Client island che orchestra l'intera UI import CSV.
 *
 * Compone: FileDropZone, FormatSelector, ColumnMapper, AccountSelector,
 * ImportSummaryModal.
 *
 * Submit: client fetch verso POST /api/transactions/import-csv.
 * Strategia: client fetch (più semplice per file upload + progress UI,
 * niente workaround useActionState su multipart binario).
 *
 * Ownership: frontend-dev (AGENTS.md §File ownership convention).
 */

import { useState, useCallback } from "react";
import { FileDropZone } from "./FileDropZone";
import { FormatSelector } from "./FormatSelector";
import { ColumnMapper } from "./ColumnMapper";
import { AccountSelector } from "./AccountSelector";
import { ImportSummaryModal } from "./ImportSummaryModal";
import type { CsvFormat } from "./FormatSelector";
import type { AccountOption } from "./AccountSelector";
import type { ImportResult } from "./ImportSummaryModal";
import type { GenericColumnMap } from "@/lib/domain/csv-import";

// ---------------------------------------------------------------------------
// Mappa error code → messaggio italiano
// ---------------------------------------------------------------------------

function mapApiError(code: string, retryAfter?: string): string {
  switch (code) {
    case "RATE_LIMIT_EXCEEDED":
      return retryAfter
        ? `Troppe importazioni. Riprova tra ${retryAfter} secondi.`
        : "Troppe importazioni. Riprova più tardi.";
    case "PAYLOAD_TOO_LARGE":
      return "File troppo grande (max 5MB).";
    case "INVALID_FILE_TYPE":
      return "Formato file non supportato. Usa .csv o .txt.";
    case "ACCOUNT_NOT_FOUND":
      return "Conto non trovato.";
    case "CSV_PARSE_ERROR":
      return "Errore nel parsing del CSV. Vedi dettagli.";
    case "MISSING_FILE":
      return "Seleziona un file da importare.";
    case "EMPTY_FILE":
      return "Il file selezionato è vuoto.";
    case "UNAUTHENTICATED":
      return "Sessione scaduta. Ricarica la pagina e accedi di nuovo.";
    case "UNSUPPORTED_CONTENT_TYPE":
      return "Errore di configurazione. Riprova.";
    case "VALIDATION_ERROR":
      return "Dati non validi. Controlla i campi e riprova.";
    default:
      return "Si è verificato un errore. Riprova più tardi.";
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CsvImportFormProps {
  accounts: AccountOption[];
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function CsvImportForm({ accounts }: CsvImportFormProps) {
  // Stato form
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [format, setFormat] = useState<CsvFormat | null>(null);
  const [columnMap, setColumnMap] = useState<GenericColumnMap | null>(null);
  const [accountId, setAccountId] = useState<string>("");

  // Stato submit
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Stato modale
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  // Reset column map quando cambia il formato (evita stato stale)
  function handleFormatChange(newFormat: CsvFormat) {
    setFormat(newFormat);
    setColumnMap(null);
  }

  // Reset column map quando cambia il file
  const handleFileSelect = useCallback((file: File | null) => {
    setSelectedFile(file);
    setColumnMap(null);
  }, []);

  // Calcola se il submit è abilitato
  const canSubmit = (() => {
    if (!selectedFile) return false;
    if (!format) return false;
    if (!accountId) return false;
    if (format === "generic" && !columnMap) return false;
    return true;
  })();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit || !selectedFile || !format || !accountId) return;

    setSubmitting(true);
    setSubmitError(null);

    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("account_id", accountId);
    formData.append("format", format);
    if (format === "generic" && columnMap) {
      formData.append("column_map", JSON.stringify(columnMap));
    }
    formData.append("auto_categorize", "false");

    let res: Response;
    try {
      res = await fetch("/api/transactions/import-csv", {
        method: "POST",
        body: formData,
      });
    } catch {
      setSubmitting(false);
      setSubmitError("Errore di rete. Controlla la connessione e riprova.");
      return;
    }

    if (res.status === 201) {
      let data: ImportResult;
      try {
        data = (await res.json()) as ImportResult;
      } catch {
        setSubmitting(false);
        setSubmitError("Risposta dal server non valida. Riprova più tardi.");
        return;
      }
      setSubmitting(false);
      setImportResult(data);
      return;
    }

    // Gestione errori 4xx / 5xx
    const retryAfter = res.headers.get("Retry-After") ?? undefined;
    let code = "UNKNOWN";
    try {
      const errBody = (await res.json()) as { code?: string };
      if (typeof errBody.code === "string") {
        code = errBody.code;
      }
    } catch {
      // body non JSON — usa codice di fallback
    }

    setSubmitting(false);
    setSubmitError(mapApiError(code, retryAfter));
  }

  function handleCloseModal() {
    setImportResult(null);
    // Reset form
    setSelectedFile(null);
    setFormat(null);
    setColumnMap(null);
    setAccountId("");
    setSubmitError(null);
  }

  const sectionClass =
    "rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950";

  return (
    <>
      <form
        onSubmit={handleSubmit}
        noValidate
        className="flex flex-col gap-5"
      >
        {/* 1. File drop zone */}
        <section className={sectionClass} aria-label="Selezione file">
          <h2 className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            1. Seleziona il file CSV
          </h2>
          <FileDropZone
            onFileSelect={handleFileSelect}
            selectedFile={selectedFile}
            disabled={submitting}
          />
        </section>

        {/* 2. Format selector */}
        <section className={sectionClass} aria-label="Formato file">
          <h2 className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            2. Scegli il formato
          </h2>
          <FormatSelector
            value={format}
            onChange={handleFormatChange}
            disabled={submitting}
          />
        </section>

        {/* 3. Column mapper (solo se format=generic e file selezionato) */}
        {format === "generic" && selectedFile && (
          <section className={sectionClass} aria-label="Mapping colonne">
            <h2 className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              3. Mappa le colonne
            </h2>
            <ColumnMapper
              file={selectedFile}
              confirmedMap={columnMap}
              onConfirm={setColumnMap}
              disabled={submitting}
            />
          </section>
        )}

        {/* 4. Account selector */}
        <section className={sectionClass} aria-label="Selezione conto">
          <h2 className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {format === "generic" && selectedFile ? "4." : "3."} Seleziona il
            conto
          </h2>
          <AccountSelector
            accounts={accounts}
            value={accountId}
            onChange={setAccountId}
            disabled={submitting}
          />
        </section>

        {/* Errore submit */}
        {submitError && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {submitError}
          </p>
        )}

        {/* 5. Submit button */}
        <button
          type="submit"
          disabled={!canSubmit || submitting}
          data-testid="submit-import"
          className="rounded-lg bg-zinc-900 px-5 py-3 text-sm font-medium text-white hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-900/40 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200 dark:focus:ring-zinc-50/40"
        >
          {submitting ? (
            <span className="flex items-center justify-center gap-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                className="h-4 w-4 animate-spin"
                aria-hidden="true"
              >
                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="3"
                  className="opacity-25"
                />
                <path
                  fill="currentColor"
                  d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4Z"
                  className="opacity-75"
                />
              </svg>
              Importazione in corso...
            </span>
          ) : (
            "Importa transazioni"
          )}
        </button>
      </form>

      {/* Modale riepilogo */}
      {importResult && (
        <ImportSummaryModal result={importResult} onClose={handleCloseModal} />
      )}
    </>
  );
}
