import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import {
  decryptToken,
  encryptToken,
  fromPgHex,
  IngestionCryptoError,
  safeEquals,
  toPgHex,
} from "../../src/lib/ingestion/crypto";

const KEY_B64 = randomBytes(32).toString("base64");

describe("ingestion/crypto", () => {
  const previousKey = process.env.SUPABASE_INGESTION_KMS_KEY;

  beforeEach(() => {
    process.env.SUPABASE_INGESTION_KMS_KEY = KEY_B64;
  });

  afterEach(() => {
    if (previousKey === undefined) delete process.env.SUPABASE_INGESTION_KMS_KEY;
    else process.env.SUPABASE_INGESTION_KMS_KEY = previousKey;
  });

  it("round-trips plaintext through AES-256-GCM", () => {
    const plain = "1//0abc.refresh_token_with_ünicode_é";
    const ct = encryptToken(plain);
    expect(ct.length).toBeGreaterThan(plain.length);
    expect(decryptToken(ct)).toBe(plain);
  });

  it("produces different ciphertext for the same plaintext (random IV)", () => {
    const plain = "same-input";
    const a = encryptToken(plain);
    const b = encryptToken(plain);
    expect(a.equals(b)).toBe(false);
    expect(decryptToken(a)).toBe(plain);
    expect(decryptToken(b)).toBe(plain);
  });

  it("decrypt fails when the key is wrong", () => {
    const ct = encryptToken("secret");
    const otherKey = randomBytes(32);
    expect(() => decryptToken(ct, otherKey)).toThrowError(IngestionCryptoError);
  });

  it("decrypt fails when the ciphertext is tampered", () => {
    const ct = encryptToken("hello");
    ct[ct.length - 1] ^= 0xff;
    expect(() => decryptToken(ct)).toThrowError(/auth tag mismatch/);
  });

  it("throws missing_key when env var absent", () => {
    delete process.env.SUPABASE_INGESTION_KMS_KEY;
    expect(() => encryptToken("x")).toThrowError(
      expect.objectContaining({ code: "missing_key" }),
    );
  });

  it("throws invalid_key when key is not 32 bytes", () => {
    process.env.SUPABASE_INGESTION_KMS_KEY = randomBytes(16).toString("base64");
    expect(() => encryptToken("x")).toThrowError(
      expect.objectContaining({ code: "invalid_key" }),
    );
  });

  it("pg hex round-trip", () => {
    const buf = Buffer.from([0x01, 0x02, 0xff, 0x00, 0xab]);
    expect(toPgHex(buf)).toBe("\\x0102ff00ab");
    expect(fromPgHex("\\x0102ff00ab").equals(buf)).toBe(true);
    expect(fromPgHex("0102ff00ab").equals(buf)).toBe(true);
  });

  it("safeEquals returns true on identical, false on differing", () => {
    expect(safeEquals("abc", "abc")).toBe(true);
    expect(safeEquals("abc", "abd")).toBe(false);
    expect(safeEquals("abc", "abcd")).toBe(false);
  });
});
