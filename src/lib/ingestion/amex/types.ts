export type AmexSource = "amex_pdf" | "amex_email" | "amex_csv";

export interface AmexTransaction {
  date: string;
  amount: number;
  merchant_raw: string;
  merchant_normalized: string;
  currency: string;
  source: AmexSource;
  external_id: string;
}

export interface AmexPdfParseOptions {
  statementYear?: number;
  currency?: string;
  onDiagnostic?: (diagnostic: AmexPdfDiagnostic) => void;
}

export interface AmexPdfDiagnostic {
  kind: "skipped_row" | "unrecognized_amount" | "unrecognized_date";
  page: number;
  rawRow: string;
  reason: string;
}
