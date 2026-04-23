import { describe, expect, it } from "vitest";
import {
  buildAmexAlertQuery,
  gmailMessageToAmexInput,
  type GmailMessage,
} from "../../src/lib/ingestion/amex/gmail-message";

function b64url(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

describe("gmailMessageToAmexInput", () => {
  it("extracts headers + text body + html body from multipart/alternative", () => {
    const text = "Transazione di EUR 10,00 presso BAR CENTRALE il 01/04/2026.";
    const html = "<p>Transazione di <b>EUR 10,00</b> presso BAR CENTRALE il 01/04/2026.</p>";
    const msg: GmailMessage = {
      id: "msg-1",
      internalDate: "1743465600000",
      payload: {
        mimeType: "multipart/alternative",
        headers: [
          { name: "Subject", value: "Avviso di spesa" },
          { name: "From", value: "Amex <alerts@americanexpress.it>" },
          { name: "Date", value: "Wed, 01 Apr 2026 00:00:00 +0000" },
        ],
        parts: [
          {
            mimeType: "text/plain",
            body: { data: b64url(text), size: text.length },
          },
          {
            mimeType: "text/html",
            body: { data: b64url(html), size: html.length },
          },
        ],
      },
    };

    const input = gmailMessageToAmexInput(msg);
    expect(input.msgId).toBe("msg-1");
    expect(input.subject).toBe("Avviso di spesa");
    expect(input.from).toBe("Amex <alerts@americanexpress.it>");
    expect(input.textBody).toBe(text);
    expect(input.htmlBody).toBe(html);
    expect(input.internalDate?.toISOString()).toBe("2025-04-01T00:00:00.000Z");
  });

  it("handles single-part top-level message (no multipart)", () => {
    const html = "<p>hi</p>";
    const msg: GmailMessage = {
      id: "msg-2",
      payload: {
        mimeType: "text/html",
        headers: [
          { name: "Subject", value: "Hi" },
          { name: "From", value: "x@americanexpress.it" },
        ],
        body: { data: b64url(html), size: html.length },
      },
    };
    const input = gmailMessageToAmexInput(msg);
    expect(input.htmlBody).toBe(html);
    expect(input.textBody).toBeUndefined();
  });

  it("recurses into nested multipart (multipart/mixed → multipart/alternative)", () => {
    const text = "plain body";
    const msg: GmailMessage = {
      id: "msg-3",
      payload: {
        mimeType: "multipart/mixed",
        headers: [{ name: "Subject", value: "Nested" }, { name: "From", value: "a@americanexpress.it" }],
        parts: [
          {
            mimeType: "multipart/alternative",
            parts: [
              {
                mimeType: "text/plain",
                body: { data: b64url(text), size: text.length },
              },
            ],
          },
          {
            mimeType: "application/octet-stream",
            filename: "attachment.bin",
          },
        ],
      },
    };
    const input = gmailMessageToAmexInput(msg);
    expect(input.textBody).toBe(text);
  });

  it("returns empty strings when headers are missing", () => {
    const input = gmailMessageToAmexInput({
      id: "m",
      payload: { mimeType: "text/plain", headers: [], body: { data: "" } },
    });
    expect(input.subject).toBe("");
    expect(input.from).toBe("");
  });
});

describe("buildAmexAlertQuery", () => {
  it("builds default query with 2d window and canonical senders", () => {
    expect(buildAmexAlertQuery()).toBe(
      "from:(alerts@americanexpress.it OR noreply@americanexpress.it OR alerts@welcome.americanexpress.com) newer_than:2d",
    );
  });

  it("accepts custom senders + window", () => {
    expect(
      buildAmexAlertQuery({
        senders: ["custom@americanexpress.it"],
        newerThan: "7d",
      }),
    ).toBe("from:(custom@americanexpress.it) newer_than:7d");
  });
});
