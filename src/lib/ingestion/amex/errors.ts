export type AmexPdfErrorCode =
  | "encrypted_pdf"
  | "corrupted_pdf"
  | "empty_pdf"
  | "no_transactions_found"
  | "unsupported_format";

export interface AmexPdfErrorContext {
  pageCount?: number;
  statementYear?: number;
  firstBytesHex?: string;
  pdfjsMessage?: string;
  rawRowsSampled?: number;
}

export class AmexPdfParseError extends Error {
  readonly code: AmexPdfErrorCode;
  readonly context: AmexPdfErrorContext;

  constructor(
    code: AmexPdfErrorCode,
    message: string,
    context: AmexPdfErrorContext = {},
  ) {
    super(message);
    this.name = "AmexPdfParseError";
    this.code = code;
    this.context = context;
  }
}

export type AmexCsvErrorCode =
  | "empty_csv"
  | "unsupported_format"
  | "no_transactions_found";

export interface AmexCsvErrorContext {
  headers?: string[];
  rowsSampled?: number;
}

export class AmexCsvParseError extends Error {
  readonly code: AmexCsvErrorCode;
  readonly context: AmexCsvErrorContext;

  constructor(
    code: AmexCsvErrorCode,
    message: string,
    context: AmexCsvErrorContext = {},
  ) {
    super(message);
    this.name = "AmexCsvParseError";
    this.code = code;
    this.context = context;
  }
}
