/**
 * Unit tests per src/lib/domain/funds.ts
 * Vitest — no I/O, funzioni pure.
 *
 * NOTA: Usa UUID v4 validi (RFC 4122) perché Zod v4 applica la regex
 * restrittiva [1-8] sul terzo gruppo — gli UUID fake con zeri non passano.
 */

import { describe, it, expect } from "vitest";
import {
  buildFundTree,
  FundRowSchema,
  CategoryRowSchema,
  ClassRowSchema,
  type FundRow,
  type CategoryRow,
  type ClassRow,
} from "./funds";

// ---------------------------------------------------------------------------
// UUID v4 validi per fixtures (generati con crypto.randomUUID())
// ---------------------------------------------------------------------------

const UUID_FUND_1  = "a7142d9c-7441-4558-b523-280957ef575b";
const UUID_FUND_2  = "538fc4df-85df-423e-88fc-fc1ead3bb61a";
const UUID_CAT_1   = "fde3d018-7a67-4ed7-957b-b4d058b5fcda";
const UUID_CAT_2   = "97f8bfe1-96f5-4a74-b7cc-0b53f7af065e";
const UUID_CLASS_1 = "467a8ed1-af08-4668-8e20-0940400b5712";
const UUID_CLASS_2 = "16f084b9-213b-4105-bfba-329b2547955b";
const UUID_HH      = "74dd2f8e-ba26-49b2-a986-dbabd93d39ca";
const UUID_ACCOUNT = "0efb96b3-ce86-432b-b0d9-fbe68dea7a46";

const NOW = "2026-05-04T12:00:00.000Z";

function makeFund(overrides: Partial<FundRow> = {}): FundRow {
  return {
    id: UUID_FUND_1,
    household_id: UUID_HH,
    default_account_id: null,
    name: "Test Fund",
    sort_order: 0,
    archived_at: null,
    target_amount_cents: null,
    current_amount_cents: 0,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function makeCategory(overrides: Partial<CategoryRow> = {}): CategoryRow {
  return {
    id: UUID_CAT_1,
    household_id: UUID_HH,
    fund_id: UUID_FUND_1,
    name: "Test Category",
    sort_order: 0,
    archived_at: null,
    target_amount_cents: null,
    current_amount_cents: 0,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function makeClass(overrides: Partial<ClassRow> = {}): ClassRow {
  return {
    id: UUID_CLASS_1,
    household_id: UUID_HH,
    category_id: UUID_CAT_1,
    name: "Test Class",
    tipologia: "addebito_immediato",
    sort_order: 0,
    archived_at: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildFundTree
// ---------------------------------------------------------------------------

describe("buildFundTree", () => {
  it("ritorna array vuoto con input vuoti", () => {
    const result = buildFundTree([], [], []);
    expect(result).toEqual([]);
  });

  it("ritorna fondo senza categorie se categories è vuoto", () => {
    const fund = makeFund({ name: "Casa", target_amount_cents: 500_00 });
    const result = buildFundTree([fund], [], []);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(UUID_FUND_1);
    expect(result[0].name).toBe("Casa");
    expect(result[0].target_amount_cents).toBe(500_00);
    expect(result[0].categories).toEqual([]);
  });

  it("compone correttamente la gerarchia Fondo → Categoria → Classe", () => {
    const fund = makeFund({
      id: UUID_FUND_1,
      name: "Fondo Vacanze",
      default_account_id: UUID_ACCOUNT,
      target_amount_cents: 200_000,
      current_amount_cents: 50_000,
    });
    const category = makeCategory({
      id: UUID_CAT_1,
      fund_id: UUID_FUND_1,
      name: "Estate 2026",
      target_amount_cents: 120_000,
      current_amount_cents: 30_000,
    });
    const cls = makeClass({
      id: UUID_CLASS_1,
      category_id: UUID_CAT_1,
      name: "Voli",
      tipologia: "fondo_breve",
    });

    const result = buildFundTree([fund], [category], [cls]);

    expect(result).toHaveLength(1);
    const fundNode = result[0];
    expect(fundNode.default_account_id).toBe(UUID_ACCOUNT);
    expect(fundNode.target_amount_cents).toBe(200_000);
    expect(fundNode.current_amount_cents).toBe(50_000);
    expect(fundNode.categories).toHaveLength(1);

    const catNode = fundNode.categories[0];
    expect(catNode.name).toBe("Estate 2026");
    expect(catNode.target_amount_cents).toBe(120_000);
    expect(catNode.current_amount_cents).toBe(30_000);
    // default_account_id NON deve essere presente sul nodo categoria
    expect(catNode).not.toHaveProperty("default_account_id");
    expect(catNode.classes).toHaveLength(1);

    const classNode = catNode.classes[0];
    expect(classNode.tipologia).toBe("fondo_breve");
    // ClassNode non ha campi importo
    expect(classNode).not.toHaveProperty("target_amount_cents");
    expect(classNode).not.toHaveProperty("current_amount_cents");
  });

  it("gestisce più fondi, categorie e classi senza cross-contamination", () => {
    const fund1 = makeFund({ id: UUID_FUND_1, name: "Fondo 1" });
    const fund2 = makeFund({ id: UUID_FUND_2, name: "Fondo 2" });
    const cat1 = makeCategory({ id: UUID_CAT_1, fund_id: UUID_FUND_1, name: "Cat 1" });
    const cat2 = makeCategory({ id: UUID_CAT_2, fund_id: UUID_FUND_2, name: "Cat 2" });
    const cls1 = makeClass({ id: UUID_CLASS_1, category_id: UUID_CAT_1, name: "Classe 1" });
    const cls2 = makeClass({ id: UUID_CLASS_2, category_id: UUID_CAT_2, name: "Classe 2" });

    const result = buildFundTree([fund1, fund2], [cat1, cat2], [cls1, cls2]);

    expect(result).toHaveLength(2);
    const r1 = result.find((f) => f.id === UUID_FUND_1)!;
    const r2 = result.find((f) => f.id === UUID_FUND_2)!;

    expect(r1.categories).toHaveLength(1);
    expect(r1.categories[0].classes[0].name).toBe("Classe 1");
    expect(r2.categories).toHaveLength(1);
    expect(r2.categories[0].classes[0].name).toBe("Classe 2");
  });
});

// ---------------------------------------------------------------------------
// ClassRowSchema — validazione tipologia, assenza campi importo
// ---------------------------------------------------------------------------

describe("ClassRowSchema", () => {
  it("accetta tipologie valide", () => {
    const tipologie = ["addebito_immediato", "fondo_breve", "fondo_lungo"] as const;
    for (const t of tipologie) {
      const result = ClassRowSchema.safeParse(makeClass({ tipologia: t }));
      expect(result.success).toBe(true);
    }
  });

  it("rifiuta tipologia invalida", () => {
    const result = ClassRowSchema.safeParse(
      makeClass({ tipologia: "tipo_inesistente" as never }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("tipologia");
    }
  });

  it("non include campi importo (ADR-0006 Decision 1 — solo funds e categories)", () => {
    // ClassRow non ha target_amount_cents né current_amount_cents
    const cls = makeClass();
    const result = ClassRowSchema.safeParse(cls);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("target_amount_cents");
      expect(result.data).not.toHaveProperty("current_amount_cents");
    }
  });
});

// ---------------------------------------------------------------------------
// CategoryRowSchema — assenza di default_account_id, presenza campi importo
// ---------------------------------------------------------------------------

describe("CategoryRowSchema", () => {
  it("non include default_account_id (deviazione ADR-0006 Decision 1)", () => {
    const validCat = makeCategory();
    const result = CategoryRowSchema.safeParse(validCat);
    expect(result.success).toBe(true);

    // Zod ignora silenziosamente campi extra (strip) — non causa errore
    const resultWithExtra = CategoryRowSchema.safeParse({
      ...validCat,
      default_account_id: UUID_ACCOUNT,
    });
    expect(resultWithExtra.success).toBe(true);
  });

  it("accetta target_amount_cents null (campo opzionale)", () => {
    const result = CategoryRowSchema.safeParse(
      makeCategory({ target_amount_cents: null }),
    );
    expect(result.success).toBe(true);
  });

  it("accetta target_amount_cents con valore intero", () => {
    const result = CategoryRowSchema.safeParse(
      makeCategory({ target_amount_cents: 100_000 }),
    );
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// FundRowSchema
// ---------------------------------------------------------------------------

describe("FundRowSchema", () => {
  it("accetta riga fund valida", () => {
    const result = FundRowSchema.safeParse(makeFund());
    expect(result.success).toBe(true);
  });

  it("accetta default_account_id null", () => {
    const result = FundRowSchema.safeParse(makeFund({ default_account_id: null }));
    expect(result.success).toBe(true);
  });

  it("accetta target_amount_cents null (campo opzionale)", () => {
    const result = FundRowSchema.safeParse(makeFund({ target_amount_cents: null }));
    expect(result.success).toBe(true);
  });

  it("rifiuta name vuoto", () => {
    const result = FundRowSchema.safeParse(makeFund({ name: "" }));
    expect(result.success).toBe(false);
  });
});
