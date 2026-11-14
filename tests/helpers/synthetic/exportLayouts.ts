/**
 * SYNTHETIC — NOT REAL COST DATA.
 * A synthetic BQ whose texts look like spreadsheet formulas (untrusted source text), an item
 * number written as text "1.10".
 */
import * as XLSX from 'xlsx';

const HEADER = ['No.', 'Description', 'Unit', 'Qty', 'Rate (RM)', 'Amount (RM)'];

export const FORMULA_LIKE = ['=HYPERLINK("http://example.invalid","SYNTHETIC")', '+SUM(1,1) SYNTHETIC', '-2+3 SYNTHETIC', '@SYNTHETIC command'];

export function formulaTextBq(): Uint8Array {
  const rows: (string | number | null)[][] = [
    ['BILL NO. 7 – SYNTHETIC (NOT REAL COST DATA)'],
    HEADER,
    ['1.10', FORMULA_LIKE[0]!, 'm', 2, 10, 20],
    ['=1+1', FORMULA_LIKE[1]!, 'm2', 3, 10, 30],
    ['C', FORMULA_LIKE[2]!, 'nr', 4, 10, 40],
    ['D', FORMULA_LIKE[3]!, 'item', 5, 10, 50],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Bill 7');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
}
