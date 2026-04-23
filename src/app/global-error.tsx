"use client";

export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="it">
      <body>
        <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
          <h1>Errore</h1>
          <p>Qualcosa è andato storto. Riprova tra poco.</p>
          <button type="button" onClick={() => reset()}>
            Ricarica
          </button>
        </main>
      </body>
    </html>
  );
}
