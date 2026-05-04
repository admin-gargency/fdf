/**
 * FundTree.test.tsx — Test per il componente FundTree.
 *
 * Usa renderToString (react-dom/server) perché vitest.config.ts usa
 * environment "node" e @testing-library non è installato.
 *
 * Ownership: frontend-dev (AGENTS.md §File ownership convention).
 */

import { describe, it, expect } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { FundTree } from "./FundTree";
import type { FundTreeNode, CategoryTreeNode, ClassNode } from "@/lib/domain/funds";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeClass(overrides?: Partial<ClassNode>): ClassNode {
  return {
    id: "class-1" as ClassNode["id"],
    name: "Spesa corrente",
    tipologia: "addebito_immediato",
    sort_order: 1,
    archived_at: null,
    ...overrides,
  };
}

function makeCategory(overrides?: Partial<CategoryTreeNode>): CategoryTreeNode {
  return {
    id: "cat-1" as CategoryTreeNode["id"],
    fund_id: "fund-1" as FundTreeNode["id"],
    name: "Casa",
    sort_order: 1,
    archived_at: null,
    target_amount_cents: null,
    current_amount_cents: 50000 as CategoryTreeNode["current_amount_cents"],
    classes: [],
    ...overrides,
  };
}

function makeFund(overrides?: Partial<FundTreeNode>): FundTreeNode {
  return {
    id: "fund-1" as FundTreeNode["id"],
    name: "Fondo Operativo",
    default_account_id: null,
    sort_order: 1,
    archived_at: null,
    target_amount_cents: null,
    current_amount_cents: 100000 as FundTreeNode["current_amount_cents"],
    categories: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test: empty tree
// ---------------------------------------------------------------------------

describe("FundTree", () => {
  it("mostra lista vuota quando tree è vuoto", () => {
    const html = renderToString(React.createElement(FundTree, { tree: [] }));
    // La lista esiste ma non contiene fondi
    expect(html).toContain("aria-label=\"Lista fondi\"");
    expect(html).not.toContain("Fondo Operativo");
  });

  // ---------------------------------------------------------------------------
  // Test: un fondo + una categoria + una classe → label tipologia italiana
  // ---------------------------------------------------------------------------

  it("mostra fondo, categoria e label tipologia italiana", () => {
    const cls = makeClass({
      tipologia: "addebito_immediato",
      name: "Spesa corrente",
    });
    const cat = makeCategory({
      name: "Casa",
      classes: [cls],
    });
    const fund = makeFund({
      name: "Fondo Operativo",
      categories: [cat],
    });

    const html = renderToString(
      React.createElement(FundTree, { tree: [fund] }),
    );

    expect(html).toContain("Fondo Operativo");
    expect(html).toContain("Casa");
    expect(html).toContain("Spesa corrente");
    // Label italiana human-readable
    expect(html).toContain("Addebito immediato");
    // Identificatore di dominio presente nel title (accessibilità)
    expect(html).toContain("addebito_immediato");
  });

  it("mostra label italiana per fondo_breve", () => {
    const cls = makeClass({ tipologia: "fondo_breve", name: "Vacanze" });
    const cat = makeCategory({ classes: [cls] });
    const fund = makeFund({ categories: [cat] });

    const html = renderToString(
      React.createElement(FundTree, { tree: [fund] }),
    );

    expect(html).toContain("Fondo breve");
  });

  it("mostra label italiana per fondo_lungo", () => {
    const cls = makeClass({ tipologia: "fondo_lungo", name: "Pensione" });
    const cat = makeCategory({ classes: [cls] });
    const fund = makeFund({ categories: [cat] });

    const html = renderToString(
      React.createElement(FundTree, { tree: [fund] }),
    );

    expect(html).toContain("Fondo lungo");
  });

  // ---------------------------------------------------------------------------
  // Test: format EUR italiano
  // Intl.NumberFormat it-IT per 1250 cents → "0,13 €" / "€ 1,25" / "1,25 €"
  // il formato esatto dipende da Node locale ma contiene virgola decimale.
  // ---------------------------------------------------------------------------

  it("formatta importi in EUR con separatore decimale italiano (virgola)", () => {
    // 1250 cents = 12,50 EUR
    const fund = makeFund({
      current_amount_cents: 1250 as FundTreeNode["current_amount_cents"],
      target_amount_cents: 5000 as FundTreeNode["target_amount_cents"],
    });

    const html = renderToString(
      React.createElement(FundTree, { tree: [fund] }),
    );

    // it-IT usa virgola come separatore decimale
    expect(html).toContain("12,50");
    expect(html).toContain("50,00");
  });

  it("non mostra 'Obiettivo' se target_amount_cents è null", () => {
    const fund = makeFund({ target_amount_cents: null });

    const html = renderToString(
      React.createElement(FundTree, { tree: [fund] }),
    );

    expect(html).not.toContain("Obiettivo");
  });

  it("mostra 'Obiettivo' se target_amount_cents è definito", () => {
    const fund = makeFund({
      target_amount_cents: 200000 as FundTreeNode["target_amount_cents"],
    });

    const html = renderToString(
      React.createElement(FundTree, { tree: [fund] }),
    );

    expect(html).toContain("Obiettivo");
    // Verifica solo la parte decimale: it-IT usa sempre virgola come separatore
    // decimale. Il separatore delle migliaia dipende dai dati ICU del runtime
    // (può essere punto, spazio, o assente in Node "small-icu").
    expect(html).toMatch(/2[. \s]?000,00/);
  });
});
