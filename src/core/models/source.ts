/**
 * SOURCE DOCUMENTS AND SOURCE REFERENCES
 *
 * A SourceDocument is one uploaded file. A project can hold many (see project.ts).
 * A SourceReference points to one exact place in one document:
 *   - Excel (XLSX / XLS): worksheet + row (+ column / cell address);
 *   - CSV: row (+ column);
 *   - PDF: page (+ line and position on the page), and whether it was read from the
 *     PDF's text or by OCR (with the OCR confidence).
 * Every reference also carries the file name and document type, so it can be understood on its own.
 */
import { frozenCopy } from '../../lib/immutable.ts';

export type SourceFormat = 'xlsx' | 'xls' | 'csv' | 'pdf';

export type SourceDocumentType =
  | 'standard_bq'
  | 'contractor_working_file'
  | 'progress_claim'
  | 'summary_only'
  | 'unknown';

export const SOURCE_DOCUMENT_TYPES: readonly SourceDocumentType[] = [
  'standard_bq',
  'contractor_working_file',
  'progress_claim',
  'summary_only',
  'unknown',
];

export interface SourceDocument {
  readonly id: string;
  readonly projectId: string;
  /** File name exactly as uploaded. */
  readonly fileName: string;
  readonly fileSizeBytes: number;
  /** SHA-256 fingerprint of the file's bytes (64 hexadecimal characters). */
  readonly sha256: string;
  readonly format: SourceFormat;
  readonly documentType: SourceDocumentType;
  readonly uploadedAt: string;
  /** User id; null while the app runs locally without sign-in. */
  readonly uploadedBy: string | null;
  readonly organizationId: string | null;
}

/** What every reference carries so it is understandable on its own. */
interface ReferenceBase {
  readonly documentId: string;
  readonly fileName: string;
  readonly documentType: SourceDocumentType;
}

export interface WorksheetReference extends ReferenceBase {
  readonly kind: 'worksheet';
  /** Worksheet name exactly as in the file (not trimmed or changed). */
  readonly sheetName: string;
  /** Position of the sheet in the workbook, 0 = first sheet. */
  readonly sheetIndex: number;
  /** Row number as shown in Excel (1 = first row). */
  readonly rowNumber: number;
  /** Column number (1 = column A), when the reference is to one cell. */
  readonly columnNumber?: number;
  /** Cell address as shown in Excel, e.g. "E14". */
  readonly cellAddress?: string;
}

export interface CsvReference extends ReferenceBase {
  readonly kind: 'csv';
  /** Line number in the file (1 = first line). */
  readonly rowNumber: number;
  /** Field number on the line (1 = first field). */
  readonly columnNumber?: number;
  /** Spreadsheet-style address, e.g. "E14", for display only. */
  readonly cellAddress?: string;
}

/** A rectangle on a PDF page, in PDF points (1/72 inch), measured from the top-left corner. */
export interface PageBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type PdfExtraction = 'text_layer' | 'ocr';

export interface PdfReference extends ReferenceBase {
  readonly kind: 'pdf';
  /** Page number (1 = first page). */
  readonly pageNumber: number;
  /** Text line number on the page (1 = top line), when known. */
  readonly lineNumber?: number;
  readonly boundingBox?: PageBox;
  /** How the text was obtained: the PDF's own text, or OCR of a scanned image. */
  readonly extraction: PdfExtraction;
  /** OCR confidence 0–100 (OCR only). */
  readonly ocrConfidence?: number;
}

export type SourceReference = WorksheetReference | CsvReference | PdfReference;

/** The parts of a SourceDocument a reference needs. */
export type DocumentIdentity = Pick<SourceDocument, 'id' | 'fileName' | 'documentType' | 'format'>;

export class SourceReferenceError extends Error {
  override name = 'SourceReferenceError';
}

const isPositiveInteger = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1;

function requireThat(condition: boolean, message: string): void {
  if (!condition) throw new SourceReferenceError(message);
}

/** 1 → "A", 26 → "Z", 27 → "AA". */
export function columnLetter(columnNumber: number): string {
  requireThat(isPositiveInteger(columnNumber), `Column number must be a whole number of 1 or more (got ${columnNumber}).`);
  let n = columnNumber;
  let letters = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/** (14, 5) → "E14". */
export function cellAddress(rowNumber: number, columnNumber: number): string {
  requireThat(isPositiveInteger(rowNumber), `Row number must be a whole number of 1 or more (got ${rowNumber}).`);
  return `${columnLetter(columnNumber)}${rowNumber}`;
}

export function createSourceDocument(input: SourceDocument): SourceDocument {
  requireThat(input.id.trim() !== '', 'A source document needs an id.');
  requireThat(input.projectId.trim() !== '', 'A source document must belong to a project.');
  requireThat(input.fileName.trim() !== '', 'A source document needs its file name.');
  requireThat(/^[0-9a-f]{64}$/.test(input.sha256), 'sha256 must be 64 lower-case hexadecimal characters.');
  requireThat(Number.isInteger(input.fileSizeBytes) && input.fileSizeBytes >= 0, 'File size must be a whole number of bytes.');
  requireThat(SOURCE_DOCUMENT_TYPES.includes(input.documentType), `Unknown document type "${input.documentType}".`);
  return frozenCopy(input);
}

function base(document: DocumentIdentity): ReferenceBase {
  requireThat(document.id.trim() !== '', 'A reference must name its document.');
  return { documentId: document.id, fileName: document.fileName, documentType: document.documentType };
}

export function createWorksheetReference(
  document: DocumentIdentity,
  at: { sheetName: string; sheetIndex: number; rowNumber: number; columnNumber?: number },
): WorksheetReference {
  requireThat(document.format === 'xlsx' || document.format === 'xls', `A worksheet reference needs an Excel file, not "${document.format}".`);
  requireThat(at.sheetName !== '', 'A worksheet reference needs the worksheet name.');
  requireThat(Number.isInteger(at.sheetIndex) && at.sheetIndex >= 0, 'Sheet index must be 0 or more.');
  requireThat(isPositiveInteger(at.rowNumber), `Row number must be a whole number of 1 or more (got ${at.rowNumber}).`);
  const ref: WorksheetReference = {
    kind: 'worksheet',
    ...base(document),
    sheetName: at.sheetName,
    sheetIndex: at.sheetIndex,
    rowNumber: at.rowNumber,
    ...(at.columnNumber !== undefined
      ? { columnNumber: at.columnNumber, cellAddress: cellAddress(at.rowNumber, at.columnNumber) }
      : {}),
  };
  return frozenCopy(ref);
}

export function createCsvReference(
  document: DocumentIdentity,
  at: { rowNumber: number; columnNumber?: number },
): CsvReference {
  requireThat(document.format === 'csv', `A CSV reference needs a CSV file, not "${document.format}".`);
  requireThat(isPositiveInteger(at.rowNumber), `Row number must be a whole number of 1 or more (got ${at.rowNumber}).`);
  const ref: CsvReference = {
    kind: 'csv',
    ...base(document),
    rowNumber: at.rowNumber,
    ...(at.columnNumber !== undefined
      ? { columnNumber: at.columnNumber, cellAddress: cellAddress(at.rowNumber, at.columnNumber) }
      : {}),
  };
  return frozenCopy(ref);
}

export function createPdfReference(
  document: DocumentIdentity,
  at: { pageNumber: number; extraction: PdfExtraction; lineNumber?: number; boundingBox?: PageBox; ocrConfidence?: number },
): PdfReference {
  requireThat(document.format === 'pdf', `A PDF reference needs a PDF file, not "${document.format}".`);
  requireThat(isPositiveInteger(at.pageNumber), `Page number must be a whole number of 1 or more (got ${at.pageNumber}).`);
  if (at.lineNumber !== undefined) {
    requireThat(isPositiveInteger(at.lineNumber), `Line number must be a whole number of 1 or more (got ${at.lineNumber}).`);
  }
  if (at.boundingBox) {
    const { x, y, width, height } = at.boundingBox;
    requireThat([x, y, width, height].every((v) => Number.isFinite(v) && v >= 0), 'Position values must be 0 or more.');
  }
  if (at.ocrConfidence !== undefined) {
    requireThat(at.extraction === 'ocr', 'OCR confidence can only be given for text read by OCR.');
    requireThat(Number.isFinite(at.ocrConfidence) && at.ocrConfidence >= 0 && at.ocrConfidence <= 100, 'OCR confidence must be between 0 and 100.');
  }
  const ref: PdfReference = {
    kind: 'pdf',
    ...base(document),
    pageNumber: at.pageNumber,
    extraction: at.extraction,
    ...(at.lineNumber !== undefined ? { lineNumber: at.lineNumber } : {}),
    ...(at.boundingBox ? { boundingBox: at.boundingBox } : {}),
    ...(at.ocrConfidence !== undefined ? { ocrConfidence: at.ocrConfidence } : {}),
  };
  return frozenCopy(ref);
}

/**
 * The reference in the Cost Library's own `sourceReference` format.
 * Worksheet: "Sheet: Bill 3 | Row 214" (identical to the Cost Library import).
 * CSV: "Row 12".  PDF: "Page 3 | Line 14".
 */
export function toCostLibrarySourceReference(ref: SourceReference): string {
  switch (ref.kind) {
    case 'worksheet':
      return `Sheet: ${ref.sheetName} | Row ${ref.rowNumber}`;
    case 'csv':
      return `Row ${ref.rowNumber}`;
    case 'pdf':
      return ref.lineNumber !== undefined ? `Page ${ref.pageNumber} | Line ${ref.lineNumber}` : `Page ${ref.pageNumber}`;
  }
}

/** Full plain-English description, including the file name. */
export function describeSourceReference(ref: SourceReference): string {
  const parts = [ref.fileName, toCostLibrarySourceReference(ref)];
  if (ref.kind !== 'pdf' && ref.cellAddress) parts.push(`Cell ${ref.cellAddress}`);
  if (ref.kind === 'pdf') {
    if (ref.boundingBox) {
      const b = ref.boundingBox;
      parts.push(`Position x=${b.x} y=${b.y} w=${b.width} h=${b.height} pt`);
    }
    parts.push(ref.extraction === 'ocr' ? `OCR${ref.ocrConfidence !== undefined ? ` ${ref.ocrConfidence}%` : ''}` : 'PDF text');
  }
  return parts.join(' | ');
}

/** True when two references point to the same place in the same document. */
export function isSameLocation(a: SourceReference, b: SourceReference): boolean {
  return describeSourceReference(a) === describeSourceReference(b) && a.documentId === b.documentId;
}
