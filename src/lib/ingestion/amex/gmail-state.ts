// Signed OAuth state for the Gmail connect flow.
// Lo state che Google ci rimanda contiene {householdId, userId, nonce} più
// una HMAC sotto SUPABASE_INGESTION_KMS_KEY: evita sia CSRF (nonce in cookie
// cross-checked) sia context loss attraverso il round-trip (non serve una
// tabella server-side di stati pendenti).

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface GmailOAuthStatePayload {
  householdId: string;
  userId: string;
  nonce: string;
  issuedAt: number;
}

const STATE_TTL_MS = 10 * 60 * 1000; // 10 min

function hmacKey(): Buffer {
  const raw = process.env.SUPABASE_INGESTION_KMS_KEY;
  if (!raw) throw new Error("SUPABASE_INGESTION_KMS_KEY not set");
  return Buffer.from(raw, "base64");
}

function sign(body: string, key: Buffer = hmacKey()): string {
  return createHmac("sha256", key).update(body).digest("base64url");
}

export function signState(
  input: Omit<GmailOAuthStatePayload, "nonce" | "issuedAt">,
): { state: string; nonce: string } {
  const nonce = randomBytes(18).toString("base64url");
  const payload: GmailOAuthStatePayload = {
    householdId: input.householdId,
    userId: input.userId,
    nonce,
    issuedAt: Date.now(),
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = sign(body);
  return { state: `${body}.${sig}`, nonce };
}

export class GmailStateError extends Error {
  readonly code: "malformed" | "bad_signature" | "expired" | "nonce_mismatch";
  constructor(code: GmailStateError["code"], message: string) {
    super(message);
    this.name = "GmailStateError";
    this.code = code;
  }
}

export function verifyState(
  state: string,
  expectedNonce: string,
  now: number = Date.now(),
): GmailOAuthStatePayload {
  const dot = state.indexOf(".");
  if (dot <= 0) throw new GmailStateError("malformed", "state missing separator");
  const body = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new GmailStateError("bad_signature", "state HMAC mismatch");
  }
  let payload: GmailOAuthStatePayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw new GmailStateError("malformed", "state body not valid JSON");
  }
  if (now - payload.issuedAt > STATE_TTL_MS) {
    throw new GmailStateError("expired", "state older than TTL");
  }
  const ea = Buffer.from(payload.nonce);
  const eb = Buffer.from(expectedNonce);
  if (ea.length !== eb.length || !timingSafeEqual(ea, eb)) {
    throw new GmailStateError("nonce_mismatch", "state nonce != cookie nonce");
  }
  return payload;
}
