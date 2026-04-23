import { createHash } from "node:crypto";

export function computeExternalId(
  date: string,
  amount: number,
  merchant_raw: string,
  extra?: string | number,
): string {
  const parts = [date, amount.toFixed(2), merchant_raw.trim().toUpperCase()];
  if (extra !== undefined && extra !== null && extra !== "") {
    parts.push(String(extra));
  }
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}
