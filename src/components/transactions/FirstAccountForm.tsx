"use client";

/**
 * FirstAccountForm — Form minimale per creare il primo conto.
 *
 * "use client": usa useActionState e useFormStatus.
 *
 * Mostrato nella pagina /transactions/new quando l'utente
 * non ha ancora alcun conto configurato.
 *
 * Ownership: frontend-dev (AGENTS.md §File ownership convention).
 */

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { FormState } from "@/app/transactions/actions";

// ---------------------------------------------------------------------------
// Stili condivisi
// ---------------------------------------------------------------------------

const inputClass =
  "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-500/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder-zinc-500 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20";

const labelClass = "text-sm font-medium text-zinc-700 dark:text-zinc-300";

// ---------------------------------------------------------------------------
// SubmitButton
// ---------------------------------------------------------------------------

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-900/40 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200 dark:focus:ring-zinc-50/40"
    >
      {pending ? "Creazione…" : "Crea conto"}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface FirstAccountFormProps {
  action: (prevState: FormState, formData: FormData) => Promise<FormState>;
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function FirstAccountForm({ action }: FirstAccountFormProps) {
  const [state, formAction] = useActionState(action, { status: "idle" });

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {/* Nome */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="account-name" className={labelClass}>
          Nome del conto <span aria-hidden="true">*</span>
        </label>
        <input
          id="account-name"
          name="name"
          type="text"
          required
          placeholder="Es. Conto Principale"
          className={inputClass}
        />
      </div>

      {/* Tipo */}
      <fieldset className="flex flex-col gap-2">
        <legend className={labelClass}>
          Tipo <span aria-hidden="true">*</span>
        </legend>
        <div className="flex flex-col gap-2">
          <label className="flex cursor-pointer items-start gap-2.5 text-sm text-zinc-700 dark:text-zinc-300">
            <input
              type="radio"
              name="kind"
              value="corrente"
              defaultChecked
              className="mt-0.5"
            />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">Conto corrente</span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                Conto bancario principale per spese quotidiane.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2.5 text-sm text-zinc-700 dark:text-zinc-300">
            <input
              type="radio"
              name="kind"
              value="fondi"
              className="mt-0.5"
            />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">Conto fondi</span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                Conto dedicato all&apos;accumulo dei sinking funds.
              </span>
            </span>
          </label>
        </div>
      </fieldset>

      {/* Errore */}
      {state.status === "error" && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.message}
        </p>
      )}

      <SubmitButton />
    </form>
  );
}
