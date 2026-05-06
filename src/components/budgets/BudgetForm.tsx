"use client";

/**
 * BudgetForm — Form creazione budget mensile.
 *
 * "use client": usa useActionState (stato errore dalla Server Action),
 * useFormStatus (pulsante pending).
 *
 * Campi: mese (input type="month"), classe (select raggruppata per categoria
 * via optgroup), importo (input type="number" step="0.01").
 *
 * Ownership: frontend-dev (AGENTS.md §File ownership convention).
 */

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { FormState } from "@/app/budgets/actions";

// ---------------------------------------------------------------------------
// Tipi props
// ---------------------------------------------------------------------------

export interface ClassOptionForBudget {
  id: string;
  name: string;
  categoryName: string;
  fundName: string;
}

interface BudgetFormProps {
  classes: ClassOptionForBudget[];
  defaultPeriod: string; // "YYYY-MM"
  defaultClassId?: string;
  action: (prevState: FormState, formData: FormData) => Promise<FormState>;
}

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
      {pending ? "Salvataggio…" : "Salva budget"}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Raggruppa classi per categoria
// ---------------------------------------------------------------------------

function groupByCategory(
  classes: ClassOptionForBudget[],
): [string, ClassOptionForBudget[]][] {
  const map = new Map<string, ClassOptionForBudget[]>();
  for (const cls of classes) {
    const key = `${cls.fundName} › ${cls.categoryName}`;
    const existing = map.get(key);
    if (existing) {
      existing.push(cls);
    } else {
      map.set(key, [cls]);
    }
  }
  return Array.from(map.entries());
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function BudgetForm({
  classes,
  defaultPeriod,
  defaultClassId,
  action,
}: BudgetFormProps) {
  const [state, formAction] = useActionState(action, { status: "idle" });

  const groups = groupByCategory(classes);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {/* Mese */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="period" className={labelClass}>
          Mese <span aria-hidden="true">*</span>
        </label>
        <input
          id="period"
          name="period"
          type="month"
          required
          defaultValue={defaultPeriod}
          aria-invalid={
            state.status === "error" && state.field === "period"
              ? "true"
              : undefined
          }
          className={inputClass}
        />
        {state.status === "error" && state.field === "period" && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {state.message}
          </p>
        )}
      </div>

      {/* Classe di spesa */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="class_id" className={labelClass}>
          Classe di spesa <span aria-hidden="true">*</span>
        </label>
        {classes.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Nessuna classe disponibile. Crea prima un fondo e una categoria con
            almeno una classe.
          </p>
        ) : (
          <select
            id="class_id"
            name="class_id"
            required
            defaultValue={defaultClassId ?? ""}
            aria-invalid={
              state.status === "error" && state.field === "class_id"
                ? "true"
                : undefined
            }
            className={inputClass}
          >
            <option value="" disabled>
              — Seleziona una classe
            </option>
            {groups.map(([groupLabel, groupClasses]) => (
              <optgroup key={groupLabel} label={groupLabel}>
                {groupClasses.map((cls) => (
                  <option key={cls.id} value={cls.id}>
                    {cls.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        )}
        {state.status === "error" && state.field === "class_id" && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {state.message}
          </p>
        )}
      </div>

      {/* Importo */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="amount" className={labelClass}>
          Importo (€) <span aria-hidden="true">*</span>
        </label>
        <input
          id="amount"
          name="amount"
          type="number"
          step="0.01"
          min="0"
          required
          placeholder="0,00"
          aria-invalid={
            state.status === "error" && state.field === "amount"
              ? "true"
              : undefined
          }
          className={inputClass}
        />
        {state.status === "error" && state.field === "amount" && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {state.message}
          </p>
        )}
      </div>

      {/* Errore generico Server Action */}
      {state.status === "error" && !state.field && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.message}
        </p>
      )}

      <SubmitButton />
    </form>
  );
}
