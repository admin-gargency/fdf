// Symmetric encryption wrapper per token OAuth at rest (ADR-0003 §3).
// AES-256-GCM app-side; key from SUPABASE_INGESTION_KMS_KEY (32 bytes, base64).
// Output format: base64(iv(12) || authTag(16) || ciphertext) — self-contained,
// nessun derive/salt separato perché la chiave è già high-entropy (KMS).
//
// La colonna Postgres è bytea: lato client mandiamo l'hex con prefix `\x`.

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export class IngestionCryptoError extends Error {
  readonly code: "missing_key" | "invalid_key" | "decrypt_failed";
  constructor(code: IngestionCryptoError["code"], message: string) {
    super(message);
    this.name = "IngestionCryptoError";
    this.code = code;
  }
}

function loadKey(): Buffer {
  const raw = process.env.SUPABASE_INGESTION_KMS_KEY;
  if (!raw) {
    throw new IngestionCryptoError(
      "missing_key",
      "SUPABASE_INGESTION_KMS_KEY not set",
    );
  }
  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    throw new IngestionCryptoError("invalid_key", "KMS key not valid base64");
  }
  if (key.length !== KEY_BYTES) {
    throw new IngestionCryptoError(
      "invalid_key",
      `KMS key must decode to ${KEY_BYTES} bytes, got ${key.length}`,
    );
  }
  return key;
}

export function encryptToken(plaintext: string, key?: Buffer): Buffer {
  const k = key ?? loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, k, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]);
}

export function decryptToken(packed: Buffer, key?: Buffer): string {
  const k = key ?? loadKey();
  if (packed.length < IV_BYTES + TAG_BYTES + 1) {
    throw new IngestionCryptoError("decrypt_failed", "packed buffer too short");
  }
  const iv = packed.subarray(0, IV_BYTES);
  const tag = packed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ct = packed.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGO, k, iv);
  decipher.setAuthTag(tag);
  try {
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString("utf8");
  } catch {
    throw new IngestionCryptoError(
      "decrypt_failed",
      "AEAD auth tag mismatch (wrong key or corrupted ciphertext)",
    );
  }
}

export function toPgHex(buf: Buffer): string {
  return `\\x${buf.toString("hex")}`;
}

export function fromPgHex(value: string): Buffer {
  const hex = value.startsWith("\\x") ? value.slice(2) : value;
  return Buffer.from(hex, "hex");
}

// Constant-time state-cookie comparison per OAuth CSRF state.
export function safeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
