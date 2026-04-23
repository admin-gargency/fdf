import { WaitlistForm } from "@/components/waitlist-form";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center gap-10 px-6 py-24 sm:py-32">
      <header className="flex flex-col gap-3">
        <p className="text-sm font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Pre-lancio beta privata
        </p>
        <h1 className="text-4xl font-semibold leading-tight tracking-tight text-zinc-900 sm:text-5xl dark:text-zinc-50">
          FdF — Finanza di Famiglia
        </h1>
      </header>

      <section className="flex flex-col gap-5 text-lg leading-relaxed text-zinc-700 dark:text-zinc-300">
        <p>
          PFM italiano per famiglie tech-savvy: multi-conto bancario, carta Amex Personal,
          budget condiviso e <em>sinking funds</em> nativi (Fondo → Categoria → Classe).
        </p>
        <p>
          Il modello che funziona sul foglio di casa — Appartamento, Viaggi, Nido, Amex
          Italia, contributi tra coniugi — in un prodotto che scala oltre l&apos;Excel.
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Waitlist beta
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          10-20 famiglie italiane, prima coorte €10-15/mese. Ti scriviamo solo per
          l&apos;invito.
        </p>
        <WaitlistForm />
      </section>

      <footer className="mt-auto flex flex-col gap-1 pt-8 text-xs text-zinc-500 dark:text-zinc-500">
        <p>FdF è una company di Gargency LLC · 2026</p>
        <p>
          Domande:{" "}
          <a
            className="underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100"
            href="mailto:fdf@gargency.com"
          >
            fdf@gargency.com
          </a>
        </p>
      </footer>
    </main>
  );
}
