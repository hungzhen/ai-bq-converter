/**
 * SYNTHETIC — NOT REAL COST DATA.
 *
 * A synthetic BQ for the Stage 2J draft-row tests, built as a real .xlsx file in memory.
 * Descriptions are artificial; figures are round dummy numbers.
 *
 * Bill 4 covers: a figure stated as 0, empty cells, a lump sum with no quantity, a negative
 * credit, unit spellings the Cost Library would write differently, a continuation row, and a
 * continuation row that also has a quantity. Bill 5 is a second, independent table.
 */
import * as XLSX from 'xlsx';

type Row = (string | number | null)[];
const HEADER = ['No.', 'Description', 'Unit', 'Qty', 'Rate (RM)', 'Amount (RM)'];

export function draftsBq(): Uint8Array {
  const bill4: Row[] = [
    /* 1 */ ['BILL NO. 4 – EXTERNAL WORKS (SYNTHETIC — NOT REAL COST DATA)'],
    /* 2 */ HEADER,
    /* 3 */ [null, 'SITE CLEARANCE'],
    /* 4 */ ['A', 'SYNTHETIC clear site of vegetation', 'M2', 0, 1.5, 0],
    /* 5 */ ['B', 'SYNTHETIC remove topsoil average 150mm thick', 'sq.m', 100, null, null],
    /* 6 */ ['C', 'SYNTHETIC temporary hoarding to site boundary', 'LS', null, null, 800],
    /* 7 */ ['D', 'SYNTHETIC credit for salvaged materials', 'item', 1, -200, -200],
    /* 8 */ ['E', 'SYNTHETIC excavate trench for drainage pipe', 'm', 40, 10, 400],
    /* 9 */ [null, 'not exceeding 1.00m deep, including backfilling'],
    /* 10 */ ['F', 'SYNTHETIC precast concrete kerb', 'm', 25, 30, 750],
    /* 11 */ [null, 'laid straight', null, 3],
    /* 12 */ [null, 'Total carried to Collection', null, null, null, 2150],
  ];
  const bill5: Row[] = [
    /* 1 */ ['BILL NO. 5 – DRAINAGE (SYNTHETIC — NOT REAL COST DATA)'],
    /* 2 */ HEADER,
    /* 3 */ ['A', 'SYNTHETIC 150mm diameter uPVC pipe', 'm', 60, 45, 2700],
    /* 4 */ ['B', 'SYNTHETIC inspection chamber', 'nr', 4, 900, 3600],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(bill4), 'Bill 4');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(bill5), 'Bill 5');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
}
