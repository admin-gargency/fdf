# Feature 5: Sinking-Fund-Tree Read View — Technical Brief

**Branch**: `feature/5-sinking-funds-tree-view`
**Scope**: read-only aggregator. **No** schema changes, **no** ADR, **no**
RLS changes.
**Owners**: backend-dev, domain-dev, frontend-dev, test-engineer.
Mandatory pre-merge gate: security-reviewer (per AGENTS.md
§"Matrice di Autonomia" — read endpoint touches monetary data).

---

## Goal

Espone un'unica pagina `/sinking-funds-tree` che mostra la gerarchia
**Fondo → Categoria → Classe** con saldi `current_amount_cents` vs
`target_amount_cents` a livello Fondo e Categoria, e — per le Classi
con `tipologia` ∈ `{fondo_breve, fondo_lungo}` — la riga
`sinking_funds` associata (target, contributo mensile, target date).

La pagina è di sola lettura. Nessun pulsante "edit", "create",
"archive". Lo scopo è dare al CEO una vista a colpo d'occhio dello
stato del piano di accantonamento.

---

## Non-goals (espliciti)

- Nessuna mutazione (POST/PUT/DELETE) su nessuna tabella.
- Nessuna modifica a `funds`, `categories`, `classes`, `sinking_funds`,
  `transactions`, `budgets` (schema o RLS).
- Nessun calcolo da `transactions` — il `current_amount_cents` arriva
  dallo snapshot già committato in F3/F4
  (`20260504120000_funds_categories_amounts.sql`).
- Nessun progress visualization avanzato (chart). Solo testo + barra
  semplice CSS.
- Nessuna decisione su PUT-reparent / `archived_at: null` un-archive
  (post-mortem F3/F4 §"For Feature 5+" — fuori scope).
- **`buildBaseUrl()` lift**: post-mortem flagga n=4 duplicazione, ma
  per Option C l'API è singola e la page è server component che può
  chiamare la route via percorso relativo se in same-origin. Decisione:
  **non lift in F5** — defer a F6 quando si tocca un secondo route
  client-side.

---

## Data model — riuso schema esistente

Tabelle coinvolte (tutte già RLS-policied via
`current_household_ids()`, GRANTs colonna-livello già in
`20260424000004_grants.sql` + `…_funds_categories_amounts.sql`):

| Tabella | Colonne lette | Note |
|---|---|---|
| `funds` | `id, name, default_account_id, sort_order, archived_at, target_amount_cents, current_amount_cents` | Snapshot a livello Fondo |
| `categories` | `id, household_id, fund_id, name, sort_order, archived_at, target_amount_cents, current_amount_cents` | Snapshot a livello Categoria |
| `classes` | `id, household_id, category_id, name, tipologia, sort_order, archived_at` | Foglia; nessun amount column (ADR-0006 Decision 1) |
| `sinking_funds` | `id, household_id, class_id, target_cents, target_date, monthly_contribution_cents` | 1:1 con `classes` (UNIQUE su `class_id`); presente solo per fondo_breve/fondo_lungo. `notes` **non leggere**: deliberatamente ungranted (PII, vedi grants L160). |

**Filtri sempre attivi:** `archived_at IS NULL` su funds, categories,
classes. La query lato server filtra esplicitamente — non si fa
affidamento solo su RLS.

---

## API contract

### `GET /api/sinking-funds-tree`

**File:** `src/app/api/sinking-funds-tree/route.ts` (backend-dev).

**Auth + RLS:** identico a `src/app/api/funds/route.ts` — pattern
5-step skeleton del post-mortem (init SSR client → getUser →
no query params → DB ops → Zod validate → 200). Nessun service-role.
Nessun query param (no `include_archived`).

**Response shape (200):**

```ts
type SinkingFundTreeResponse = {
  tree: SinkingFundTreeNode[];
};

type SinkingFundTreeNode = FundTreeNode & {
  categories: (CategoryTreeNode & {
    classes: SinkingClassNode[];
  })[];
};

type SinkingClassNode = ClassNode & {
  sinking_fund: {
    target_cents: number;
    target_date: string | null;       // ISO date or null
    monthly_contribution_cents: number;
  } | null;  // null = nessuna riga sinking_funds (es. addebito_immediato)
};
```

`FundTreeNode`, `CategoryTreeNode`, `ClassNode` sono **già esportati**
da `src/lib/domain/funds.ts`. NON ridefinire — estendi.

**Errors:**

| HTTP | code              | Quando |
|---|---|---|
| 401  | `UNAUTHENTICATED` | `getUser` fallisce |
| 500  | `INIT_ERROR`      | `getServerSupabaseClient()` ritorna null |
| 500  | `QUERY_ERROR`    | qualunque error.code da Supabase non legato a auth |

Codici allineati a `src/app/api/{categories,classes}/route.ts` (post-mortem
§"Standardized error-code taxonomy").

---

## Domain layer

**File:** `src/lib/domain/sinking-funds-tree.ts` (domain-dev).

Pure function, no I/O:

```ts
export function buildSinkingFundTree(
  funds: FundRow[],
  categories: CategoryRow[],
  classes: ClassRow[],
  sinkingFunds: SinkingFundRow[],   // nuovo schema Zod
): SinkingFundTreeNode[];
```

**Implementation guidance:** delegare la parte Fondo→Categoria→Classe
a `buildFundTree(funds, categories, classes)` di `funds.ts`, poi
mappare le classi attaccando il payload `sinking_fund` via lookup
`Map<class_id, SinkingFundRow>`. **Non duplicare** la logica di
`buildFundTree`.

**Aggiungere a `src/lib/domain/funds.ts`** (no nuovo file):
- `SinkingFundRowSchema` (Zod, allineato a `GRANT SELECT` columns).
- `SinkingFundRow` type alias.

**Test colocated:** `src/lib/domain/sinking-funds-tree.test.ts`.
Casi minimi:
- albero vuoto (no funds) → `[]`
- fund senza categories → categorie `[]`
- category senza classes → classes `[]`
- class fondo_breve con `sinking_funds` row → `sinking_fund` popolato
- class addebito_immediato senza row → `sinking_fund: null`
- ordering: rispetta l'ordine in input (no re-sort)

---

## Frontend

**File:** `src/app/sinking-funds-tree/page.tsx` (frontend-dev).

**Pattern:** Server Component. Non usare il client React, niente
useEffect. Fetch via `fetch(internal API)` o direttamente via
`getServerSupabaseClient()` — preferire la **chiamata diretta a
Supabase + buildSinkingFundTree** se il route handler diventa solo
trasporto identico, in modo da evitare il round-trip HTTP. Se si fa
fetch all'API: usare path relativo `/api/sinking-funds-tree` (server
component, same-origin). NON introdurre `buildBaseUrl()` qui.

Decisione finale tra "fetch API" vs "Supabase diretto" lasciata al
frontend-dev in coordinazione con backend-dev — entrambe accettabili,
ma una sola via per F5.

**Auth gate:** la pagina è già coperta da `src/proxy.ts` se aggiunta
al matcher `/funds/*` style. **ASK al lead** prima di estendere il
matcher di `src/proxy.ts` — è file condiviso (vedi AGENTS.md
§"Edge middleware"). Alternativa: gate manuale nella page (server
component verifica `getUser` e fa `redirect('/login')` come fa già
`src/app/funds/page.tsx`).

**Componenti:**
- `src/components/sinking-funds-tree/SinkingFundTreeView.tsx` —
  contenitore, riceve `tree: SinkingFundTreeNode[]`.
- `src/components/sinking-funds-tree/FundCard.tsx` — card per Fondo
  con header (name + current/target + barra) e categorie nested.
- `src/components/sinking-funds-tree/CategoryRow.tsx` — riga categoria
  con name + current/target + barra + classi nested.
- `src/components/sinking-funds-tree/ClassRow.tsx` — riga classe con
  tipologia badge + (se presente) sinking_fund target/contribution.

Tailwind only, niente nuove dipendenze. Stile coerente con
`/funds`. Formattazione importi: helper esistente o nuovo helper puro
in `src/lib/format/currency.ts` (se non esiste) per `cents → "€ X.XXX,XX"`.
Italiano locale `it-IT`.

**Stati UI:**
- Albero vuoto (utente nuovo, nessun fondo) → empty state con CTA
  testuale verso `/funds`.
- Fondo con `target_amount_cents = null` → mostra solo `current`,
  niente barra.

---

## Test

**Unit (domain-dev → test-engineer):**
- `src/lib/domain/sinking-funds-tree.test.ts` — vedi casi sopra.

**Integration (test-engineer):**
- `src/app/api/sinking-funds-tree/route.test.ts`:
  - 401 senza auth.
  - 200 utente autenticato, household vuoto → `{ tree: [] }`.
  - 200 con fixture multi-fund/multi-category/multi-class +
    sinking_funds → struttura e amounts corretti.
  - RLS isolation: utente di household A non vede fondi di B.
- Componenti React: snapshot/RTL test minimo per `SinkingFundTreeView`
  con tree fixture.

Pattern integration test allineato a
`src/app/api/funds/route.test.ts`.

---

## Quality gates

Pre-merge tutti devono passare (task-completed.sh hook):
- `pnpm lint`
- `pnpm test`
- `pnpm build`

**Inoltre** (gate manuale):
- `security-reviewer` audit pre-merge: confermare che **nessuna**
  colonna PII ungranted (in particolare `sinking_funds.notes`,
  `transactions.raw_description`, `transactions.external_id`,
  `transactions.created_by`, `accounts.account_last4`) sia raggiunta
  dal payload di `/api/sinking-funds-tree`. Il route NON deve usare
  `getAdminClient()`. Conferma esplicita richiesta nel report di review.

---

## File ownership map

Strict — due teammate non scrivono mai sullo stesso file.

| File | Owner |
|---|---|
| `src/app/api/sinking-funds-tree/route.ts` (+ `.test.ts`) | backend-dev (route), test-engineer (.test.ts) |
| `src/lib/domain/sinking-funds-tree.ts` | domain-dev |
| `src/lib/domain/sinking-funds-tree.test.ts` | test-engineer |
| `src/lib/domain/funds.ts` (additive: `SinkingFundRowSchema`, type) | domain-dev |
| `src/app/sinking-funds-tree/page.tsx` | frontend-dev |
| `src/components/sinking-funds-tree/**` | frontend-dev |
| `src/lib/format/currency.ts` (se nuovo) | domain-dev |

**File condivisi — NON toccare senza ASK al lead:**
`src/proxy.ts`, `package.json`, `tsconfig.json`, `next.config.ts`,
`vercel.json`, `vitest.config.ts`, `eslint.config.mjs`, `AGENTS.md`,
`CLAUDE.md`, `README.md`, `.github/workflows/**`,
`supabase/migrations/**` (out of scope: nessun nuovo SQL).

---

## ASK list (cose da decidere prima del merge, non ora)

1. **Auth gate**: extending `src/proxy.ts` matcher vs. inline
   `getUser` redirect nella page. Default: inline redirect (no proxy
   change).
2. **API vs direct Supabase nella page**: backend-dev + frontend-dev
   convergono su una sola via prima del merge.
3. **Empty state copy**: testo italiano, brand-neutral (CONSTITUTION
   §"Brand-neutral nei copy pubblici").

---

## Sequencing

```
domain-dev          ─▶ buildSinkingFundTree + Zod schema (no deps)
backend-dev         ─▶ route.ts (depends: domain-dev)
frontend-dev        ─▶ page + components (depends: backend contract)
test-engineer       ─▶ unit + integration (depends: tutti)
security-reviewer   ─▶ pre-merge audit (depends: tutti i merge candidate)
```

domain-dev e backend-dev possono iniziare in parallelo (backend-dev
usa solo i tipi che domain-dev ha appena dichiarato; sincronizzare la
firma all'inizio).

---

## Riferimenti

- `docs/POST-MORTEM-FEATURES-3-4.md` — pattern da riusare (5-step
  skeleton, error codes).
- `src/lib/domain/funds.ts` — `buildFundTree`, branded types, schemi.
- `src/app/api/funds/route.ts` — implementazione canonica del 5-step
  skeleton da copiare.
- `supabase/migrations/20260424000001_core_schema.sql` L229-247 —
  definizione `sinking_funds`.
- `supabase/migrations/20260424000004_grants.sql` L159-174 —
  GRANT esplicite su `sinking_funds` (notes escluso).
- AGENTS.md §"File ownership convention", §"Communication protocol".
