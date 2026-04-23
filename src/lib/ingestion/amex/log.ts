export interface AmexPdfParsedLog {
  event: "amex.pdf.parsed";
  transactions: number;
  pages: number;
  durationMs: number;
  statementYear?: number;
  diagnostics?: number;
}

export function logAmexPdfParsed(payload: Omit<AmexPdfParsedLog, "event">): void {
  const line: AmexPdfParsedLog = { event: "amex.pdf.parsed", ...payload };
  process.stdout.write(JSON.stringify(line) + "\n");
}

export interface AmexCsvParsedLog {
  event: "amex.csv.parsed";
  transactions: number;
  rows: number;
  separator: string;
  durationMs: number;
  diagnostics?: number;
}

export function logAmexCsvParsed(payload: Omit<AmexCsvParsedLog, "event">): void {
  const line: AmexCsvParsedLog = { event: "amex.csv.parsed", ...payload };
  process.stdout.write(JSON.stringify(line) + "\n");
}
