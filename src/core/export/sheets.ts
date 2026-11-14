/**
 * Writing workbooks cell by cell, with every cell's type under the converter's control:
 *   text   → a text cell ("s"), never a formula — even when it starts with "=", "+", "-" or "@"
 *            (source text is untrusted: a description can look like a formula)
 *   number → a number cell ("n")
 *   null   → NO cell at all: a genuinely blank cell, never 0 or an empty string
 * No formulas are ever written. SheetJS 0.20.3 (D-003).
 */
import * as XLSX from 'xlsx';

export type Cell = string | number | null;

/** Excel's limit for the text of one cell. */
const MAX_TEXT = 32767;

export class WorkbookWriteError extends Error {
  override name = 'WorkbookWriteError';
}

export function sheetFrom(rows: readonly (readonly Cell[])[], widths?: readonly number[]): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  let maxCol = 0;
  rows.forEach((row, r) => {
    row.forEach((value, c) => {
      if (value === null) return;
      const address = XLSX.utils.encode_cell({ r, c });
      if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new WorkbookWriteError(`Cell ${address}: ${value} is not a finite number.`);
        ws[address] = { t: 'n', v: value };
      } else {
        if (value.length > MAX_TEXT) throw new WorkbookWriteError(`Cell ${address}: the text is longer than Excel allows (${MAX_TEXT} characters).`);
        ws[address] = { t: 's', v: value };
      }
      maxCol = Math.max(maxCol, c);
    });
  });
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length - 1, 0), c: maxCol } });
  if (widths) ws['!cols'] = widths.map((wch) => ({ wch }));
  return ws;
}

export function writeWorkbook(sheets: readonly { name: string; rows: readonly (readonly Cell[])[]; widths?: readonly number[] }[], props: { title: string; subject: string; comments: string }): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, sheetFrom(s.rows, s.widths), s.name);
  wb.Props = { Title: props.title, Subject: props.subject, Comments: props.comments };
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}
