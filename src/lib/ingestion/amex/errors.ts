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
