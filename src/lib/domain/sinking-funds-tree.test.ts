/**
 * Unit tests per src/lib/domain/sinking-funds-tree.ts
 * Vitest — no I/O, funzione pura buildSinkingFundTree.
 *
 * NOTA: Usa UUID v4 validi (RFC 4122) — Zod v4 applica la regex
 * restrittiva [1-8] sul terzo gruppo; UUID con zeri non passano.
 *
 * NOTE(rls-isolation-test): I test di isolamento RLS (utente A non vede
 * dati utente B) non sono inclusi qui — richiedono un DB reale e sono
 * coperti dall'audit del security-reviewer (AGENTS.md §Coverage strategy).
 *
 * NOTE(component-tests): I test RTL per i componenti React
 * (SinkingFundTreeView, FundCard, ecc.) sono saltati — @testing-library/react
 * non è una dipendenza del progetto (package.json). Vedi COMPLETION.
 */

import { describe, it, expect } from "vitest";
import { buildSinkingFundTree } from "./sinking-funds-tree";
import {
  type FundRow,
  type CategoryRow,
  type ClassRow,
  type SinkingFundRow,
} from "./funds";

// ---------------------------------------------------------------------------
// UUID v4 validi per fixtures
// ---------------------------------------------------------------------------

const UUID_HH        = "74dd2f8e-ba26-49b2-a986-dbabd93d39ca";
const UUID_ACCOUNT   = "0efb96b3-ce86-432b-b0d9-fbe68dea7a46";
const UUID_FUND_1    = "a7142d9c-7441-4558-b523-280957ef575b";
const UUID_FUND_2    = "538fc4df-85df-423e-88fc-fc1ead3bb61a";
const UUID_CAT_1     = "fde3d018-7a67-4ed7-957b-b4d058b5fcda";
const UUID_CAT_2     = "97f8bfe1-96f5-4a74-b7cc-0b53f7af065e";
const UUID_CLASS_1   = "467a8ed1-af08-4668-8e20-0940400b5712";
const UUID_CLASS_2   = "16f084b9-213b-4105-bfba-329b2547955b";
const UUID_CLASS_3   = "c8d3e2a1-5f6b-4c7d-9e8f-1a2b3c4d5e6f";
const UUID_SF_1      = "b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e";
const UUID_SF_ORPHAN = "e9f8a7b6-c5d4-4e3f-2a1b-0c9d8e7f6a5b";

const NOW = "2026-05-04T12:00:00.000Z";

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeFund(overrides: Partial<FundRow> = {}): FundRow {
  return {
    id: UUID_FUND_1,
    household_id: UUID_HH,
    default_account_id: null,
    name: "Fondo Test",
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
    name: "Categoria Test",
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
    name: "Classe Test",
    tipologia: "addebito_immediato",
    sort_order: 0,
    archived_at: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function makeSinkingFund(overrides: Partial<SinkingFundRow> = {}): SinkingFundRow {
  return {
    id: UUID_SF_1,
    household_id: UUID_HH,
    class_id: UUID_CLASS_1,
    target_cents: 100_000,
    target_date: "2027-12-31",
    monthly_contribution_cents: 5_000,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildSinkingFundTree
// ---------------------------------------------------------------------------

describe("buildSinkingFundTree", () => {
  describe("empty input", () => {
    it("should return [] when funds array is empty", () => {
      const result = buildSinkingFundTree([], [], [], []);
      expect(result).toEqual([]);
    });
  });

  describe("fund with no categories", () => {
    it("should return fund node with categories: [] when no categories exist", () => {
      const fund = makeFund({ name: "Fondo Vuoto" });
      const result = buildSinkingFundTree([fund], [], [], []);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(UUID_FUND_1);
      expect(result[0].name).toBe("Fondo Vuoto");
      expect(result[0].categories).toEqual([]);
    });
  });

  describe("category with no classes", () => {
    it("should return category node with classes: [] when no classes exist", () => {
      const fund = makeFund();
      const category = makeCategory({ name: "Categoria Vuota" });
      const result = buildSinkingFundTree([fund], [category], [], []);

      expect(result).toHaveLength(1);
      expect(result[0].categories).toHaveLength(1);
      expect(result[0].categories[0].name).toBe("Categoria Vuota");
      expect(result[0].categories[0].classes).toEqual([]);
    });
  });

  describe("class with tipologia fondo_breve and matching sinking_funds row", () => {
    it("should attach sinking_fund payload to the class node", () => {
      const fund = makeFund({ default_account_id: UUID_ACCOUNT, target_amount_cents: 200_000, current_amount_cents: 50_000 });
      const category = makeCategory({ target_amount_cents: 150_000, current_amount_cents: 40_000 });
      const cls = makeClass({ tipologia: "fondo_breve", name: "Fondo Breve Test" });
      const sf = makeSinkingFund({
        class_id: UUID_CLASS_1,
        target_cents: 120_000,
        target_date: "2027-06-30",
        monthly_contribution_cents: 8_000,
      });

      const result = buildSinkingFundTree([fund], [category], [cls], [sf]);

      expect(result).toHaveLength(1);
      const classNode = result[0].categories[0].classes[0];
      expect(classNode.tipologia).toBe("fondo_breve");
      expect(classNode.sinking_fund).not.toBeNull();
      expect(classNode.sinking_fund).toEqual({
        target_cents: 120_000,
        target_date: "2027-06-30",
        monthly_contribution_cents: 8_000,
      });
    });

    it("should handle target_date: null (open-ended sinking fund)", () => {
      const fund = makeFund();
      const category = makeCategory();
      const cls = makeClass({ tipologia: "fondo_breve" });
      const sf = makeSinkingFund({ target_date: null });

      const result = buildSinkingFundTree([fund], [category], [cls], [sf]);

      const classNode = result[0].categories[0].classes[0];
      expect(classNode.sinking_fund).not.toBeNull();
      expect(classNode.sinking_fund!.target_date).toBeNull();
    });
  });

  describe("class with tipologia fondo_breve but NO matching sinking_funds row", () => {
    it("should set sinking_fund: null when no sinking_funds row matches", () => {
      const fund = makeFund();
      const category = makeCategory();
      const cls = makeClass({ tipologia: "fondo_breve", id: UUID_CLASS_1 });
      // sinkingFunds array is empty — no matching row
      const result = buildSinkingFundTree([fund], [category], [cls], []);

      const classNode = result[0].categories[0].classes[0];
      expect(classNode.sinking_fund).toBeNull();
    });
  });

  describe("class with tipologia addebito_immediato", () => {
    it("should set sinking_fund: null (addebito_immediato has no sinking_funds row)", () => {
      const fund = makeFund();
      const category = makeCategory();
      const cls = makeClass({ tipologia: "addebito_immediato" });
      // Even if we pass an unrelated sinking_fund, class_id won't match
      const result = buildSinkingFundTree([fund], [category], [cls], []);

      const classNode = result[0].categories[0].classes[0];
      expect(classNode.tipologia).toBe("addebito_immediato");
      expect(classNode.sinking_fund).toBeNull();
    });
  });

  describe("ordering: input order preserved", () => {
    it("should preserve fund order from input (no re-sorting)", () => {
      // Funds are passed in sort_order=2 first, then sort_order=1 — function must NOT re-sort
      const fund1 = makeFund({ id: UUID_FUND_1, name: "Fondo B", sort_order: 2 });
      const fund2 = makeFund({ id: UUID_FUND_2, name: "Fondo A", sort_order: 1 });

      const result = buildSinkingFundTree([fund1, fund2], [], [], []);

      // Order must match input order, not sort_order
      expect(result[0].name).toBe("Fondo B");
      expect(result[1].name).toBe("Fondo A");
    });

    it("should preserve category order from input within a fund", () => {
      const fund = makeFund();
      const cat1 = makeCategory({ id: UUID_CAT_1, name: "Cat B", sort_order: 2 });
      const cat2 = makeCategory({ id: UUID_CAT_2, name: "Cat A", sort_order: 1 });

      const result = buildSinkingFundTree([fund], [cat1, cat2], [], []);

      expect(result[0].categories[0].name).toBe("Cat B");
      expect(result[0].categories[1].name).toBe("Cat A");
    });

    it("should preserve class order from input within a category", () => {
      const fund = makeFund();
      const category = makeCategory();
      const cls1 = makeClass({ id: UUID_CLASS_1, name: "Classe B", sort_order: 2 });
      const cls2 = makeClass({ id: UUID_CLASS_2, name: "Classe A", sort_order: 1, category_id: UUID_CAT_1 });

      const result = buildSinkingFundTree([fund], [category], [cls1, cls2], []);

      expect(result[0].categories[0].classes[0].name).toBe("Classe B");
      expect(result[0].categories[0].classes[1].name).toBe("Classe A");
    });
  });

  describe("sinking_funds row with unmatched class_id (orphan)", () => {
    it("should not crash when sinkingFunds contains a row with no matching class", () => {
      // UUID_CLASS_3 is not present in the classes array — orphan sinking_fund row
      const fund = makeFund();
      const category = makeCategory();
      const cls = makeClass({ id: UUID_CLASS_1, tipologia: "addebito_immediato" });
      const orphanSf = makeSinkingFund({
        id: UUID_SF_ORPHAN,
        class_id: UUID_CLASS_3, // no matching class in classes array
      });

      // Must not throw
      const result = buildSinkingFundTree([fund], [category], [cls], [orphanSf]);

      // The orphan row does not appear anywhere in the tree
      expect(result).toHaveLength(1);
      const classNode = result[0].categories[0].classes[0];
      // UUID_CLASS_1 had no matching sf (orphan was for UUID_CLASS_3)
      expect(classNode.sinking_fund).toBeNull();
    });
  });

  describe("full happy path: 1 fund, 1 category, 2 classes", () => {
    it("should correctly attach sinking_fund only to fondo_breve class, null for addebito_immediato", () => {
      const fund = makeFund({
        name: "Fondo Risparmio",
        default_account_id: UUID_ACCOUNT,
        target_amount_cents: 500_000,
        current_amount_cents: 120_000,
      });
      const category = makeCategory({
        name: "Accantonamento Casa",
        target_amount_cents: 400_000,
        current_amount_cents: 100_000,
      });
      const clsFondoBreve = makeClass({
        id: UUID_CLASS_1,
        name: "Caparra",
        tipologia: "fondo_breve",
        sort_order: 0,
      });
      const clsAddebitoImm = makeClass({
        id: UUID_CLASS_2,
        name: "Spese notaio",
        tipologia: "addebito_immediato",
        sort_order: 1,
        category_id: UUID_CAT_1,
      });
      const sf = makeSinkingFund({
        class_id: UUID_CLASS_1,
        target_cents: 300_000,
        target_date: "2028-03-01",
        monthly_contribution_cents: 10_000,
      });

      const result = buildSinkingFundTree(
        [fund],
        [category],
        [clsFondoBreve, clsAddebitoImm],
        [sf],
      );

      expect(result).toHaveLength(1);
      const fundNode = result[0];
      expect(fundNode.name).toBe("Fondo Risparmio");
      expect(fundNode.target_amount_cents).toBe(500_000);
      expect(fundNode.current_amount_cents).toBe(120_000);
      expect(fundNode.categories).toHaveLength(1);

      const catNode = fundNode.categories[0];
      expect(catNode.name).toBe("Accantonamento Casa");
      expect(catNode.target_amount_cents).toBe(400_000);
      expect(catNode.current_amount_cents).toBe(100_000);
      expect(catNode.classes).toHaveLength(2);

      const fondoBreveNode = catNode.classes[0];
      expect(fondoBreveNode.tipologia).toBe("fondo_breve");
      expect(fondoBreveNode.sinking_fund).toEqual({
        target_cents: 300_000,
        target_date: "2028-03-01",
        monthly_contribution_cents: 10_000,
      });

      const addebitoNode = catNode.classes[1];
      expect(addebitoNode.tipologia).toBe("addebito_immediato");
      expect(addebitoNode.sinking_fund).toBeNull();
    });
  });
});
