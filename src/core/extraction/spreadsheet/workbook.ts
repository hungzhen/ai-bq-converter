/**
 * EXCEL EXTRACTION (.xlsx and .xls) — reads every worksheet into ExtractedTables.
 *
 * What is kept for every cell present in the file:
 *   worksheet, cell address (B12), row and column number, the value exactly as stored (`raw`),
 *   its type, the text Excel shows (`displayText`), the number format, the formula and whether a
 *   cached result exists, merge information, and whether its row / column is hidden.
 *
 * What is NOT done here (later stages decide, and a person reviews):
 *   no column meanings, no row types, no Trade / Cost Item / Element, no calculations
 *   (formulas are never recalculated), no unit or description changes, no removal of notes,
 *   repeated headings, blank rows or duplicate rows, no joining of continuation lines.
 *
 * Positions are kept exactly: a table's row i is Excel row i + 1 and cell column j is Excel
 * column j + 1, from row 1 / column A, so blank rows and columns keep their place.
 * Hidden worksheets are extracted too, with their visibility recorded.
 */
import * as XLSX from 'xlsx';
import { frozenCopy } from '../../../lib/immutable.ts';
import type { RawValue } from '../../models/evidence.ts';
import type {
  ExtractedCell,
  ExtractedCellType,
  ExtractedRow,
  ExtractedTable,
  MergedRange,
  SheetVisibility,
} from '../../models/extraction.ts';
import { type DocumentIdentity, createWorksheetReference } from '../../models/source.ts';
import { ExtractionError, type ExtractionIssue } from '../issues.ts';

/** Information about one worksheet, in workbook order. */
export interface WorksheetInfo {
  /** 0 = first worksheet. */
  readonly index: number;
  /** Exactly as in the workbook. */
  readonly name: string;
  readonly visibility: SheetVisibility;
  /** The range the file declares (e.g. "A1:F40"), or null. */
  readonly declaredRange: string | null;
  /** The range that actually contains cells, or null for an empty sheet. */
  readonly usedRange: string | null;
  readonly rowCount: number;
  readonly columnCount: number;
  readonly cellCount: number;
  readonly formulaCount: number;
  readonly merges: readonly MergedRange[];
  /** Excel row numbers of hidden rows. */
  readonly hiddenRows: readonly number[];
  /** Excel column letters of hidden columns. */
  readonly hiddenColumns: readonly string[];
  readonly status: 'extracted' | 'empty' | 'failed';
  readonly tableId: string | null;
}

export interface WorkbookExtraction {
  readonly tables: readonly ExtractedTable[];
  readonly sheets: readonly WorksheetInfo[];
  readonly issues: readonly ExtractionIssue[];
}

/** SheetJS options: keep formulas, number formats, shown text, hidden rows/columns and empty-but-present cells. */
export const READ_OPTIONS: XLSX.ParsingOptions = {
  type: 'array',
  cellFormula: true,
  cellNF: true,
  cellText: true,
  cellStyles: true,
  sheetStubs: true,
  cellDates: false, // dates stay as the stored serial number; the date format is recorded
  dense: false,
};

/** Reads the workbook bytes with SheetJS, turning library errors into clear ExtractionErrors. */
export function readWorkbook(bytes: Uint8Array, fileName: string): XLSX.WorkBook {
  try {
    // A copy is given to the library so the original bytes can never be touched.
    return XLSX.read(bytes.slice(), READ_OPTIONS);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/password|encrypt/i.test(message)) {
      throw new ExtractionError('PASSWORD_PROTECTED', `"${fileName}" is password-protected. Remove the password in Excel (File → Info → Protect Workbook) and upload it again.`);
    }
    throw new ExtractionError('CORRUPTED_FILE', `"${fileName}" could not be read as an Excel workbook: ${message}`);
  }
}

const visibilityOf = (wb: XLSX.WorkBook, index: number): SheetVisibility => {
  const hidden = wb.Workbook?.Sheets?.[index]?.Hidden;
  return hidden === 2 ? 'very_hidden' : hidden === 1 ? 'hidden' : 'visible';
};

interface CellParts {
  raw: RawValue;
  cellType: ExtractedCellType;
  formulaResultMissing: boolean;
}

/** The stored value and type of a SheetJS cell. Never calculated, never taken from the shown text. */
function storedValue(cell: XLSX.CellObject): CellParts {
  const hasFormula = typeof cell.f === 'string' && cell.f !== '';
  if (hasFormula && cell.v === undefined) return { raw: null, cellType: 'empty', formulaResultMissing: true };
  switch (cell.t) {
    case 'n':
      return { raw: cell.v as number, cellType: 'number', formulaResultMissing: false };
    case 's':
      return { raw: cell.v as string, cellType: 'text', formulaResultMissing: false };
    case 'b':
      return { raw: cell.v as boolean, cellType: 'boolean', formulaResultMissing: false };
    case 'e':
      return { raw: cell.w ?? XLSX.utils.format_cell(cell) ?? '#ERROR', cellType: 'error', formulaResultMissing: false };
    case 'd':
      // Not produced with cellDates: false; kept as text rather than guessed at.
      return { raw: String(cell.v), cellType: 'text', formulaResultMissing: false };
    case 'z':
    default:
      return { raw: null, cellType: 'empty', formulaResultMissing: false };
  }
}

const isBlankRaw = (raw: RawValue) => raw === null || (typeof raw === 'string' && raw.trim() === '');

function toMergedRange(r: XLSX.Range): MergedRange {
  return {
    range: XLSX.utils.encode_range(r),
    startRowNumber: r.s.r + 1,
    startColumnNumber: r.s.c + 1,
    endRowNumber: r.e.r + 1,
    endColumnNumber: r.e.c + 1,
  };
}

const overlaps = (a: XLSX.Range, b: XLSX.Range) => !(a.e.r < b.s.r || b.e.r < a.s.r || a.e.c < b.s.c || b.e.c < a.s.c);

/**
 * Extracts one worksheet. Throws on an unexpected problem; the caller records it as a failed
 * sheet and carries on with the others.
 */
export function extractWorksheet(
  ws: XLSX.WorkSheet,
  sheet: { name: string; index: number; visibility: SheetVisibility },
  document: DocumentIdentity,
): { table: ExtractedTable; info: WorksheetInfo; issues: ExtractionIssue[] } {
  const issues: ExtractionIssue[] = [];
  const tableId = `${document.id}:sheet:${sheet.index}`;
  const sheetName = sheet.name;
  const declaredRange = typeof ws['!ref'] === 'string' ? ws['!ref'] : null;
  if (declaredRange !== null) {
    const r = XLSX.utils.decode_range(declaredRange);
    if (![r.s.r, r.s.c, r.e.r, r.e.c].every((n) => Number.isInteger(n) && n >= 0)) {
      throw new Error(`the worksheet's declared range "${declaredRange}" is invalid`);
    }
  }

  // --- Merges -------------------------------------------------------------------------------
  const rawMerges = (ws['!merges'] ?? []) as XLSX.Range[];
  const merges = rawMerges.map(toMergedRange);
  for (let i = 0; i < rawMerges.length; i++) {
    for (let j = i + 1; j < rawMerges.length; j++) {
      if (overlaps(rawMerges[i]!, rawMerges[j]!)) {
        issues.push({ code: 'OVERLAPPING_MERGES', severity: 'warning', sheetName, message: `Merged ranges ${merges[i]!.range} and ${merges[j]!.range} overlap in "${sheetName}".` });
      }
    }
  }
  const mergeAt = (r: number, c: number) => rawMerges.findIndex((m) => r >= m.s.r && r <= m.e.r && c >= m.s.c && c <= m.e.c);

  // --- Hidden rows and columns ---------------------------------------------------------------
  const rowProps = (ws['!rows'] ?? []) as (XLSX.RowInfo | undefined)[];
  const colProps = (ws['!cols'] ?? []) as (XLSX.ColInfo | undefined)[];
  const hiddenRowSet = new Set<number>();
  rowProps.forEach((p, r) => p?.hidden && hiddenRowSet.add(r));
  const hiddenColSet = new Set<number>();
  colProps.forEach((p, c) => p?.hidden && hiddenColSet.add(c));

  // --- Cells ----------------------------------------------------------------------------------
  const addresses = Object.keys(ws).filter((k) => !k.startsWith('!'));
  const cellsByRow = new Map<number, ExtractedCell[]>();
  let lastRow = -1;
  let lastCol = -1;
  let formulaCount = 0;

  for (const address of addresses) {
    try {
      // Only proper Excel addresses (letters, then a row number from 1) that convert back to the
      // same text are accepted — the library would otherwise place odd keys at a guessed position.
      const pos = /^[A-Z]{1,3}[1-9]\d*$/.test(address) ? XLSX.utils.decode_cell(address) : { r: -1, c: -1 };
      if (!Number.isInteger(pos.r) || !Number.isInteger(pos.c) || pos.r < 0 || pos.c < 0 || XLSX.utils.encode_cell(pos) !== address) {
        throw new Error(`invalid cell address "${address}"`);
      }
      const cell = ws[address] as XLSX.CellObject;
      const parts = storedValue(cell);
      const formula = typeof cell.f === 'string' && cell.f !== '' ? cell.f : undefined;
      const numberFormat = typeof cell.z === 'string' ? cell.z : null;
      const isDate = cell.t === 'n' && numberFormat !== null && XLSX.SSF.is_date(numberFormat);
      const mergeIndex = mergeAt(pos.r, pos.c);
      const merge = mergeIndex >= 0 ? rawMerges[mergeIndex]! : undefined;
      const isOrigin = merge !== undefined && merge.s.r === pos.r && merge.s.c === pos.c;
      const excelAddress = XLSX.utils.encode_cell(pos);

      const extracted: ExtractedCell = {
        columnIndex: pos.c,
        raw: parts.raw,
        displayText: typeof cell.w === 'string' ? cell.w : null,
        source: createWorksheetReference(document, { sheetName, sheetIndex: sheet.index, rowNumber: pos.r + 1, columnNumber: pos.c + 1 }),
        cellType: parts.cellType,
        numberFormat,
        ...(isDate ? { isDateFormatted: true } : {}),
        ...(formula !== undefined ? { isFormula: true, formula } : {}),
        ...(parts.formulaResultMissing ? { formulaResultMissing: true } : {}),
        ...(merge ? { isMerged: true, mergedRange: XLSX.utils.encode_range(merge), isMergeOrigin: isOrigin } : {}),
        ...(hiddenColSet.has(pos.c) ? { isHidden: true } : {}),
      };

      if (formula !== undefined) formulaCount++;
      if (parts.formulaResultMissing) {
        issues.push({ code: 'FORMULA_RESULT_MISSING', severity: 'warning', sheetName, cellAddress: excelAddress, message: `${sheetName}!${excelAddress} has the formula "=${formula}" but the file holds no calculated result. No value is assumed.` });
      }
      if (parts.cellType === 'error') {
        issues.push({ code: 'CELL_ERROR_VALUE', severity: 'warning', sheetName, cellAddress: excelAddress, message: `${sheetName}!${excelAddress} shows the Excel error ${String(parts.raw)}.` });
      }
      if (merge && !isOrigin && !isBlankRaw(parts.raw)) {
        issues.push({ code: 'MERGED_CELL_HIDES_VALUE', severity: 'warning', sheetName, cellAddress: excelAddress, message: `${sheetName}!${excelAddress} holds ${JSON.stringify(parts.raw)} but is covered by the merged range ${XLSX.utils.encode_range(merge)}, so Excel does not show it. It is kept.` });
      }
      if (isDate) {
        issues.push({ code: 'DATE_FORMATTED_NUMBER', severity: 'info', sheetName, cellAddress: excelAddress, message: `${sheetName}!${excelAddress} is a date (stored as ${String(parts.raw)}, shown as "${cell.w ?? ''}").` });
      }

      const list = cellsByRow.get(pos.r) ?? [];
      list.push(extracted);
      cellsByRow.set(pos.r, list);
      lastRow = Math.max(lastRow, pos.r);
      lastCol = Math.max(lastCol, pos.c);
    } catch (error) {
      issues.push({
        code: 'CELL_EXTRACTION_FAILED', severity: 'error', sheetName, cellAddress: address,
        message: `${sheetName}!${address} could not be read: ${error instanceof Error ? error.message : String(error)}. It is not in the extracted table.`,
      });
    }
  }
  for (const m of rawMerges) {
    lastRow = Math.max(lastRow, m.e.r);
    lastCol = Math.max(lastCol, m.e.c);
  }

  // --- Rows, from Excel row 1, keeping blank rows in place -------------------------------------
  const rows: ExtractedRow[] = [];
  for (let r = 0; r <= lastRow; r++) {
    const cells = (cellsByRow.get(r) ?? []).sort((a, b) => a.columnIndex - b.columnIndex);
    rows.push({
      rowIndex: r,
      source: createWorksheetReference(document, { sheetName, sheetIndex: sheet.index, rowNumber: r + 1 }),
      cells,
      ...(hiddenRowSet.has(r) ? { isHidden: true } : {}),
    });
  }

  const cellCount = [...cellsByRow.values()].reduce((n, list) => n + list.length, 0);
  const usedRange = lastRow >= 0 && lastCol >= 0 ? `A1:${XLSX.utils.encode_cell({ r: lastRow, c: lastCol })}` : null;
  const hiddenRows = [...hiddenRowSet].sort((a, b) => a - b).map((r) => r + 1);
  const hiddenColumns = [...hiddenColSet].sort((a, b) => a - b).map((c) => XLSX.utils.encode_col(c));

  // --- Worksheet-level notes ---------------------------------------------------------------------
  if (sheet.visibility === 'hidden') issues.push({ code: 'HIDDEN_WORKSHEET', severity: 'info', sheetName, message: `Worksheet "${sheetName}" is hidden. It has been extracted; it may hold supporting BQ information.` });
  if (sheet.visibility === 'very_hidden') issues.push({ code: 'VERY_HIDDEN_WORKSHEET', severity: 'warning', sheetName, message: `Worksheet "${sheetName}" is "very hidden" (cannot be unhidden from Excel's menu). It has been extracted.` });
  if (hiddenRows.length) issues.push({ code: 'HIDDEN_ROWS', severity: 'info', sheetName, message: `"${sheetName}" has hidden rows: ${hiddenRows.join(', ')}. They have been extracted and marked as hidden.` });
  if (hiddenColumns.length) issues.push({ code: 'HIDDEN_COLUMNS', severity: 'info', sheetName, message: `"${sheetName}" has hidden columns: ${hiddenColumns.join(', ')}. They have been extracted and marked as hidden.` });
  if (formulaCount) issues.push({ code: 'FORMULA_CELLS', severity: 'info', sheetName, message: `"${sheetName}" has ${formulaCount} formula cell(s). Their cached results are kept; formulas are not recalculated.` });
  if (cellCount === 0) issues.push({ code: 'EMPTY_WORKSHEET', severity: 'warning', sheetName, message: `Worksheet "${sheetName}" is empty.` });
  if (declaredRange !== null && usedRange !== null) {
    const d = XLSX.utils.decode_range(declaredRange);
    if (d.e.r !== lastRow || d.e.c !== lastCol || d.s.r !== 0 || d.s.c !== 0) {
      issues.push({ code: 'DECLARED_RANGE_DIFFERS', severity: 'info', sheetName, message: `"${sheetName}" declares the range ${declaredRange}; cells were found in ${usedRange}. All cells found are extracted.` });
    }
  }

  const table: ExtractedTable = {
    id: tableId,
    documentId: document.id,
    origin: { kind: 'worksheet', sheetName, sheetIndex: sheet.index, visibility: sheet.visibility },
    rows,
    merges,
  };
  const info: WorksheetInfo = {
    index: sheet.index,
    name: sheetName,
    visibility: sheet.visibility,
    declaredRange,
    usedRange,
    rowCount: rows.length,
    columnCount: lastCol + 1,
    cellCount,
    formulaCount,
    merges,
    hiddenRows,
    hiddenColumns,
    status: cellCount === 0 ? 'empty' : 'extracted',
    tableId,
  };
  return { table, info, issues };
}

/** Extracts every worksheet of an already-read workbook, in workbook order. */
export function extractWorkbookObject(wb: XLSX.WorkBook, document: DocumentIdentity): WorkbookExtraction {
  if (!wb.SheetNames || wb.SheetNames.length === 0) {
    throw new ExtractionError('EMPTY_WORKBOOK', `"${document.fileName}" contains no worksheets.`);
  }
  const tables: ExtractedTable[] = [];
  const sheets: WorksheetInfo[] = [];
  const issues: ExtractionIssue[] = [];

  wb.SheetNames.forEach((name, index) => {
    const visibility = visibilityOf(wb, index);
    try {
      const ws = wb.Sheets[name];
      if (!ws) throw new Error('the worksheet data is missing from the file');
      const result = extractWorksheet(ws, { name, index, visibility }, document);
      tables.push(result.table);
      sheets.push(result.info);
      issues.push(...result.issues);
    } catch (error) {
      sheets.push({
        index, name, visibility, declaredRange: null, usedRange: null, rowCount: 0, columnCount: 0, cellCount: 0, formulaCount: 0,
        merges: [], hiddenRows: [], hiddenColumns: [], status: 'failed', tableId: null,
      });
      issues.push({
        code: 'SHEET_EXTRACTION_FAILED', severity: 'error', sheetName: name,
        message: `Worksheet "${name}" could not be extracted: ${error instanceof Error ? error.message : String(error)}. The other worksheets were extracted.`,
      });
    }
  });

  if (sheets.every((s) => s.status === 'empty')) {
    issues.push({ code: 'EMPTY_WORKBOOK', severity: 'warning', message: `Every worksheet in "${document.fileName}" is empty.` });
  }
  return frozenCopy({ tables, sheets, issues });
}
