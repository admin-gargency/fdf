export interface AnonymizeOptions {
  cardLast4?: string;
  preserveWords?: string[];
}

const CARD_NUMBER_RE = /\b(?:\d[ -]?){13,19}\b/g;
const IBAN_RE = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/g;
const EMAIL_RE = /[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}/g;
const FISCAL_CODE_RE = /\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/g;
const PHONE_RE = /\b(?:\+?39)?[\s-]?\d{2,4}[\s-]?\d{6,8}\b/g;

export function anonymizeAmexText(
  input: string,
  options: AnonymizeOptions = {},
): string {
  if (!input) return input;

  let out = input;
  out = out.replace(CARD_NUMBER_RE, (match) => {
    const last4 = options.cardLast4 ?? match.replace(/\D/g, "").slice(-4);
    return `XXXX XXXX XXXX ${last4.padStart(4, "X")}`;
  });
  out = out.replace(IBAN_RE, (match) => {
    const prefix = match.slice(0, 4);
    return `${prefix}${"X".repeat(Math.max(0, match.length - 4))}`;
  });
  out = out.replace(EMAIL_RE, "anonymous@example.test");
  out = out.replace(FISCAL_CODE_RE, "XXXXXX00X00X000X");
  out = out.replace(PHONE_RE, "+39 000 0000000");

  return out;
}

export function buildAnonymizedLine(rawLine: string): string {
  return anonymizeAmexText(rawLine);
}
