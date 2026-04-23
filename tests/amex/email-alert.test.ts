import { describe, expect, it } from "vitest";
import {
  __INTERNAL__,
  htmlToPlain,
  isAmexAlertSender,
  parseAmexEmailAlert,
  type AmexEmailInput,
} from "../../src/lib/ingestion/amex/email-alert";

// NOTE: questi sample sono costruiti da pattern pubblici/generici di Amex IT.
// Non sono fixture ufficiali CEO — validazione empirica contro EML reali
// (M2 fixture) avverrà in M4c-post-delivery. Se il regex fallisce contro
// i dati reali, il parser rinormalizza; questi test fissano i contratti.

describe("isAmexAlertSender", () => {
  it("accepts known Amex sender domains", () => {
    expect(isAmexAlertSender("alerts@americanexpress.it")).toBe(true);
    expect(isAmexAlertSender('"Amex Italia" <alerts@americanexpress.it>')).toBe(true);
    expect(isAmexAlertSender("noreply@welcome.americanexpress.com")).toBe(true);
    expect(isAmexAlertSender("notice@aexp.com")).toBe(true);
  });

  it("rejects non-Amex senders and malformed input", () => {
    expect(isAmexAlertSender("noreply@revolut.com")).toBe(false);
    expect(isAmexAlertSender("scammer@americanexpress.it.evil.com")).toBe(false);
    expect(isAmexAlertSender("")).toBe(false);
    expect(isAmexAlertSender("plaintext")).toBe(false);
  });
});

describe("htmlToPlain", () => {
  it("strips tags, preserves block breaks, decodes entities", () => {
    const html =
      '<style>.a{color:red}</style>' +
      '<p>Ciao <b>Cliente</b>,</p>' +
      '<div>Importo: &euro;&nbsp;12,34</div>' +
      '<br>Data: 24/04/2026';
    const plain = htmlToPlain(html);
    expect(plain).toContain("Ciao Cliente ,");
    expect(plain).toContain("€ 12,34");
    expect(plain).toContain("24/04/2026");
    expect(plain).not.toContain("<p>");
  });

  it("handles numeric entities", () => {
    expect(htmlToPlain("A&#32;B&#x20;C")).toBe("A B C");
  });
});

describe("parseAmexEmailAlert — canonical text", () => {
  const baseInput: AmexEmailInput = {
    msgId: "m1",
    from: "alerts@americanexpress.it",
    subject: "Avviso di spesa sulla tua Carta",
  };

  it("extracts merchant + amount + date + last4 from canonical text body", () => {
    const res = parseAmexEmailAlert({
      ...baseInput,
      textBody:
        "Gentile Cliente,\n" +
        "Le segnaliamo una transazione di EUR 42,50 presso CAFFETTERIA CENTRALE il 24/04/2026 alle 09:18 con la Carta terminante con 1001.\n" +
        "Cordiali saluti.",
    });
    expect(res.parse_status).toBe("parsed");
    expect(res.merchant_raw).toBe("CAFFETTERIA CENTRALE");
    expect(res.merchant_normalized).toBe("CAFFETTERIA CENTRALE");
    expect(res.amount_cents).toBe(4250);
    expect(res.currency).toBe("EUR");
    expect(res.booked_at).toBe("2026-04-24");
    expect(res.card_last4).toBe("1001");
  });

  it("handles € glyph + thousand separators (€ 1.234,56)", () => {
    const res = parseAmexEmailAlert({
      ...baseInput,
      textBody:
        "Transazione di € 1.234,56 presso ELETTRONICA TECH SRL il 03/12/2025 con la Carta terminante con 4242.",
    });
    expect(res.parse_status).toBe("parsed");
    expect(res.amount_cents).toBe(123456);
    expect(res.card_last4).toBe("4242");
  });

  it("falls back to internalDate when body has no date", () => {
    const res = parseAmexEmailAlert({
      ...baseInput,
      textBody:
        "Abbiamo registrato un addebito di EUR 9,90 presso NETFLIX.COM con la Carta terminante con 9999.",
      internalDate: new Date("2026-03-10T12:00:00Z"),
    });
    expect(res.parse_status).toBe("parsed");
    expect(res.booked_at).toBe("2026-03-10");
    expect(res.merchant_raw).toBe("NETFLIX.COM");
  });

  it("parses HTML body when text body missing", () => {
    const res = parseAmexEmailAlert({
      ...baseInput,
      htmlBody:
        '<html><body>' +
        '<p>Addebito di <b>EUR 15,00</b> presso LIBRERIA ROSSI il 12/05/2026 con la Carta terminante con 5678.</p>' +
        '</body></html>',
    });
    expect(res.parse_status).toBe("parsed");
    expect(res.merchant_raw).toBe("LIBRERIA ROSSI");
    expect(res.amount_cents).toBe(1500);
    expect(res.booked_at).toBe("2026-05-12");
  });
});

describe("parseAmexEmailAlert — failure modes", () => {
  it("returns unrecognized with sender_not_recognized when sender is not Amex", () => {
    const res = parseAmexEmailAlert({
      msgId: "x",
      from: "noreply@revolut.com",
      subject: "Transazione",
      textBody: "Transazione di EUR 10,00 presso FOO il 24/04/2026.",
    });
    expect(res.parse_status).toBe("unrecognized");
    expect(res.parse_error).toBe("sender_not_recognized");
    expect(res.merchant_raw).toBeNull();
    expect(res.amount_cents).toBeNull();
  });

  it("returns unrecognized with amount_not_found when amount is missing", () => {
    const res = parseAmexEmailAlert({
      msgId: "y",
      from: "alerts@americanexpress.it",
      subject: "Amex — promozione",
      textBody:
        "Gentile Cliente, ti ricordiamo che la Carta terminante con 1111 scadrà il 31/12/2026.",
    });
    expect(res.parse_status).toBe("unrecognized");
    expect(res.parse_error).toBe("amount_not_found");
    expect(res.card_last4).toBe("1111");
  });

  it("returns unrecognized with merchant_not_found when merchant isn't present", () => {
    const res = parseAmexEmailAlert({
      msgId: "z",
      from: "alerts@americanexpress.it",
      subject: "Avviso",
      textBody:
        "Transazione di EUR 25,00 registrata il 10/01/2026. Carta terminante con 2222.",
    });
    expect(res.parse_status).toBe("unrecognized");
    expect(res.parse_error).toBe("merchant_not_found");
    expect(res.amount_cents).toBe(2500);
  });

  it("returns unrecognized with empty_body when no text+html+subject", () => {
    const res = parseAmexEmailAlert({
      msgId: "e",
      from: "alerts@americanexpress.it",
      subject: "",
    });
    expect(res.parse_status).toBe("unrecognized");
    expect(res.parse_error).toBe("empty_body");
  });
});

describe("__INTERNAL__ regex helpers", () => {
  it("AMOUNT_RE handles both 'EUR N,NN' and 'N,NN EUR' orders", () => {
    expect("EUR 5,00".match(__INTERNAL__.AMOUNT_RE)).not.toBeNull();
    expect("5,00 EUR".match(__INTERNAL__.AMOUNT_RE)).not.toBeNull();
    expect("€12,99".match(__INTERNAL__.AMOUNT_RE)).not.toBeNull();
  });

  it("LAST4_RE captures last4 under several phrasings", () => {
    expect(__INTERNAL__.extractLast4("terminante con 1234")).toBe("1234");
    expect(__INTERNAL__.extractLast4("Carta terminante con 5678")).toBe("5678");
    expect(__INTERNAL__.extractLast4("*4242")).toBe("4242");
  });

  it("extractMerchant prefers 'presso X' pattern", () => {
    expect(
      __INTERNAL__.extractMerchant(
        "Transazione di EUR 10,00 presso PIZZERIA NAPOLI il 01/01/2026.",
      ),
    ).toBe("PIZZERIA NAPOLI");
  });
});
