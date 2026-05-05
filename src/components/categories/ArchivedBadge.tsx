/**
 * ArchivedBadge — Badge "Archiviata" per le categorie archiviate.
 *
 * Server Component puro (nessuna interattività).
 *
 * Ownership: frontend-dev (AGENTS.md §File ownership convention).
 */

export function ArchivedBadge() {
  return (
    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
      Archiviata
    </span>
  );
}
