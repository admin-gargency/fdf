# Amex fixtures

Fixture dataset per validazione empirica parser Amex Personal Italia
(FDFA-9 / ADR-0005).

**Tutti i dati qui sono anonimizzati.** Raw data resta off-repo in
`~/Documents/fdf-seed-raw/` sul Mac Mini CEO (cifrato at rest). Vedi
`scripts/anonymize-amex-fixture.ts` per il pipeline idempotente.

## Layout

- `pdf/` — PDF statement mensile Amex (≥6 mesi customer zero per M3).
- `email/` — email alert esportate EML/MBOX (≥3 mesi customer zero per M4).
- `csv/` — export CSV dal portale Amex IT (≥1 fascia mensile per M5).
- `ground-truth/` — CSV di riferimento (estratto portale stessa fascia di `pdf/`)
  usato come ground truth per calcolare accuracy parser PDF.

## Convenzioni naming

- `pdf/amex-YYYY-MM.pdf` — statement Amex del mese YYYY-MM.
- `ground-truth/amex-YYYY-MM.csv` — ground truth della stessa fascia.
- `email/amex-alerts-YYYY-MM.eml` — MBOX con tutte le email del mese.
- `csv/amex-portal-YYYY-MM.csv` — export portale della stessa fascia.

## Aggiunta nuovi fixture

1. Scarica PDF / CSV / EML raw in `~/Documents/fdf-seed-raw/amex/<data>/`.
2. Esegui `pnpm tsx scripts/anonymize-amex-fixture.ts <raw-path>` (da scrivere).
3. Verifica output anonimizzato: nome cardholder, indirizzo, last4 diverso da reale,
   numeri carta mascherati, importi lasciati veri (dato di business, non PII).
4. Commit `tests/amex/fixtures/<kind>/*` — mai committare raw.

## Fixture sintetici (pre-customer-zero)

- `csv/statement-sample.csv` — fixture sintetica aligned al formato
  documentato del portale Amex IT (`Data`, `Data di registrazione`,
  `Descrizione`, `Importo`, `Categoria Amex`, separator `;`, BOM-free).
  Usata dai test unit del parser CSV (FDFA-31). **Va sostituita da un
  export reale CEO anonimizzato entro M2 (2026-04-30)** per abilitare il
  round-trip test vs PDF della stessa fascia mensile.
