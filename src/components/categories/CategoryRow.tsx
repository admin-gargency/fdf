"use client";

/**
 * CategoryRow — Riga singola categoria con edit inline e delete.
 *
 * "use client": gestisce useState (isEditing, errore, loading),
 * useRouter (refresh dopo mutazione), window.confirm (delete).
 *
 * Edit: client fetch PUT + router.refresh() — scelta documentata nel piano
 * approvato (il componente è già client per delete; client fetch + refresh
 * è più semplice di useActionState su un componente già interattivo).
 *
 * Delete: native window.confirm() + client fetch DELETE + router.refresh().
 *
 * Ownership: frontend-dev (AGENTS.md §File ownership convention).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArchivedBadge } from "./ArchivedBadge";
import type { FundOption } from "./FundSelector";

// ---------------------------------------------------------------------------
// Tipo locale — allineato a CategoryRowSchema in src/lib/domain/funds.ts
// ---------------------------------------------------------------------------

export interface CategoryRow {
  id: string;
  fund_id: string;
  name: string;
  sort_order: number;
  archived_at: string | null;
  target_amount_cents: number | null;
  current_amount_cents: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const eurFormatter = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
});

function formatEur(cents: number): string {
  return eurFormatter.format(cents / 100);
}

function centsToDisplay(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}

function parseCents(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(",", ".");
  const float = parseFloat(normalized);
  if (isNaN(float)) return null;
  return Math.round(float * 100);
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

interface CategoryRowProps {
  category: CategoryRow;
  funds: FundOption[];
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function CategoryRowItem({ category, funds }: CategoryRowProps) {
  const router = useRouter();

  const [isEditing, setIsEditing] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isArchived = category.archived_at !== null;

  // ---------------------------------------------------------------------------
  // Edit submit
  // ---------------------------------------------------------------------------

  async function handleEditSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEditError(null);
    setSaving(true);

    const fd = new FormData(e.currentTarget);
    const name = (fd.get("name") as string).trim();
    const fund_id = fd.get("fund_id") as string;
    const sort_order_raw = fd.get("sort_order") as string;
    const target_raw = fd.get("target_amount_cents") as string;
    const current_raw = fd.get("current_amount_cents") as string;

    if (!name) {
      setEditError("Il nome è obbligatorio.");
      setSaving(false);
      return;
    }

    const sort_order =
      sort_order_raw.trim() !== "" ? parseInt(sort_order_raw, 10) : 0;
    const target_amount_cents = parseCents(target_raw);
    const current_amount_cents_parsed = parseCents(current_raw);

    const updates: Record<string, unknown> = { name, fund_id, sort_order };
    // target può essere null (cancella obiettivo) o un numero
    updates.target_amount_cents = target_amount_cents;
    if (current_amount_cents_parsed !== null) {
      updates.current_amount_cents = current_amount_cents_parsed;
    }

    let res: Response;
    try {
      res = await fetch(`/api/categories/${category.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
    } catch {
      setEditError("Errore di rete. Riprova più tardi.");
      setSaving(false);
      return;
    }

    if (res.status === 409) {
      setEditError(
        "Esiste già una categoria con questo nome in questo fondo.",
      );
      setSaving(false);
      return;
    }

    if (res.status === 401) {
      setEditError("Sessione scaduta. Accedi di nuovo per continuare.");
      setSaving(false);
      return;
    }

    if (res.status === 404) {
      setEditError("Categoria non trovata. Ricarica la pagina.");
      setSaving(false);
      return;
    }

    if (!res.ok) {
      setEditError("Si è verificato un errore. Riprova più tardi.");
      setSaving(false);
      return;
    }

    setSaving(false);
    setIsEditing(false);
    router.refresh();
  }

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  async function handleDelete() {
    setDeleteError(null);

    const confirmed = window.confirm(
      `Sei sicuro di voler archiviare la categoria "${category.name}"?`,
    );
    if (!confirmed) return;

    setDeleting(true);

    let res: Response;
    try {
      res = await fetch(`/api/categories/${category.id}`, {
        method: "DELETE",
      });
    } catch {
      setDeleteError("Errore di rete. Riprova più tardi.");
      setDeleting(false);
      return;
    }

    if (res.status === 204) {
      router.refresh();
      return;
    }

    if (res.status === 404) {
      setDeleteError("Categoria non trovata. Ricarica la pagina.");
      setDeleting(false);
      return;
    }

    if (res.status === 401) {
      setDeleteError("Sessione scaduta. Accedi di nuovo per continuare.");
      setDeleting(false);
      return;
    }

    setDeleteError("Impossibile archiviare la categoria. Riprova.");
    setDeleting(false);
  }

  // ---------------------------------------------------------------------------
  // Render: modalità visualizzazione
  // ---------------------------------------------------------------------------

  if (!isEditing) {
    return (
      <li
        className={`rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950 ${
          isArchived ? "opacity-60" : ""
        }`}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-medium text-zinc-900 dark:text-zinc-50">
                {category.name}
              </h3>
              {isArchived && <ArchivedBadge />}
            </div>
            <dl className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-zinc-600 dark:text-zinc-400">
              <div className="flex gap-1">
                <dt>Saldo</dt>
                <dd className="font-medium text-zinc-900 dark:text-zinc-50">
                  {formatEur(category.current_amount_cents)}
                </dd>
              </div>
              {category.target_amount_cents !== null && (
                <div className="flex gap-1">
                  <dt>Obiettivo</dt>
                  <dd className="font-medium text-zinc-900 dark:text-zinc-50">
                    {formatEur(category.target_amount_cents)}
                  </dd>
                </div>
              )}
            </dl>
          </div>

          {/* Azioni — non mostrate per righe archiviate */}
          {!isArchived && (
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditError(null);
                  setIsEditing(true);
                }}
                className="text-sm font-medium text-zinc-500 underline-offset-4 hover:text-zinc-900 hover:underline focus:outline-none focus:ring-2 focus:ring-zinc-900/40 dark:text-zinc-400 dark:hover:text-zinc-50 dark:focus:ring-zinc-50/40"
              >
                Modifica
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="text-sm font-medium text-zinc-500 underline-offset-4 hover:text-zinc-900 hover:underline focus:outline-none focus:ring-2 focus:ring-zinc-900/40 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-400 dark:hover:text-zinc-50 dark:focus:ring-zinc-50/40"
              >
                {deleting ? "Archiviazione…" : "Archivia"}
              </button>
            </div>
          )}
        </div>

        {deleteError && (
          <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
            {deleteError}
          </p>
        )}
      </li>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: modalità modifica inline
  // ---------------------------------------------------------------------------

  return (
    <li className="rounded-lg border border-zinc-300 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-950">
      <form onSubmit={handleEditSubmit} className="flex flex-col gap-4">
        {/* Nome */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`name-${category.id}`} className={labelClass}>
            Nome <span aria-hidden="true">*</span>
          </label>
          <input
            id={`name-${category.id}`}
            name="name"
            type="text"
            required
            defaultValue={category.name}
            className={inputClass}
          />
        </div>

        {/* Fondo (reparenting) */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`fund_id-${category.id}`} className={labelClass}>
            Fondo
          </label>
          <select
            id={`fund_id-${category.id}`}
            name="fund_id"
            defaultValue={category.fund_id}
            className={inputClass}
          >
            {funds.map((fund) => (
              <option key={fund.id} value={fund.id}>
                {fund.name}
              </option>
            ))}
          </select>
        </div>

        {/* Ordine */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`sort_order-${category.id}`} className={labelClass}>
            Ordine
          </label>
          <input
            id={`sort_order-${category.id}`}
            name="sort_order"
            type="number"
            step="1"
            defaultValue={category.sort_order}
            className={inputClass}
          />
        </div>

        {/* Obiettivo */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={`target_amount_cents-${category.id}`}
            className={labelClass}
          >
            Obiettivo (€){" "}
            <span className="font-normal text-zinc-400 dark:text-zinc-500">
              (opzionale)
            </span>
          </label>
          <input
            id={`target_amount_cents-${category.id}`}
            name="target_amount_cents"
            type="text"
            inputMode="decimal"
            defaultValue={centsToDisplay(category.target_amount_cents)}
            placeholder="0,00"
            className={inputClass}
          />
        </div>

        {/* Saldo */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={`current_amount_cents-${category.id}`}
            className={labelClass}
          >
            Saldo attuale (€)
          </label>
          <input
            id={`current_amount_cents-${category.id}`}
            name="current_amount_cents"
            type="text"
            inputMode="decimal"
            defaultValue={centsToDisplay(category.current_amount_cents)}
            placeholder="0,00"
            className={inputClass}
          />
        </div>

        {editError && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {editError}
          </p>
        )}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-900/40 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200 dark:focus:ring-zinc-50/40"
          >
            {saving ? "Salvataggio…" : "Salva"}
          </button>
          <button
            type="button"
            onClick={() => {
              setIsEditing(false);
              setEditError(null);
            }}
            className="text-sm font-medium text-zinc-500 underline-offset-4 hover:text-zinc-900 hover:underline focus:outline-none focus:ring-2 focus:ring-zinc-900/40 dark:text-zinc-400 dark:hover:text-zinc-50 dark:focus:ring-zinc-50/40"
          >
            Annulla
          </button>
        </div>
      </form>
    </li>
  );
}
