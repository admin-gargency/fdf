"use client";

/**
 * ClassForm — Form condiviso per creazione classe.
 *
 * "use client": usa useActionState (stato errore dalla Server Action)
 * e useFormStatus (pulsante pending).
 *
 * Campi: nome, category_id (pre-popolato), tipologia (radio, obbligatorio,
 * nessun default — utente deve scegliere), sort_order (opzionale, default 0).
 *
 * Ownership: frontend-dev (AGENTS.md §File ownership convention).
 */

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { FormState } from "@/app/classes/actions";
import type { CategoryOption } from "./CategorySelector";

// ---------------------------------------------------------------------------
// Tipologia
// ---------------------------------------------------------------------------

type Tipologia = "addebito_immediato" | "fondo_breve" | "fondo_lungo";

const TIPOLOGIA_OPTIONS: {
  value: Tipologia;
  label: string;
  helper: string;
}[] = [
  {
    value: "addebito_immediato",
    label: "Addebito immediato",
    helper: "Spese pagate subito, senza accumulo.",
  },
  {
    value: "fondo_breve",
    label: "Fondo breve termine",
    helper: "Accumulo per obiettivi entro l'anno.",
  },
  {
    value: "fondo_lungo",
    label: "Fondo lungo termine",
    helper: "Accumulo per obiettivi pluriennali.",
  },
];

// ---------------------------------------------------------------------------
// SubmitButton — separato per usare useFormStatus dentro il <form>
// ---------------------------------------------------------------------------

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-900/40 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200 dark:focus:ring-zinc-50/40"
    >
      {pending ? "Salvataggio…" : label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Stili condivisi
// ---------------------------------------------------------------------------

const inputClass =
  "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-500/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder-zinc-500 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20";

const labelClass = "text-sm font-medium text-zinc-700 dark:text-zinc-300";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ClassFormProps {
  action: (prevState: FormState, formData: FormData) => Promise<FormState>;
  categories: CategoryOption[];
  defaultCategoryId?: string;
  defaultFundId?: string;
  submitLabel: string;
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function ClassForm({
  action,
  categories,
  defaultCategoryId,
  defaultFundId,
  submitLabel,
}: ClassFormProps) {
  const [state, formAction] = useActionState(action, { status: "idle" });

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {/* Campo nascosto fund_id per il redirect post-creazione */}
      {defaultFundId && (
        <input type="hidden" name="fund_id" value={defaultFundId} />
      )}
      {/* Nome */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="name" className={labelClass}>
          Nome <span aria-hidden="true">*</span>
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          placeholder="Es. Spesa corrente"
          className={inputClass}
        />
      </div>

      {/* Categoria */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="category_id" className={labelClass}>
          Categoria <span aria-hidden="true">*</span>
        </label>
        <select
          id="category_id"
          name="category_id"
          required
          defaultValue={defaultCategoryId ?? ""}
          className={inputClass}
        >
          <option value="" disabled>
            Seleziona una categoria…
          </option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.name}
            </option>
          ))}
        </select>
      </div>

      {/* Tipologia */}
      <fieldset className="flex flex-col gap-2">
        <legend className={labelClass}>
          Tipologia <span aria-hidden="true">*</span>
        </legend>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          La tipologia determina come questa classe gestisce i fondi nel tempo.
        </p>
        {TIPOLOGIA_OPTIONS.map(({ value, label, helper }) => (
          <label
            key={value}
            className="flex cursor-pointer items-start gap-2.5 text-sm text-zinc-700 dark:text-zinc-300"
          >
            <input
              type="radio"
              name="tipologia"
              value={value}
              required
              className="mt-0.5"
            />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">{label}</span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {helper}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      {/* Ordine */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="sort_order" className={labelClass}>
          Ordine{" "}
          <span className="font-normal text-zinc-400 dark:text-zinc-500">
            (opzionale)
          </span>
        </label>
        <input
          id="sort_order"
          name="sort_order"
          type="number"
          step="1"
          defaultValue={0}
          placeholder="0"
          className={inputClass}
        />
      </div>

      {/* Errore */}
      {state.status === "error" && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.message}
        </p>
      )}

      <SubmitButton label={submitLabel} />
    </form>
  );
}
