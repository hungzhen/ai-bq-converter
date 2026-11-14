/** Stage 2C — SourceDocument and SourceReference. SYNTHETIC — NOT REAL COST DATA. */
import { describe, expect, it } from 'vitest';
import {
  SourceReferenceError,
  cellAddress,
  columnLetter,
  createCsvReference,
  createPdfReference,
  createSourceDocument,
  createWorksheetReference,
  describeSourceReference,
  isSameLocation,
  toCostLibrarySourceReference,
} from '../../../src/core/models/index.ts';
import { BQ_CSV, BQ_XLSX, CLAIM_PDF, WORKING_XLS } from '../../helpers/synthetic/models.ts';

describe('column letters and cell addresses (as shown in Excel)', () => {
  it.each([
    [1, 'A'], [5, 'E'], [26, 'Z'], [27, 'AA'], [52, 'AZ'], [53, 'BA'], [702, 'ZZ'], [703, 'AAA'],
  ])('column %i is "%s"', (n, letters) => {
    expect(columnLetter(n)).toBe(letters);
  });

  it('row 14, column 5 is cell "E14"', () => {
    expect(cellAddress(14, 5)).toBe('E14');
  });

  it('rejects column 0 and row 0', () => {
    expect(() => columnLetter(0)).toThrow(SourceReferenceError);
    expect(() => cellAddress(0, 1)).toThrow(SourceReferenceError);
  });
});

describe('Excel worksheet references', () => {
  const ref = createWorksheetReference(BQ_XLSX, { sheetName: 'Bill 3', sheetIndex: 2, rowNumber: 214, columnNumber: 5 });

  it('records file name, document type, worksheet, row and cell', () => {
    expect(ref).toMatchObject({
      kind: 'worksheet',
      documentId: 'doc-bq-xlsx',
      fileName: 'SYNTHETIC_BQ.xlsx',
      documentType: 'standard_bq',
      sheetName: 'Bill 3',
      sheetIndex: 2,
      rowNumber: 214,
      columnNumber: 5,
      cellAddress: 'E214',
    });
  });

  it('gives the Cost Library\'s own sourceReference format exactly', () => {
    expect(toCostLibrarySourceReference(ref)).toBe('Sheet: Bill 3 | Row 214');
  });

  it('describes the reference in full, including the file name and cell', () => {
    expect(describeSourceReference(ref)).toBe('SYNTHETIC_BQ.xlsx | Sheet: Bill 3 | Row 214 | Cell E214');
  });

  it('keeps the worksheet name exactly as in the file (spaces are not trimmed)', () => {
    const odd = createWorksheetReference(BQ_XLSX, { sheetName: ' BILL NO.2 ', sheetIndex: 0, rowNumber: 1 });
    expect(odd.sheetName).toBe(' BILL NO.2 ');
  });

  it('works for old .xls files too', () => {
    const xls = createWorksheetReference(WORKING_XLS, { sheetName: 'Sheet1', sheetIndex: 0, rowNumber: 3 });
    expect(xls.documentType).toBe('contractor_working_file');
  });

  it('refuses impossible locations and the wrong kind of file', () => {
    expect(() => createWorksheetReference(BQ_XLSX, { sheetName: 'Bill 1', sheetIndex: 0, rowNumber: 0 })).toThrow(SourceReferenceError);
    expect(() => createWorksheetReference(BQ_XLSX, { sheetName: '', sheetIndex: 0, rowNumber: 1 })).toThrow(SourceReferenceError);
    expect(() => createWorksheetReference(CLAIM_PDF, { sheetName: 'Bill 1', sheetIndex: 0, rowNumber: 1 })).toThrow(SourceReferenceError);
  });
});

describe('CSV references', () => {
  it('records line and field number', () => {
    const ref = createCsvReference(BQ_CSV, { rowNumber: 12, columnNumber: 3 });
    expect(ref).toMatchObject({ kind: 'csv', rowNumber: 12, columnNumber: 3, cellAddress: 'C12', fileName: 'SYNTHETIC_BILL_2.csv' });
    expect(toCostLibrarySourceReference(ref)).toBe('Row 12');
  });

  it('refuses a CSV reference into an Excel file', () => {
    expect(() => createCsvReference(BQ_XLSX, { rowNumber: 1 })).toThrow(SourceReferenceError);
  });
});

describe('PDF references', () => {
  it('records page, line and position for a digital PDF', () => {
    const ref = createPdfReference(CLAIM_PDF, {
      pageNumber: 3, lineNumber: 14, extraction: 'text_layer',
      boundingBox: { x: 72, y: 300, width: 200, height: 12 },
    });
    expect(toCostLibrarySourceReference(ref)).toBe('Page 3 | Line 14');
    expect(describeSourceReference(ref)).toBe('SYNTHETIC_CLAIM_05.pdf | Page 3 | Line 14 | Position x=72 y=300 w=200 h=12 pt | PDF text');
  });

  it('records the OCR confidence for a scanned PDF', () => {
    const ref = createPdfReference(CLAIM_PDF, { pageNumber: 1, extraction: 'ocr', ocrConfidence: 87 });
    expect(ref.ocrConfidence).toBe(87);
    expect(describeSourceReference(ref)).toContain('OCR 87%');
  });

  it('refuses OCR confidence for PDF text, confidence above 100 and page 0', () => {
    expect(() => createPdfReference(CLAIM_PDF, { pageNumber: 1, extraction: 'text_layer', ocrConfidence: 90 })).toThrow(SourceReferenceError);
    expect(() => createPdfReference(CLAIM_PDF, { pageNumber: 1, extraction: 'ocr', ocrConfidence: 101 })).toThrow(SourceReferenceError);
    expect(() => createPdfReference(CLAIM_PDF, { pageNumber: 0, extraction: 'ocr' })).toThrow(SourceReferenceError);
  });
});

describe('references and documents are records that cannot be changed', () => {
  it('a reference is frozen', () => {
    const ref = createCsvReference(BQ_CSV, { rowNumber: 1 });
    expect(Object.isFrozen(ref)).toBe(true);
    expect(() => {
      (ref as { rowNumber: number }).rowNumber = 99;
    }).toThrow(TypeError);
  });

  it('two references to the same place are recognised as the same location', () => {
    const a = createCsvReference(BQ_CSV, { rowNumber: 4, columnNumber: 2 });
    const b = createCsvReference(BQ_CSV, { rowNumber: 4, columnNumber: 2 });
    const c = createCsvReference(BQ_CSV, { rowNumber: 5, columnNumber: 2 });
    expect(isSameLocation(a, b)).toBe(true);
    expect(isSameLocation(a, c)).toBe(false);
  });

  it('a source document needs a valid SHA-256 fingerprint', () => {
    expect(() => createSourceDocument({ ...BQ_XLSX, sha256: 'not-a-hash' })).toThrow(SourceReferenceError);
  });
});
