export const dynamic = "force-static";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col justify-center gap-3 px-6 py-24 text-center">
      <p className="text-sm font-medium uppercase tracking-wider text-zinc-500">
        404
      </p>
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        Pagina non trovata
      </h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        La risorsa che cercavi non esiste o è stata spostata.
      </p>
    </main>
  );
}
