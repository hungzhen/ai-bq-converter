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

export interface ExtractedCell {
  /** 0-based position of the cell in its row. */
  readonly columnIndex: number;
  /** The value exactly as stored in the file (number, text, boolean); null = empty cell. */
  readonly raw: RawValue;
  /** The text the file shows for the cell (e.g. "RM 1,250.00", "5%"), when known. */
  readonly displayText: string | null;
  readonly source: SourceReference;
  readonly isFormula?: boolean;
  readonly isMerged?: boolean;
  readonly isHidden?: boolean;
}

export interface ExtractedRow {
  /** 0-based position of the row in its table. */
  readonly rowIndex: number;
  readonly source: SourceReference;
  /** Cells present in the row. A cell that is not present at all is "missing". */
  readonly cells: readonly ExtractedCell[];
  readonly isHidden?: boolean;
}

export type TableOrigin =
  | { readonly kind: 'worksheet'; readonly sheetName: string; readonly sheetIndex: number }
  | { readonly kind: 'csv' }
  | { readonly kind: 'pdf_page'; readonly pageNumber: number; readonly extraction: 'text_layer' | 'ocr' };

export interface ExtractedTable {
  readonly id: string;
  readonly documentId: string;
  readonly origin: TableOrigin;
  readonly rows: readonly ExtractedRow[];
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

/** The text of a cell as a person reads it: the shown text when known, otherwise the stored value. */
export function cellText(cell: ExtractedCell): string {
  if (cell.displayText !== null) return cell.displayText;
  return cell.raw === null ? '' : String(cell.raw);
}
