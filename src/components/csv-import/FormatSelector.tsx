"use client";

/**
 * FormatSelector — Radio group per la selezione del formato CSV.
 *
 * Formati: "fineco" (auto-rilevato) | "generic" (mapping colonne manuale).
 * Brand-neutral: "Formato banca italiana" visibile, "fineco" come valore tecnico.
 *
 * Ownership: frontend-dev (AGENTS.md §File ownership convention).
 */

// ---------------------------------------------------------------------------
// Tipi
// ---------------------------------------------------------------------------

export type CsvFormat = "fineco" | "generic";

interface FormatOption {
  value: CsvFormat;
  label: string;
  description: string;
}

const FORMAT_OPTIONS: FormatOption[] = [
  {
    value: "fineco",
    label: "Formato banca italiana (Fineco)",
    description:
      "Rilevamento automatico colonne. Usa questo formato per i file esportati da Fineco Bank.",
  },
  {
    value: "generic",
    label: "Formato generico (mapping manuale)",
    description:
      "Specifica manualmente quali colonne corrispondono a data, importo e descrizione.",
  },
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface FormatSelectorProps {
  value: CsvFormat | null;
  onChange: (format: CsvFormat) => void;
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function FormatSelector({
  value,
  onChange,
  disabled = false,
}: FormatSelectorProps) {
  return (
    <fieldset
      className="flex flex-col gap-3"
      data-testid="format-selector"
      disabled={disabled}
    >
      <legend className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        Formato del file <span aria-hidden="true">*</span>
      </legend>

      <div className="flex flex-col gap-2 sm:flex-row sm:gap-4">
        {FORMAT_OPTIONS.map((opt) => {
          const isSelected = value === opt.value;
          return (
            <label
              key={opt.value}
              className={[
                "flex flex-1 cursor-pointer flex-col gap-1 rounded-lg border p-4 transition-colors",
                "focus-within:ring-2 focus-within:ring-zinc-500/40",
                isSelected
                  ? "border-zinc-500 bg-zinc-50 dark:border-zinc-400 dark:bg-zinc-800/60"
                  : "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700",
                disabled ? "cursor-not-allowed opacity-60" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="csv-format"
                  value={opt.value}
                  checked={isSelected}
                  onChange={() => onChange(opt.value)}
                  disabled={disabled}
                  className="accent-zinc-700 dark:accent-zinc-300"
                />
                <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                  {opt.label}
                </span>
              </span>
              <span className="ml-6 text-xs text-zinc-500 dark:text-zinc-400">
                {opt.description}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
