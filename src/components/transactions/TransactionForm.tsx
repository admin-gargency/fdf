"use client";

/**
 * TransactionForm — Form creazione transazione manuale.
 *
 * "use client": usa useActionState (stato errore dalla Server Action),
 * useFormStatus (pulsante pending), useState (validazione importo lato client).
 *
 * Campi: conto, categoria di spesa (opzionale), tipo (spesa/entrata),
 * importo, data, descrizione.
 *
 * Ownership: frontend-dev (AGENTS.md §File ownership convention).
 */

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { parseEuroToCents } from "@/lib/domain/transactions";
import type { FormState } from "@/app/transactions/actions";

// ---------------------------------------------------------------------------
// Tipi props
// ---------------------------------------------------------------------------

export interface AccountOption {
  id: string;
  name: string;
  kind: string;
}

export interface ClassOption {
  id: string;
  name: string;
  fundName: string;
  categoryName: string;
}

interface TransactionFormProps {
  accounts: AccountOption[];
  classes: ClassOption[];
  action: (prevState: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
}

// ---------------------------------------------------------------------------
// Stili condivisi
// ---------------------------------------------------------------------------

const inputClass =
  "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-500/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder-zinc-500 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20";

const labelClass = "text-sm font-medium text-zinc-700 dark:text-zinc-300";

// ---------------------------------------------------------------------------
// Data odierna per il default del campo data (formato YYYY-MM-DD)
// ---------------------------------------------------------------------------

function todayIso(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function maxDateIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// SubmitButton
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
// Componente
// ---------------------------------------------------------------------------

export function TransactionForm({
  accounts,
  classes,
  action,
  submitLabel,
}: TransactionFormProps) {
  const [state, formAction] = useActionState(action, { status: "idle" });
  const [amountError, setAmountError] = useState<string | null>(null);

  function handleAmountBlur(e: React.FocusEvent<HTMLInputElement>) {
    const val = e.currentTarget.value.trim();
    if (val === "") {
      setAmountError(null);
      return;
    }
    const cents = parseEuroToCents(val);
    if (cents === null) {
      setAmountError("Importo non valido.");
    } else {
      setAmountError(null);
    }
  }

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {/* Conto */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="account_id" className={labelClass}>
          Conto <span aria-hidden="true">*</span>
        </label>
        <select
          id="account_id"
          name="account_id"
          required
          className={inputClass}
        >
          {accounts.map((acc) => (
            <option key={acc.id} value={acc.id}>
              {acc.name}
            </option>
          ))}
        </select>
      </div>

      {/* Tipo: Spesa / Entrata */}
      <fieldset className="flex flex-col gap-2">
        <legend className={labelClass}>
          Tipo <span aria-hidden="true">*</span>
        </legend>
        <div className="flex gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input
              type="radio"
              name="kind"
              value="spesa"
              defaultChecked
            />
            <span>Spesa</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input
              type="radio"
              name="kind"
              value="entrata"
            />
            <span>Entrata</span>
          </label>
        </div>
      </fieldset>

      {/* Importo */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="amount" className={labelClass}>
          Importo (€) <span aria-hidden="true">*</span>
        </label>
        <input
          id="amount"
          name="amount"
          type="text"
          inputMode="decimal"
          required
          placeholder="0,00"
          onBlur={handleAmountBlur}
          className={inputClass}
        />
        {amountError && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {amountError}
          </p>
        )}
      </div>

      {/* Data */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="booked_at" className={labelClass}>
          Data <span aria-hidden="true">*</span>
        </label>
        <input
          id="booked_at"
          name="booked_at"
          type="date"
          required
          defaultValue={todayIso()}
          max={maxDateIso()}
          className={inputClass}
        />
      </div>

      {/* Categoria di spesa (opzionale) */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="class_id" className={labelClass}>
          Categoria di spesa{" "}
          <span className="font-normal text-zinc-400 dark:text-zinc-500">
            (opzionale)
          </span>
        </label>
        <select
          id="class_id"
          name="class_id"
          className={inputClass}
          defaultValue=""
        >
          <option value="">— Non assegnata</option>
          {classes.map((cls) => (
            <option key={cls.id} value={cls.id}>
              {cls.fundName} › {cls.categoryName} › {cls.name}
            </option>
          ))}
        </select>
      </div>

      {/* Descrizione */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="description" className={labelClass}>
          Descrizione{" "}
          <span className="font-normal text-zinc-400 dark:text-zinc-500">
            (opzionale)
          </span>
        </label>
        <input
          id="description"
          name="description"
          type="text"
          placeholder="Es. Spesa al supermercato"
          maxLength={200}
          className={inputClass}
        />
      </div>

      {/* Errore Server Action */}
      {state.status === "error" && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.message}
        </p>
      )}

      <SubmitButton label={submitLabel} />
    </form>
  );
}
