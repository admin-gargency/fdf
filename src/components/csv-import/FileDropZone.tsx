"use client";

/**
 * FileDropZone — Drag-and-drop file input per l'import CSV.
 *
 * Accetta .csv e .txt, max 5MB.
 * Validation client-side: estensione + dimensione.
 * Mostra filename + size dopo selezione.
 *
 * Ownership: frontend-dev (AGENTS.md §File ownership convention).
 */

import { useRef, useState, useCallback } from "react";

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_EXTENSIONS = [".csv", ".txt"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function validateFile(file: File): string | null {
  const lower = file.name.toLowerCase();
  const validExt = ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext));
  if (!validExt) {
    return "Formato file non supportato. Usa .csv o .txt.";
  }
  if (file.size > MAX_BYTES) {
    return "File troppo grande (max 5MB).";
  }
  if (file.size === 0) {
    return "Il file è vuoto.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface FileDropZoneProps {
  onFileSelect: (file: File | null) => void;
  selectedFile: File | null;
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function FileDropZone({
  onFileSelect,
  selectedFile,
  disabled = false,
}: FileDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(
    (file: File) => {
      const err = validateFile(file);
      if (err) {
        setError(err);
        onFileSelect(null);
      } else {
        setError(null);
        onFileSelect(file);
      }
    },
    [onFileSelect],
  );

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0];
    if (file) {
      handleFile(file);
    }
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (!disabled) setDragging(true);
  }

  function handleDragLeave() {
    setDragging(false);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleFile(file);
    }
  }

  function handleClickZone() {
    if (!disabled) {
      inputRef.current?.click();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClickZone();
    }
  }

  function handleRemove(e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    setError(null);
    onFileSelect(null);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  const zoneBase =
    "relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors";
  const zoneIdle =
    "border-zinc-300 bg-zinc-50 hover:border-zinc-400 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-600 dark:hover:bg-zinc-800/60";
  const zoneDragging =
    "border-zinc-500 bg-zinc-100 dark:border-zinc-400 dark:bg-zinc-800/70";
  const zoneDisabled =
    "cursor-not-allowed border-zinc-200 bg-zinc-50 opacity-60 dark:border-zinc-800 dark:bg-zinc-900/60";
  const zoneSelected =
    "border-zinc-400 bg-white dark:border-zinc-600 dark:bg-zinc-900";

  let zoneClass = zoneBase;
  if (disabled) {
    zoneClass += ` ${zoneDisabled}`;
  } else if (selectedFile) {
    zoneClass += ` ${zoneSelected} cursor-pointer`;
  } else if (dragging) {
    zoneClass += ` ${zoneDragging} cursor-copy`;
  } else {
    zoneClass += ` ${zoneIdle} cursor-pointer`;
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Hidden file input */}
      <input
        ref={inputRef}
        id="csv-file-input"
        type="file"
        accept=".csv,.txt"
        className="sr-only"
        onChange={handleInputChange}
        disabled={disabled}
        aria-label="Seleziona file CSV o TXT"
        data-testid="csv-file-input"
      />

      {/* Drop zone */}
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label="Zona caricamento file — clicca o trascina un file CSV"
        aria-disabled={disabled}
        data-testid="csv-drop-zone"
        className={zoneClass}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClickZone}
        onKeyDown={handleKeyDown}
      >
        {selectedFile ? (
          <div className="flex w-full flex-col items-center gap-3">
            {/* File icon */}
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="h-5 w-5 text-zinc-500 dark:text-zinc-400"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
                />
              </svg>
            </div>

            {/* File info */}
            <div className="flex flex-col items-center gap-0.5">
              <span className="max-w-xs truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {selectedFile.name}
              </span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {formatFileSize(selectedFile.size)}
              </span>
            </div>

            {/* Remove button */}
            <button
              type="button"
              onClick={handleRemove}
              aria-label={`Rimuovi file ${selectedFile.name}`}
              className="mt-1 rounded-md px-3 py-1 text-xs font-medium text-zinc-500 ring-1 ring-zinc-300 hover:text-zinc-700 hover:ring-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-500/40 dark:text-zinc-400 dark:ring-zinc-700 dark:hover:text-zinc-200 dark:hover:ring-zinc-500"
            >
              Rimuovi
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            {/* Upload icon */}
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="h-5 w-5 text-zinc-500 dark:text-zinc-400"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"
                />
              </svg>
            </div>

            <div className="flex flex-col items-center gap-1">
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Trascina qui il tuo file CSV
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                oppure{" "}
                <span className="font-medium text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-300">
                  clicca per selezionare
                </span>
              </p>
              <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
                .csv o .txt — max 5 MB
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Errore validazione */}
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
