import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAmexPdf } from "../../src/lib/ingestion/amex/pdf";

const FIXTURES_ROOT = join(__dirname, "fixtures");
const PDF_DIR = join(FIXTURES_ROOT, "pdf");
const GROUND_TRUTH_DIR = join(FIXTURES_ROOT, "ground-truth");

interface GroundTruthRow {
  date: string;
  amount: number;
  merchant_normalized: string;
}

function listPdfFixtures(): string[] {
  if (!existsSync(PDF_DIR)) return [];
  return readdirSync(PDF_DIR)
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .filter((f) => {
      const s = statSync(join(PDF_DIR, f));
      return s.isFile() && s.size > 0;
    });
}

function loadGroundTruth(pdfFile: string): GroundTruthRow[] | null {
  const base = basename(pdfFile, ".pdf");
  const csvPath = join(GROUND_TRUTH_DIR, `${base}.csv`);
  if (!existsSync(csvPath)) return null;
  const raw = readFileSync(csvPath, "utf8").trim();
  const [header, ...lines] = raw.split(/\r?\n/);
  const cols = header.split(",").map((c) => c.trim());
  const dateIdx = cols.indexOf("date");
  const amountIdx = cols.indexOf("amount");
  const merchantIdx = cols.indexOf("merchant_normalized");
  if (dateIdx < 0 || amountIdx < 0 || merchantIdx < 0) return null;
  return lines
    .filter((l) => l.trim())
    .map((line) => {
      const parts = parseCsvRow(line);
      return {
        date: parts[dateIdx],
        amount: parseFloat(parts[amountIdx]),
        merchant_normalized: parts[merchantIdx],
      };
    });
}

function parseCsvRow(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function accuracy(
  parsed: { date: string; amount: number; merchant_normalized: string }[],
  truth: GroundTruthRow[],
): number {
  const truthKeys = new Set(
    truth.map((t) => `${t.date}|${t.amount.toFixed(2)}|${t.merchant_normalized}`),
  );
  let hits = 0;
  for (const p of parsed) {
    const key = `${p.date}|${p.amount.toFixed(2)}|${p.merchant_normalized}`;
    if (truthKeys.has(key)) hits++;
  }
  return truth.length === 0 ? 0 : hits / truth.length;
}

const fixtures = listPdfFixtures();
const ACCURACY_TARGET = 0.99;

describe("Amex PDF fixture accuracy (customer zero)", () => {
  if (fixtures.length === 0) {
    it.skip("awaits ≥6 customer-zero fixtures (M2 deadline 2026-04-30) before enforcing ≥99% accuracy", () => {});
    return;
  }

  it("has at least 6 fixtures per ADR-0005 empirical verification gate", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(6);
  });

  for (const pdf of fixtures) {
    const truth = loadGroundTruth(pdf);
    if (!truth) {
      it.skip(`${pdf}: missing ground-truth CSV — drop a sibling .csv in tests/amex/fixtures/ground-truth/`, () => {});
      continue;
    }
    it(`${pdf}: parser matches ground truth at ≥${Math.round(ACCURACY_TARGET * 100)}%`, async () => {
      const buf = readFileSync(join(PDF_DIR, pdf));
      const parsed = await parseAmexPdf(buf);
      const acc = accuracy(parsed, truth);
      expect(acc).toBeGreaterThanOrEqual(ACCURACY_TARGET);
    });
  }
});
