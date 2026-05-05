"use client";

/**
 * CategoryForm — Form condiviso per creazione e modifica categoria.
 *
 * "use client": usa useActionState (stato errore dalla Server Action)
 * e useFormStatus (pulsante pending).
 *
 * Ownership: frontend-dev (AGENTS.md §File ownership convention).
 */

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { FormState } from "@/app/categories/actions";
import type { FundOption } from "./FundSelector";

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
// Props
// ---------------------------------------------------------------------------

export interface CategoryFormDefaultValues {
  name?: string;
  fund_id?: string;
  sort_order?: number;
  target_amount_cents?: number | null;
  current_amount_cents?: number;
}

interface CategoryFormProps {
  action: (prevState: FormState, formData: FormData) => Promise<FormState>;
  funds: FundOption[];
  defaultFundId?: string;
  defaultValues?: CategoryFormDefaultValues;
  submitLabel: string;
}

// ---------------------------------------------------------------------------
// Converte centesimi in stringa decimale italiana (es. 1250 → "12,50")
// ---------------------------------------------------------------------------

function centsToDisplay(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}

// ---------------------------------------------------------------------------
// Stili condivisi (reusa token da login/page.tsx)
// ---------------------------------------------------------------------------

const inputClass =
  "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-500/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder-zinc-500 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20";

const labelClass = "text-sm font-medium text-zinc-700 dark:text-zinc-300";

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function CategoryForm({
  action,
  funds,
  defaultFundId,
  defaultValues,
  submitLabel,
}: CategoryFormProps) {
  const [state, formAction] = useActionState(action, { status: "idle" });

  return (
    <form action={formAction} className="flex flex-col gap-5">
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
          defaultValue={defaultValues?.name ?? ""}
          placeholder="Es. Spesa alimentare"
          className={inputClass}
        />
      </div>

      {/* Fondo */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="fund_id" className={labelClass}>
          Fondo <span aria-hidden="true">*</span>
        </label>
        <select
          id="fund_id"
          name="fund_id"
          required
          defaultValue={defaultValues?.fund_id ?? defaultFundId ?? ""}
          className={inputClass}
        >
          <option value="" disabled>
            Seleziona un fondo…
          </option>
          {funds.map((fund) => (
            <option key={fund.id} value={fund.id}>
              {fund.name}
            </option>
          ))}
        </select>
      </div>

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
          defaultValue={defaultValues?.sort_order ?? 0}
          placeholder="0"
          className={inputClass}
        />
      </div>

      {/* Obiettivo */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="target_amount_cents" className={labelClass}>
          Obiettivo (€){" "}
          <span className="font-normal text-zinc-400 dark:text-zinc-500">
            (opzionale)
          </span>
        </label>
        <input
          id="target_amount_cents"
          name="target_amount_cents"
          type="text"
          inputMode="decimal"
          defaultValue={centsToDisplay(defaultValues?.target_amount_cents)}
          placeholder="0,00"
          className={inputClass}
        />
      </div>

      {/* Saldo attuale */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="current_amount_cents" className={labelClass}>
          Saldo attuale (€){" "}
          <span className="font-normal text-zinc-400 dark:text-zinc-500">
            (opzionale)
          </span>
        </label>
        <input
          id="current_amount_cents"
          name="current_amount_cents"
          type="text"
          inputMode="decimal"
          defaultValue={centsToDisplay(defaultValues?.current_amount_cents)}
          placeholder="0,00"
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
