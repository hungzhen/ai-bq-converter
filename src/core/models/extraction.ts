/**
 * EXTRACTED TABLE — the common shape every file type is read into (data shape only).
 *
 * Reading files into this shape is Stage 2F (spreadsheets) and later phases (PDF, OCR).
 * Stage 2E defines the shape so that:
 *   - providers can be given tables to interpret, and cite cells as evidence (CellRef);
 *   - the evidence verifier can look up the ORIGINAL cell and check nothing was altered.
 *
 * A table is one worksheet, one CSV file, or one PDF page. Rows and columns are counted
 * from 0 inside the table (rowIndex / columnIndex); each row and cell also carries its
 * SourceReference with the numbers people see (Excel row 14, column E, page 3 …).
 */
import type { RawValue } from './evidence.ts';
import { type SourceReference, isSameLocation } from './source.ts';

/**
 * What kind of value the file stores in the cell (for a formula: the kind of its cached result).
 *   number / text / boolean   a stored value
 *   error                     an Excel error such as #DIV/0! (raw = the error text)
 *   empty                     the cell is present in the file but holds no value (raw = null)
 */
export type ExtractedCellType = 'number' | 'text' | 'boolean' | 'error' | 'empty';

export interface ExtractedCell {
  /** 0-based position of the cell in its row (= Excel column number − 1). */
  readonly columnIndex: number;
  /**
   * The value exactly as stored in the file (number, text, boolean); null = present but empty.
   * For a formula this is the result CACHED in the file — never recalculated — or null when the
   * file has no cached result (see `formulaResultMissing`). For an Excel error, the error text.
   */
  readonly raw: RawValue;
  /** The text the file shows for the cell (e.g. "RM 1,250.00", "5%"), when known. Never replaces `raw`. */
  readonly displayText: string | null;
  readonly source: SourceReference;
  readonly cellType?: ExtractedCellType;
  /** Excel number format, e.g. '#,##0.00' or '"RM" #,##0.00;("RM" #,##0.00)'. */
  readonly numberFormat?: string | null;
  /** True when the number format is a date format (the raw value is an Excel date serial number). */
  readonly isDateFormatted?: boolean;
  readonly isFormula?: boolean;
  /** The formula exactly as stored, without "=", e.g. "D10*E10". */
  readonly formula?: string;
  /** True when the cell has a formula but the file holds no cached result. Nothing is calculated. */
  readonly formulaResultMissing?: boolean;
  /** Merged range this cell belongs to, e.g. "B2:F2". */
  readonly mergedRange?: string;
  /** True for the top-left cell of its merged range (the one Excel shows). */
  readonly isMergeOrigin?: boolean;
  readonly isMerged?: boolean;
  /** True when the cell's column is hidden. */
  readonly isHidden?: boolean;
}

export interface ExtractedRow {
  /** 0-based position of the row in its table (= Excel row number − 1 / CSV record number − 1). */
  readonly rowIndex: number;
  readonly source: SourceReference;
  /** Cells present in the row. A cell that is not present at all is "missing". */
  readonly cells: readonly ExtractedCell[];
  readonly isHidden?: boolean;
}

export type SheetVisibility = 'visible' | 'hidden' | 'very_hidden';

export type TableOrigin =
  | { readonly kind: 'worksheet'; readonly sheetName: string; readonly sheetIndex: number; readonly visibility: SheetVisibility }
  | { readonly kind: 'csv' }
  | { readonly kind: 'pdf_page'; readonly pageNumber: number; readonly extraction: 'text_layer' | 'ocr' };

/** A merged range, e.g. B2:F2, with Excel row / column numbers (1-based). */
export interface MergedRange {
  readonly range: string;
  readonly startRowNumber: number;
  readonly startColumnNumber: number;
  readonly endRowNumber: number;
  readonly endColumnNumber: number;
}

export interface ExtractedTable {
  readonly id: string;
  readonly documentId: string;
  readonly origin: TableOrigin;
  readonly rows: readonly ExtractedRow[];
  readonly merges?: readonly MergedRange[];
}

/** Cites a cell (or a whole row, when columnIndex is omitted) of an extracted table. */
export interface CellRef {
  readonly tableId: string;
  readonly rowIndex: number;
  readonly columnIndex?: number;
}

export function findTable(tables: readonly ExtractedTable[], tableId: string): ExtractedTable | undefined {
  return tables.find((t) => t.id === tableId);
}

export function findRow(table: ExtractedTable, rowIndex: number): ExtractedRow | undefined {
  return table.rows.find((r) => r.rowIndex === rowIndex);
}

export function findCell(row: ExtractedRow, columnIndex: number): ExtractedCell | undefined {
  return row.cells.find((c) => c.columnIndex === columnIndex);
}

/** The cell a SourceReference points to, if it exists in the given tables. */
export function findCellBySource(tables: readonly ExtractedTable[], ref: SourceReference): ExtractedCell | undefined {
  for (const table of tables) {
    if (table.documentId !== ref.documentId) continue;
    for (const row of table.rows) {
      const cell = row.cells.find((c) => isSameLocation(c.source, ref));
      if (cell) return cell;
    }
  }
  return undefined;
}

/** The row a row-level SourceReference points to, if it exists in the given tables. */
export function findRowBySource(tables: readonly ExtractedTable[], ref: SourceReference): ExtractedRow | undefined {
  for (const table of tables) {
    if (table.documentId !== ref.documentId) continue;
    const row = table.rows.find((r) => isSameLocation(r.source, ref));
    if (row) return row;
  }
  return undefined;
}

/**
 * The value to give the parser for a cell. A formula cell with no cached result gives `undefined`,
 * so the parser records it as "missing" (never "blank" or zero). The verifier enforces this.
 */
export function cellValueForParsing(cell: ExtractedCell): RawValue | undefined {
  return cell.formulaResultMissing ? undefined : cell.raw;
}

/** The text of a cell as a person reads it: the shown text when known, otherwise the stored value. */
export function cellText(cell: ExtractedCell): string {
  if (cell.displayText !== null) return cell.displayText;
  return cell.raw === null ? '' : String(cell.raw);
}
