/**
 * SPREADSHEET EXTRACTION — the single entry point for .xlsx, .xls and .csv files.
 *
 *   bytes + file name ──► format check ──► Excel reader or CSV reader ──► ExtractionResult
 *
 * The result holds:
 *   - the SourceDocument (file name, size, SHA-256 fingerprint, format; document type "unknown",
 *     because deciding what kind of document it is happens in a later stage);
 *   - one ExtractedTable per worksheet (all worksheets, hidden ones included, in workbook order)
 *     or one table for a CSV file;
 *   - information about each worksheet (or the CSV), and every issue found.
 *
 * The original bytes are never changed: the readers work on copies, and nothing is written.
 * Nothing is interpreted, calculated, removed or combined.
 */
import { frozenCopy } from '../../lib/immutable.ts';
import type { ExtractedTable } from '../models/extraction.ts';
import { type SourceDocument, createSourceDocument } from '../models/source.ts';
import { type CsvInfo, type CsvOptions, extractCsv } from './csv/csv.ts';
import { type SpreadsheetFormat, detectSpreadsheetFormat } from './formatDetect.ts';
import { sha256Hex } from './hash.ts';
import type { ExtractionIssue } from './issues.ts';
import { type WorksheetInfo, extractWorkbookObject, readWorkbook } from './spreadsheet/workbook.ts';

export interface SpreadsheetFileInput {
  readonly bytes: Uint8Array;
  readonly fileName: string;
  readonly projectId: string;
  readonly documentId: string;
  readonly uploadedAt: string;
  readonly uploadedBy: string | null;
  readonly organizationId: string | null;
}

export interface ExtractionOptions {
  readonly csv?: CsvOptions;
}

export interface ExtractionResult {
  readonly document: SourceDocument;
  readonly format: SpreadsheetFormat;
  readonly tables: readonly ExtractedTable[];
  /** Worksheets in workbook order (Excel files only). */
  readonly sheets: readonly WorksheetInfo[];
  /** CSV details (CSV files only). */
  readonly csv: CsvInfo | null;
  readonly issues: readonly ExtractionIssue[];
}

/** Reads a spreadsheet file. Throws ExtractionError when the file as a whole cannot be read. */
export async function extractSpreadsheetFile(input: SpreadsheetFileInput, options: ExtractionOptions = {}): Promise<ExtractionResult> {
  const { format, issues: formatIssues } = detectSpreadsheetFormat(input.bytes, input.fileName);
  const sha256 = await sha256Hex(input.bytes);

  const document = createSourceDocument({
    id: input.documentId,
    projectId: input.projectId,
    fileName: input.fileName,
    fileSizeBytes: input.bytes.length,
    sha256,
    format,
    documentType: 'unknown', // decided (and reviewed) in a later stage — extraction does not classify
    uploadedAt: input.uploadedAt,
    uploadedBy: input.uploadedBy,
    organizationId: input.organizationId,
  });

  if (format === 'csv') {
    const { table, csv, issues } = extractCsv(input.bytes, document, options.csv);
    return frozenCopy({ document, format, tables: [table], sheets: [], csv, issues: [...formatIssues, ...issues] });
  }

  const workbook = readWorkbook(input.bytes, input.fileName);
  const { tables, sheets, issues } = extractWorkbookObject(workbook, document);
  return frozenCopy({ document, format, tables, sheets, csv: null, issues: [...formatIssues, ...issues] });
}
