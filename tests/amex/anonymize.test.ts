import { describe, expect, it } from "vitest";
import { anonymizeAmexText } from "../../src/lib/ingestion/amex/anonymize";

describe("anonymizeAmexText", () => {
  it("masks card numbers keeping last 4", () => {
    const out = anonymizeAmexText("Numero carta: 3782 822463 10005");
    expect(out).toContain("XXXX XXXX XXXX");
    expect(out).toContain("0005");
    expect(out).not.toContain("3782");
  });

  it("masks IBAN leaving country + checksum", () => {
    const out = anonymizeAmexText("IBAN IT60X0542811101000000123456");
    expect(out.startsWith("IBAN IT60")).toBe(true);
    expect(out).not.toContain("0542811101000000123456");
  });

  it("masks emails and phone numbers", () => {
    const out = anonymizeAmexText("Contatti: mario.rossi@example.com +39 3331234567");
    expect(out).toContain("anonymous@example.test");
    expect(out).toContain("+39 000 0000000");
    expect(out).not.toContain("3331234567");
  });

  it("masks Italian fiscal code", () => {
    const out = anonymizeAmexText("Codice fiscale: RSSMRA85T10A562S");
    expect(out).toContain("XXXXXX00X00X000X");
    expect(out).not.toContain("RSSMRA85T10A562S");
  });
});
