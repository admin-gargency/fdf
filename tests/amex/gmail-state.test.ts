import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import {
  GmailStateError,
  signState,
  verifyState,
} from "../../src/lib/ingestion/amex/gmail-state";

const KEY_B64 = randomBytes(32).toString("base64");

describe("gmail-state sign/verify", () => {
  const previousKey = process.env.SUPABASE_INGESTION_KMS_KEY;

  beforeEach(() => {
    process.env.SUPABASE_INGESTION_KMS_KEY = KEY_B64;
  });

  afterEach(() => {
    if (previousKey === undefined) delete process.env.SUPABASE_INGESTION_KMS_KEY;
    else process.env.SUPABASE_INGESTION_KMS_KEY = previousKey;
  });

  it("round-trips payload via signed state + nonce cookie", () => {
    const { state, nonce } = signState({
      householdId: "h-1",
      userId: "u-1",
    });
    const payload = verifyState(state, nonce);
    expect(payload.householdId).toBe("h-1");
    expect(payload.userId).toBe("u-1");
    expect(payload.nonce).toBe(nonce);
    expect(typeof payload.issuedAt).toBe("number");
  });

  it("rejects tampered state body", () => {
    const { state, nonce } = signState({ householdId: "h-1", userId: "u-1" });
    const [body, sig] = state.split(".");
    const tampered = Buffer.from(body, "base64url").toString("utf8").replace("h-1", "h-X");
    const reEncoded = Buffer.from(tampered, "utf8").toString("base64url");
    expect(() => verifyState(`${reEncoded}.${sig}`, nonce)).toThrowError(GmailStateError);
  });

  it("rejects wrong nonce (cookie mismatch)", () => {
    const { state } = signState({ householdId: "h-1", userId: "u-1" });
    expect(() => verifyState(state, "not-the-real-nonce-aaaaaaaaaaaaaaaa")).toThrowError(
      expect.objectContaining({ code: "nonce_mismatch" }),
    );
  });

  it("rejects expired state", () => {
    const { state, nonce } = signState({ householdId: "h-1", userId: "u-1" });
    const future = Date.now() + 11 * 60 * 1000;
    expect(() => verifyState(state, nonce, future)).toThrowError(
      expect.objectContaining({ code: "expired" }),
    );
  });

  it("rejects malformed state (no separator)", () => {
    expect(() => verifyState("nopeitsgarbage", "x")).toThrowError(
      expect.objectContaining({ code: "malformed" }),
    );
  });
});
