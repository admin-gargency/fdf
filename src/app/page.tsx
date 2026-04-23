import { WaitlistForm } from "@/components/waitlist-form";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-14 px-6 py-20 sm:py-28">
      <header className="flex flex-col gap-3">
        <p className="text-sm font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Pre-lancio beta privata · Famiglie italiane
        </p>
        <h1 className="text-4xl font-semibold leading-tight tracking-tight text-zinc-900 sm:text-5xl dark:text-zinc-50">
          Il budget di famiglia, come già lo fate — ma senza fogli Excel.
        </h1>
        <p className="text-lg leading-relaxed text-zinc-700 dark:text-zinc-300">
          FdF riflette la tassonomia <em>Fondo → Categoria → Classe</em> che ogni famiglia
          tiene a mente: conti multipli, carta Amex personale, versamenti tra partner,
          sinking fund per la vacanza o il nido. Niente da adattare.
        </p>
      </header>

      <section
        aria-label="Tre pilastri"
        className="grid gap-6 sm:grid-cols-3"
      >
        <article className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            Ingestion universale
          </h2>
          <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            Fineco, Intesa, Unicredit e <strong>Amex Personal Italia</strong> —
            aggregator PSD2 dove funziona, parser PDF/email dove la copertura manca.
            Nessun conto escluso.
          </p>
        </article>
        <article className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            Modello flessibile
          </h2>
          <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            Fondo → Categoria → Classe, tre livelli che mappano 1:1 il foglio di
            casa. Classi come <em>addebito immediato</em>, <em>fondo breve</em>,
            <em> fondo lungo</em> per separare spese correnti da accantonamenti.
          </p>
        </article>
        <article className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            Previsione onesta
          </h2>
          <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            Sinking fund con target e contribuzione mensile, proiezione a 12 mesi
            sulle tendenze reali di famiglia — non su medie generiche. Sai prima
            quando il fondo vacanze è in difficoltà.
          </p>
        </article>
      </section>

      <section
        aria-label="Waitlist beta"
        className="flex flex-col gap-4 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950"
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
            Waitlist beta privata
          </h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            10-20 famiglie, prima coorte €10-15/mese. Ti scriviamo solo per
            l&apos;invito — niente newsletter, niente spam.
          </p>
        </div>
        <WaitlistForm />
      </section>

      <footer className="flex flex-col gap-1 pt-4 text-xs text-zinc-500 dark:text-zinc-500">
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
