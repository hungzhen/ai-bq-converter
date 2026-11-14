/**
 * SYNTHETIC — NOT REAL COST DATA.
 *
 * Hand-built extracted tables for the verifier tests (no file is read — extraction is Stage 2F).
 *
 * Table "t-bill-1" = sheet "Bill 1" of SYNTHETIC_BQ.xlsx. Columns A No. | B Description | C Unit | D Qty | E Rate | F Amount.
 *   Excel row 1   header
 *   Excel row 9   heading   "SYNTHETIC SECTION A"
 *   Excel row 10  item A    m2, 10, 2, 20           (matches syntheticPricedRow)
 *   Excel row 11  item B    L.S., blank, blank, "RM 500.00"
 *   Excel row 12  item C    nr, 1, "(5.00)", "(5.00)"
 *   Excel row 13  item D    m, "1,25", 2, blank     (ambiguous quantity)
 *
 * Table "t-claim-p2" = page 2 of SYNTHETIC_CLAIM_05.pdf (PDF text), one claim line on line 20.
 */
import {
  type ExtractedCell,
  type ExtractedRow,
  type ExtractedTable,
  type RawValue,
  createPdfReference,
  createWorksheetReference,
} from '../../../src/core/models/index.ts';
import { BQ_XLSX, CLAIM_PDF } from './models.ts';

const sheetRef = (rowNumber: number, columnNumber?: number) =>
  createWorksheetReference(BQ_XLSX, { sheetName: 'Bill 1', sheetIndex: 0, rowNumber, ...(columnNumber !== undefined ? { columnNumber } : {}) });

function sheetRow(rowIndex: number, rowNumber: number, values: readonly (RawValue | undefined)[], display: Record<number, string> = {}): ExtractedRow {
  const cells: ExtractedCell[] = [];
  values.forEach((raw, c) => {
    if (raw === undefined) return; // cell not present
    cells.push({ columnIndex: c, raw, displayText: display[c] ?? null, source: sheetRef(rowNumber, c + 1) });
  });
  return { rowIndex, source: sheetRef(rowNumber), cells };
}

export const BILL_TABLE: ExtractedTable = {
  id: 't-bill-1',
  documentId: BQ_XLSX.id,
  origin: { kind: 'worksheet', sheetName: 'Bill 1', sheetIndex: 0 },
  rows: [
    sheetRow(0, 1, ['No.', 'Description', 'Unit', 'Qty', 'Rate', 'Amount']),
    sheetRow(1, 9, [null, 'SYNTHETIC SECTION A', null, null, null, null]),
    sheetRow(2, 10, ['A', 'SYNTHETIC TEST ITEM 001', 'm2', 10, 2, 20]),
    sheetRow(3, 11, ['B', 'SYNTHETIC TEST ITEM 002', 'L.S.', null, null, 'RM 500.00']),
    sheetRow(4, 12, ['C', 'SYNTHETIC TEST ITEM 003', 'nr', 1, '(5.00)', '(5.00)']),
    sheetRow(5, 13, ['D', 'SYNTHETIC TEST ITEM 004', 'm', '1,25', 2]), // amount cell not present
  ],
};

const claimRef = (lineNumber: number) => createPdfReference(CLAIM_PDF, { pageNumber: 2, lineNumber, extraction: 'text_layer' });
const claimCellRef = (lineNumber: number, x: number) =>
  createPdfReference(CLAIM_PDF, { pageNumber: 2, lineNumber, extraction: 'text_layer', boundingBox: { x, y: 400, width: 40, height: 10 } });

/** Claim columns by position: item, description, unit, prev qty, this qty, cum qty, prev amt, this amt, cum amt. */
export const CLAIM_X = [50, 90, 250, 300, 340, 380, 420, 470, 520] as const;

export const CLAIM_TABLE: ExtractedTable = {
  id: 't-claim-p2',
  documentId: CLAIM_PDF.id,
  origin: { kind: 'pdf_page', pageNumber: 2, extraction: 'text_layer' },
  rows: [
    {
      rowIndex: 0,
      source: claimRef(20),
      cells: ['A', 'SYNTHETIC CLAIM LINE 001', 'm2', '2', '3', '5', '4.00', '6.00', '10.00'].map((raw, c) => ({
        columnIndex: c,
        raw,
        displayText: null,
        source: claimCellRef(20, CLAIM_X[c]!),
      })),
    },
  ],
};

export const ALL_TABLES: readonly ExtractedTable[] = [BILL_TABLE, CLAIM_TABLE];

/** The cell reference used in the bill table for Excel (row, column). */
export const billCell = (rowNumber: number, columnNumber: number) => sheetRef(rowNumber, columnNumber);
export const claimCell = (column: number) => claimCellRef(20, CLAIM_X[column]!);
export const claimRow = () => claimRef(20);
