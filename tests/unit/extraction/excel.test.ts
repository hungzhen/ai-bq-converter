/**
 * Stage 2F — Excel extraction (.xlsx and .xls). Every file is SYNTHETIC — NOT REAL COST DATA.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { ExtractedCell, ExtractedTable } from '../../../src/core/models/index.ts';
import type { ExtractionResult } from '../../../src/core/extraction/index.ts';
import {
  BILL_SHEET,
  RM_FORMAT,
  UNUSUAL_SHEET,
  extract,
  syntheticBqXls,
  syntheticBqXlsx,
  xlsxWithEmptyStyledCell,
} from '../../helpers/synthetic/spreadsheets.ts';

const sheetTable = (r: ExtractionResult, name: string): ExtractedTable =>
  r.tables.find((t) => t.origin.kind === 'worksheet' && t.origin.sheetName === name)!;
/** The cell at an Excel address such as "F5", or undefined when absent. */
function cellAt(table: ExtractedTable, address: string): ExtractedCell | undefined {
  for (const row of table.rows) for (const c of row.cells) if (c.source.kind === 'worksheet' && c.source.cellAddress === address) return c;
  return undefined;
}
const codes = (r: ExtractionResult) => r.issues.map((i) => i.code);

describe.each([
  ['XLSX', 'SYNTHETIC_BQ.xlsx', syntheticBqXlsx, 'xlsx'],
  ['XLS', 'SYNTHETIC_BQ.xls', syntheticBqXls, 'xls'],
] as const)('%s workbook', (_label, fileName, build, format) => {
  let r: ExtractionResult;
  let bill: ExtractedTable;
  beforeAll(async () => {
    r = await extract(build(), fileName);
    bill = sheetTable(r, BILL_SHEET);
  });

  describe('workbook and worksheets', () => {
    it('reads every worksheet, in the original order, with the exact names', () => {
      expect(r.format).toBe(format);
      expect(r.sheets.map((s) => s.name)).toEqual(['Cover', BILL_SHEET, UNUSUAL_SHEET, 'Rates build-up', 'Locked', 'Empty']);
      expect(r.sheets.map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5]);
    });

    it('keeps hidden and very hidden worksheets, with their visibility', () => {
      expect(r.sheets.map((s) => s.visibility)).toEqual(['visible', 'visible', 'visible', 'hidden', 'very_hidden', 'visible']);
      expect(sheetTable(r, 'Rates build-up').rows[0]!.cells[0]!.raw).toBe('SYNTHETIC BUILD-UP');
      expect(sheetTable(r, 'Locked').origin).toMatchObject({ visibility: 'very_hidden' });
      expect(codes(r)).toEqual(expect.arrayContaining(['HIDDEN_WORKSHEET', 'VERY_HIDDEN_WORKSHEET']));
    });

    it('handles unusual worksheet names (apostrophe, brackets, #, dash, Malay text)', () => {
      const t = sheetTable(r, UNUSUAL_SHEET);
      expect(t.rows[0]!.cells[0]!.raw).toBe('Kerja tanah – Bil 3 (ujian sintetik)');
      expect(t.rows[0]!.cells[0]!.source).toMatchObject({ sheetName: UNUSUAL_SHEET, cellAddress: 'A1' });
    });

    it('reports an empty worksheet instead of dropping it', () => {
      const empty = r.sheets.find((s) => s.name === 'Empty')!;
      expect(empty.status).toBe('empty');
      expect(sheetTable(r, 'Empty').rows).toEqual([]);
      expect(r.issues.find((i) => i.code === 'EMPTY_WORKSHEET')?.sheetName).toBe('Empty');
    });

    it('sets the document type to "unknown" — extraction does not classify documents', () => {
      expect(r.document.documentType).toBe('unknown');
      expect(r.document.format).toBe(format);
      expect(r.document.sha256).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('positions and source references', () => {
    it('keeps every position: table row i is Excel row i + 1, from row 1', () => {
      bill.rows.forEach((row, i) => {
        expect(row.rowIndex).toBe(i);
        expect(row.source).toMatchObject({ kind: 'worksheet', rowNumber: i + 1 });
        for (const c of row.cells) expect(c.source).toMatchObject({ rowNumber: i + 1, columnNumber: c.columnIndex + 1 });
      });
    });

    it('keeps blank rows in place (row 2 is empty but still row 2)', () => {
      expect(bill.rows[1]!.cells).toEqual([]);
      expect(bill.rows[2]!.source).toMatchObject({ rowNumber: 3 });
    });

    it('gives each cell its file, worksheet, address, row and column', () => {
      expect(cellAt(bill, 'E7')!.source).toEqual({
        kind: 'worksheet', documentId: 'doc-extract', fileName, documentType: 'unknown',
        sheetName: BILL_SHEET, sheetIndex: 1, rowNumber: 7, columnNumber: 5, cellAddress: 'E7',
      });
    });
  });

  describe('original values are kept, never replaced by the shown text', () => {
    it('numbers keep the stored value, the shown text and the number format separately', () => {
      expect(cellAt(bill, 'D5')).toMatchObject({ raw: 10, displayText: '10.00', numberFormat: '#,##0.00', cellType: 'number' });
      expect(cellAt(bill, 'E5')).toMatchObject({ raw: 25.5, displayText: '25.50' });
    });

    it('Malaysian RM values: raw number kept; "RM 500.00" is only the shown text', () => {
      expect(cellAt(bill, 'F6')).toMatchObject({ raw: 500, displayText: 'RM 500.00', numberFormat: RM_FORMAT });
    });

    it('negative numbers shown in brackets keep their negative raw value', () => {
      expect(cellAt(bill, 'E7')).toMatchObject({ raw: -12.5, displayText: '(RM 12.50)' });
    });

    it('a percentage cell keeps 0.05 as raw and "5%" as shown text', () => {
      expect(cellAt(bill, 'E11')).toMatchObject({ raw: 0.05, displayText: '5%', numberFormat: '0%' });
    });

    it('a date keeps its stored serial number and is marked as date-formatted', () => {
      expect(cellAt(bill, 'D12')).toMatchObject({ raw: 36526, isDateFormatted: true, numberFormat: 'd/m/yyyy' });
    });

    it('text keeps commas, dashes and leading / trailing spaces exactly', () => {
      expect(cellAt(bill, 'B5')!.raw).toBe('SYNTHETIC ITEM 001, depth not exceeding 1.50m');
      expect(cellAt(bill, 'B14')!.raw).toBe('  SYNTHETIC TEXT WITH SPACES  ');
      expect(cellAt(bill, 'C6')!.raw).toBe('L.S.'); // unit text unchanged
    });

    it('an Excel error is kept as its error text and reported', () => {
      expect(cellAt(bill, 'F13')).toMatchObject({ raw: '#DIV/0!', cellType: 'error' });
      expect(r.issues.find((i) => i.code === 'CELL_ERROR_VALUE')?.cellAddress).toBe('F13');
    });
  });

  describe('merged cells', () => {
    it('records the merged ranges of each worksheet', () => {
      expect(bill.merges?.map((m) => m.range)).toEqual(['A1:F1', 'B4:F4']);
      expect(bill.merges?.[1]).toMatchObject({ startRowNumber: 4, startColumnNumber: 2, endRowNumber: 4, endColumnNumber: 6 });
    });

    it('marks the merge origin and the covered cells', () => {
      expect(cellAt(bill, 'B4')).toMatchObject({ isMerged: true, mergedRange: 'B4:F4', isMergeOrigin: true });
      expect(cellAt(bill, 'C4')).toMatchObject({ isMerged: true, mergedRange: 'B4:F4', isMergeOrigin: false, raw: 'covered text' });
    });

    it('warns about a value hidden under a merged range, and keeps it', () => {
      expect(r.issues.find((i) => i.code === 'MERGED_CELL_HIDES_VALUE')).toMatchObject({ sheetName: BILL_SHEET, cellAddress: 'C4' });
    });
  });

  describe('hidden columns', () => {
    it('extracts and marks cells in hidden columns', () => {
      expect(cellAt(bill, 'G5')).toMatchObject({ raw: 'SYNTHETIC INTERNAL NOTE (hidden column)', isHidden: true });
      expect(r.sheets.find((s) => s.name === BILL_SHEET)!.hiddenColumns).toEqual(['G']);
    });
  });

  describe('nothing is interpreted, removed or combined', () => {
    it('keeps the page-total line, notes and the duplicate row', () => {
      expect(cellAt(bill, 'B9')!.raw).toBe('Carried to Collection');
      expect(cellAt(bill, 'B8')!.raw).toBe('SYNTHETIC HIDDEN NOTE');
      expect(cellAt(bill, 'B10')!.raw).toBe(cellAt(bill, 'B5')!.raw);
    });

    it('adds no column meanings, row types or classifications', () => {
      const keys = new Set<string>();
      for (const t of r.tables) {
        Object.keys(t).forEach((k) => keys.add(k));
        for (const row of t.rows) {
          Object.keys(row).forEach((k) => keys.add(k));
          for (const c of row.cells) Object.keys(c).forEach((k) => keys.add(k));
        }
      }
      for (const k of ['role', 'rowClass', 'tradeWork', 'costItem', 'element', 'quantity', 'rate', 'amount', 'unit', 'description']) expect(keys.has(k)).toBe(false);
    });
  });
});

describe('XLSX only: formulas and hidden rows', () => {
  let r: ExtractionResult;
  let bill: ExtractedTable;
  beforeAll(async () => {
    r = await extract(syntheticBqXlsx(), 'SYNTHETIC_BQ.xlsx');
    bill = sheetTable(r, BILL_SHEET);
  });

  it('keeps the formula and its cached result — not recalculated', () => {
    expect(cellAt(bill, 'F5')).toMatchObject({ isFormula: true, formula: 'D5*E5', raw: 255, displayText: 'RM 255.00' });
    expect(cellAt(bill, 'F9')).toMatchObject({ isFormula: true, formula: 'SUM(F5:F7)', raw: 742.5 });
  });

  it('records a formula with no cached result as such, with no value invented', () => {
    expect(cellAt(bill, 'F7')).toMatchObject({ isFormula: true, formula: 'D7*E7', formulaResultMissing: true, raw: null, cellType: 'empty' });
    expect(r.issues.find((i) => i.code === 'FORMULA_RESULT_MISSING')).toMatchObject({ cellAddress: 'F7' });
    expect(r.sheets.find((s) => s.name === BILL_SHEET)!.formulaCount).toBe(3);
  });

  it('extracts and marks hidden rows', () => {
    expect(bill.rows[7]).toMatchObject({ isHidden: true });
    expect(bill.rows[7]!.cells[0]!.raw).toBe('SYNTHETIC HIDDEN NOTE');
    expect(r.sheets.find((s) => s.name === BILL_SHEET)!.hiddenRows).toEqual([8]);
  });
});

describe('blank versus absent cells', () => {
  it('XLSX: a present-but-empty cell is kept (raw null, type "empty"); an absent cell is not in the table', async () => {
    const r = await extract(xlsxWithEmptyStyledCell(), 'SYNTHETIC_EMPTY_CELL.xlsx');
    const t = r.tables[0]!;
    expect(cellAt(t, 'C2')).toMatchObject({ raw: null, cellType: 'empty' });
    expect(cellAt(t, 'C1')).toBeUndefined();
    expect(codes(r)).toContain('DECLARED_RANGE_DIFFERS'); // C2 lies outside the declared A1:B2 and is still extracted
  });

  it('XLS: a present-but-empty cell is kept; an absent one is not', async () => {
    const r = await extract(syntheticBqXls(), 'SYNTHETIC_BQ.xls');
    const bill = sheetTable(r, BILL_SHEET);
    expect(cellAt(bill, 'C9')).toMatchObject({ raw: null, cellType: 'empty' });
    expect(cellAt(bill, 'D9')).toBeUndefined();
  });
});
