"use client";

/**
 * ClassRow — Riga singola classe con edit inline e archiviazione.
 *
 * "use client": gestisce useState (isEditing, errore, loading),
 * useRouter (refresh dopo mutazione), window.confirm (archive).
 *
 * Edit: client fetch PUT + router.refresh() — stesso pattern di CategoryRow.tsx.
 * Archive: window.confirm() + client fetch DELETE + router.refresh().
 *
 * Ownership: frontend-dev (AGENTS.md §File ownership convention).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArchivedBadge } from "@/components/categories/ArchivedBadge";
import type { CategoryOption } from "./CategorySelector";

// ---------------------------------------------------------------------------
// Tipo locale — allineato a ClassRowSchema in src/lib/domain/funds.ts
// ---------------------------------------------------------------------------

export interface ClassRow {
  id: string;
  category_id: string;
  name: string;
  tipologia: "addebito_immediato" | "fondo_breve" | "fondo_lungo";
  sort_order: number;
  archived_at: string | null;
}

// ---------------------------------------------------------------------------
// Tipologia labels italiani (brand-neutral)
// ---------------------------------------------------------------------------

const TIPOLOGIA_LABELS: Record<ClassRow["tipologia"], string> = {
  addebito_immediato: "Addebito immediato",
  fondo_breve: "Fondo breve termine",
  fondo_lungo: "Fondo lungo termine",
};

// ---------------------------------------------------------------------------
// Stili condivisi
// ---------------------------------------------------------------------------

const inputClass =
  "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-500/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder-zinc-500 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20";

const labelClass = "text-sm font-medium text-zinc-700 dark:text-zinc-300";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ClassRowProps {
  classItem: ClassRow;
  categories: CategoryOption[];
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function ClassRowItem({ classItem, categories }: ClassRowProps) {
  const router = useRouter();

  const [isEditing, setIsEditing] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isArchived = classItem.archived_at !== null;

  // ---------------------------------------------------------------------------
  // Edit submit
  // ---------------------------------------------------------------------------

  async function handleEditSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEditError(null);
    setSaving(true);

    const fd = new FormData(e.currentTarget);
    const name = (fd.get("name") as string).trim();
    const category_id = fd.get("category_id") as string;
    const tipologia = fd.get("tipologia") as string;
    const sort_order_raw = fd.get("sort_order") as string;

    if (!name) {
      setEditError("Il nome è obbligatorio.");
      setSaving(false);
      return;
    }

    const sort_order =
      sort_order_raw.trim() !== "" ? parseInt(sort_order_raw, 10) : 0;

    const updates: Record<string, unknown> = {
      name,
      category_id,
      tipologia,
      sort_order,
    };

    let res: Response;
    try {
      res = await fetch(`/api/classes/${classItem.id}`, {
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
        "Esiste già una classe con questo nome in questa categoria.",
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
      setEditError("Classe non trovata. Ricarica la pagina.");
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
  // Archive (DELETE)
  // ---------------------------------------------------------------------------

  async function handleArchive() {
    setDeleteError(null);

    const confirmed = window.confirm(
      "Archivia questa classe? Sarà nascosta ma le transazioni associate restano consultabili.",
    );
    if (!confirmed) return;

    setDeleting(true);

    let res: Response;
    try {
      res = await fetch(`/api/classes/${classItem.id}`, {
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
      setDeleteError("Classe non trovata. Ricarica la pagina.");
      setDeleting(false);
      return;
    }

    if (res.status === 401) {
      setDeleteError("Sessione scaduta. Accedi di nuovo per continuare.");
      setDeleting(false);
      return;
    }

    setDeleteError("Si è verificato un errore. Riprova più tardi.");
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
                {classItem.name}
              </h3>
              {isArchived && <ArchivedBadge />}
            </div>
            <dl className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-zinc-600 dark:text-zinc-400">
              <div className="flex gap-1">
                <dt>Tipologia</dt>
                <dd className="font-medium text-zinc-900 dark:text-zinc-50">
                  {TIPOLOGIA_LABELS[classItem.tipologia]}
                </dd>
              </div>
              <div className="flex gap-1">
                <dt>Ordine</dt>
                <dd className="font-medium text-zinc-900 dark:text-zinc-50">
                  {classItem.sort_order}
                </dd>
              </div>
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
                onClick={handleArchive}
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
          <label htmlFor={`name-${classItem.id}`} className={labelClass}>
            Nome <span aria-hidden="true">*</span>
          </label>
          <input
            id={`name-${classItem.id}`}
            name="name"
            type="text"
            required
            defaultValue={classItem.name}
            className={inputClass}
          />
          {editError && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {editError}
            </p>
          )}
        </div>

        {/* Categoria (reparenting) */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`category_id-${classItem.id}`} className={labelClass}>
            Categoria
          </label>
          <select
            id={`category_id-${classItem.id}`}
            name="category_id"
            defaultValue={classItem.category_id}
            className={inputClass}
          >
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
            La tipologia determina come questa classe gestisce i fondi nel
            tempo.
          </p>
          {(
            [
              "addebito_immediato",
              "fondo_breve",
              "fondo_lungo",
            ] as ClassRow["tipologia"][]
          ).map((value) => (
            <label
              key={value}
              className="flex cursor-pointer items-start gap-2.5 text-sm text-zinc-700 dark:text-zinc-300"
            >
              <input
                type="radio"
                name="tipologia"
                value={value}
                defaultChecked={classItem.tipologia === value}
                className="mt-0.5"
              />
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">{TIPOLOGIA_LABELS[value]}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {/* Ordine */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`sort_order-${classItem.id}`} className={labelClass}>
            Ordine{" "}
            <span className="font-normal text-zinc-400 dark:text-zinc-500">
              (opzionale)
            </span>
          </label>
          <input
            id={`sort_order-${classItem.id}`}
            name="sort_order"
            type="number"
            step="1"
            defaultValue={classItem.sort_order}
            placeholder="0"
            className={inputClass}
          />
        </div>

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
