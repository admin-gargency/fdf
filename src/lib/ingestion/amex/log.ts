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
