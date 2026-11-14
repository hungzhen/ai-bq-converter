/**
 * Problems found while reading a file.
 *
 * - An ExtractionError is THROWN when the file as a whole cannot be read (unsupported format,
 *   empty, corrupted, password-protected, CSV delimiter / encoding / structure that cannot be
 *   determined reliably). Nothing is extracted from such a file.
 * - ExtractionIssues are RETURNED with the result for everything else: a worksheet or cell that
 *   failed, hidden content, formulas without cached results, unusual merges … Nothing is
 *   skipped silently: every one of these is listed.
 */
export type ExtractionErrorCode =
  | 'UNSUPPORTED_FORMAT'
  | 'EMPTY_FILE'
  | 'FORMAT_MISMATCH'
  | 'CORRUPTED_FILE'
  | 'PASSWORD_PROTECTED'
  | 'EMPTY_WORKBOOK'
  | 'CSV_ENCODING_UNDETERMINED'
  | 'CSV_DELIMITER_UNDETERMINED'
  | 'CSV_DELIMITER_AMBIGUOUS'
  | 'CSV_UNTERMINATED_QUOTE';

export class ExtractionError extends Error {
  override name = 'ExtractionError';
  constructor(
    readonly code: ExtractionErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export type ExtractionIssueCode =
  // file level
  | 'EXTENSION_MISMATCH'
  | 'EMPTY_WORKBOOK'
  // worksheet level
  | 'EMPTY_WORKSHEET'
  | 'HIDDEN_WORKSHEET'
  | 'VERY_HIDDEN_WORKSHEET'
  | 'HIDDEN_ROWS'
  | 'HIDDEN_COLUMNS'
  | 'DECLARED_RANGE_DIFFERS'
  | 'OVERLAPPING_MERGES'
  | 'SHEET_EXTRACTION_FAILED'
  // cell level
  | 'FORMULA_CELLS'
  | 'FORMULA_RESULT_MISSING'
  | 'CELL_ERROR_VALUE'
  | 'MERGED_CELL_HIDES_VALUE'
  | 'DATE_FORMATTED_NUMBER'
  | 'CELL_EXTRACTION_FAILED'
  // CSV
  | 'CSV_ENCODING'
  | 'CSV_DELIMITER'
  | 'CSV_FIELD_COUNT_DIFFERS'
  | 'CSV_INCONSISTENT_FIELD_COUNTS'
  | 'CSV_STRAY_QUOTE'
  | 'CSV_TEXT_AFTER_QUOTE';

export type ExtractionIssueSeverity = 'info' | 'warning' | 'error';

export interface ExtractionIssue {
  readonly code: ExtractionIssueCode;
  readonly severity: ExtractionIssueSeverity;
  readonly message: string;
  readonly sheetName?: string;
  readonly cellAddress?: string;
  readonly rowNumber?: number;
}
