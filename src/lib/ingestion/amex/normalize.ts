const MONTHS_IT: Record<string, number> = {
  gen: 1, gennaio: 1, jan: 1, january: 1,
  feb: 2, febbraio: 2, february: 2,
  mar: 3, marzo: 3, march: 3,
  apr: 4, aprile: 4, april: 4,
  mag: 5, maggio: 5, may: 5,
  giu: 6, giugno: 6, jun: 6, june: 6,
  lug: 7, luglio: 7, jul: 7, july: 7,
  ago: 8, agosto: 8, aug: 8, august: 8,
  set: 9, settembre: 9, sep: 9, sept: 9, september: 9,
  ott: 10, ottobre: 10, oct: 10, october: 10,
  nov: 11, novembre: 11, november: 11,
  dic: 12, dicembre: 12, dec: 12, december: 12,
};

export function parseItalianDate(
  token: string,
  fallbackYear?: number,
): string | null {
  const trimmed = token.trim().toLowerCase().replace(/\./g, "");

  const numeric = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?$/);
  if (numeric) {
    const day = parseInt(numeric[1], 10);
    const month = parseInt(numeric[2], 10);
    let year: number;
    if (numeric[3]) {
      const raw = parseInt(numeric[3], 10);
      year = raw < 100 ? 2000 + raw : raw;
    } else if (fallbackYear !== undefined) {
      year = fallbackYear;
    } else {
      return null;
    }
    return formatIso(year, month, day);
  }

  const monthName = trimmed.match(/^(\d{1,2})\s+([a-z]+)(?:\s+(\d{2,4}))?$/);
  if (monthName) {
    const day = parseInt(monthName[1], 10);
    const month = MONTHS_IT[monthName[2]];
    if (!month) return null;
    let year: number;
    if (monthName[3]) {
      const raw = parseInt(monthName[3], 10);
      year = raw < 100 ? 2000 + raw : raw;
    } else if (fallbackYear !== undefined) {
      year = fallbackYear;
    } else {
      return null;
    }
    return formatIso(year, month, day);
  }

  return null;
}

function formatIso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  const iso = new Date(Date.UTC(year, month - 1, day));
  if (
    iso.getUTCFullYear() !== year ||
    iso.getUTCMonth() !== month - 1 ||
    iso.getUTCDate() !== day
  ) {
    return null;
  }
  return iso.toISOString().slice(0, 10);
}

export function parseItalianAmount(token: string): number | null {
  let raw = token.trim();
  if (!raw) return null;

  let sign = 1;
  if (/\bCR\b/i.test(raw)) {
    sign = -1;
    raw = raw.replace(/\bCR\b/i, "").trim();
  }
  if (raw.startsWith("(") && raw.endsWith(")")) {
    sign = -1;
    raw = raw.slice(1, -1).trim();
  }
  if (raw.startsWith("-")) {
    sign = -sign;
    raw = raw.slice(1).trim();
  } else if (raw.startsWith("+")) {
    raw = raw.slice(1).trim();
  }

  raw = raw.replace(/[€$£\s]/g, "");

  const hasComma = raw.includes(",");
  const hasDot = raw.includes(".");
  let normalized: string;
  if (hasComma && hasDot) {
    normalized = raw.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    normalized = raw.replace(",", ".");
  } else {
    normalized = raw;
  }

  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const value = parseFloat(normalized);
  if (!Number.isFinite(value)) return null;
  return Math.round(sign * value * 100) / 100;
}

const LOCATION_SUFFIX_RE =
  /\b(ITA|ITALY|ITALIA|MILANO|ROMA|TORINO|NAPOLI|BOLOGNA|FIRENZE|VENEZIA|GENOVA|PALERMO|BARI|CATANIA|VERONA|PADOVA|BRESCIA|MODENA|PARMA|PERUGIA|TRIESTE|TARANTO|CAGLIARI)\b/g;

const MULTISPACE_RE = /\s+/g;

export function normalizeMerchant(raw: string): string {
  let out = raw.trim();
  if (!out) return "";
  out = out.toUpperCase();
  out = out.replace(LOCATION_SUFFIX_RE, " ");
  out = out.replace(/\b\d{6,}\b/g, " ");
  out = out.replace(/[^A-Z0-9 &\-\.]/g, " ");
  out = out.replace(MULTISPACE_RE, " ").trim();
  return out;
}
