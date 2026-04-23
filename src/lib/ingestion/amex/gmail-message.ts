// Adapter Gmail API → AmexEmailInput.
// Un messaggio restituito da users.messages.get(id, format: 'full') ha
// payload.parts[] con partId, mimeType, body.data (base64url), filename,
// headers[]. Noi estraiamo subject/from dai headers e text/html body
// navigando l'albero delle parts (multipart/alternative, multipart/mixed).

import type { AmexEmailInput } from "./email-alert";

type Header = { name: string; value: string };

interface GmailBody {
  data?: string;
  size?: number;
}

interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: Header[];
  body?: GmailBody;
  parts?: GmailPart[];
}

export interface GmailMessage {
  id: string;
  threadId?: string;
  internalDate?: string; // millis dal epoch, come stringa
  payload?: GmailPart;
}

function decodeB64Url(data: string): string {
  // Gmail usa base64url (`-` invece di `+`, `_` invece di `/`, no padding).
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(padLen);
  return Buffer.from(padded, "base64").toString("utf8");
}

function findHeader(headers: Header[] | undefined, name: string): string {
  if (!headers) return "";
  const target = name.toLowerCase();
  for (const h of headers) {
    if (h.name.toLowerCase() === target) return h.value;
  }
  return "";
}

// Visita ricorsivamente le parts e accumula text/plain e text/html decoded.
// Ritorna il primo body non vuoto per ciascun tipo (Gmail espone tipicamente
// un singolo text/plain e un singolo text/html a profondità max 2-3).
function extractBodies(part: GmailPart | undefined): {
  textBody?: string;
  htmlBody?: string;
} {
  if (!part) return {};
  const result: { textBody?: string; htmlBody?: string } = {};

  const visit = (p: GmailPart) => {
    const mime = (p.mimeType ?? "").toLowerCase();
    if (mime === "text/plain" && p.body?.data && !result.textBody) {
      result.textBody = decodeB64Url(p.body.data);
    } else if (mime === "text/html" && p.body?.data && !result.htmlBody) {
      result.htmlBody = decodeB64Url(p.body.data);
    }
    if (p.parts) {
      for (const child of p.parts) visit(child);
    }
  };

  visit(part);

  // Se il messaggio ha un solo body al top-level (no multipart), lo trattiamo
  // in base al suo mimeType.
  if (!result.textBody && !result.htmlBody && part.body?.data) {
    const mime = (part.mimeType ?? "").toLowerCase();
    const content = decodeB64Url(part.body.data);
    if (mime.startsWith("text/html")) result.htmlBody = content;
    else result.textBody = content;
  }

  return result;
}

export function gmailMessageToAmexInput(msg: GmailMessage): AmexEmailInput {
  const subject = findHeader(msg.payload?.headers, "Subject");
  const from = findHeader(msg.payload?.headers, "From");
  const bodies = extractBodies(msg.payload);

  const internalDate =
    msg.internalDate && /^\d+$/.test(msg.internalDate)
      ? new Date(parseInt(msg.internalDate, 10))
      : undefined;

  return {
    msgId: msg.id,
    subject,
    from,
    textBody: bodies.textBody,
    htmlBody: bodies.htmlBody,
    internalDate,
  };
}

// --- Gmail query helpers (usati dal cron M4d) -----------------------------------

// ADR-0005 opzione D §3: filter Gmail API
// "from:(alerts@americanexpress.it OR noreply@americanexpress.it) newer_than:1d"
// Lista dinamica di sender mittenti (Amex cambia mittente nel tempo) +
// finestra configurabile. Newer-than default = 2d per coprire slip cron.
export interface GmailQueryOptions {
  senders?: string[];
  newerThan?: string; // es. "2d", "1h", "30d"
}

const DEFAULT_SENDERS = [
  "alerts@americanexpress.it",
  "noreply@americanexpress.it",
  "alerts@welcome.americanexpress.com",
];

export function buildAmexAlertQuery(
  options: GmailQueryOptions = {},
): string {
  const senders = options.senders ?? DEFAULT_SENDERS;
  const newer = options.newerThan ?? "2d";
  const fromClause = senders.map((s) => s).join(" OR ");
  return `from:(${fromClause}) newer_than:${newer}`;
}
