/**
 * SYNTHETIC — NOT REAL COST DATA.
 *
 * Builds synthetic spreadsheet FILES (bytes) in memory for the extraction tests. The layout
 * imitates a typical BQ (title, header, headings, items, page total, notes) but every
 * description is artificial and every figure is a round dummy number.
 */
import * as XLSX from 'xlsx';
import { extractSpreadsheetFile, type ExtractionOptions } from '../../../src/core/extraction/index.ts';
import { NOW } from './models.ts';

const CFB = XLSX.CFB;

export const BILL_SHEET = 'Bill 2 – Substructure';
export const UNUSUAL_SHEET = "BQ's (Rev.A) #2";
export const RM_FORMAT = '"RM" #,##0.00;("RM" #,##0.00)';

/** The main synthetic BQ worksheet (XLSX version, with formulas and a hidden row). */
function billSheet(withFormulas: boolean): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {
    '!ref': 'A1:G14',
    A1: { t: 's', v: 'BILL NO. 2 – SUBSTRUCTURE (SYNTHETIC — NOT REAL COST DATA)' },
    // row 2 deliberately absent (blank row)
    A3: { t: 's', v: 'No.' }, B3: { t: 's', v: 'Description' }, C3: { t: 's', v: 'Unit' }, D3: { t: 's', v: 'Qty' }, E3: { t: 's', v: 'Rate (RM)' }, F3: { t: 's', v: 'Amount (RM)' },
    B4: { t: 's', v: 'SYNTHETIC EXCAVATION HEADING' }, C4: { t: 's', v: 'covered text' },
    A5: { t: 's', v: 'A' }, B5: { t: 's', v: 'SYNTHETIC ITEM 001, depth not exceeding 1.50m' }, C5: { t: 's', v: 'm3' },
    D5: { t: 'n', v: 10, z: '#,##0.00' }, E5: { t: 'n', v: 25.5, z: '#,##0.00' },
    F5: withFormulas ? { t: 'n', v: 255, f: 'D5*E5', z: RM_FORMAT } : { t: 'n', v: 255, z: RM_FORMAT },
    A6: { t: 's', v: 'B' }, B6: { t: 's', v: 'SYNTHETIC ITEM 002' }, C6: { t: 's', v: 'L.S.' }, F6: { t: 'n', v: 500, z: RM_FORMAT },
    A7: { t: 's', v: 'C' }, B7: { t: 's', v: 'SYNTHETIC OMISSION 003' }, C7: { t: 's', v: 'nr' }, D7: { t: 'n', v: 1 },
    E7: { t: 'n', v: -12.5, z: RM_FORMAT },
    ...(withFormulas ? { F7: { t: 'n', f: 'D7*E7' } } : {}), // formula with NO cached result
    B8: { t: 's', v: 'SYNTHETIC HIDDEN NOTE' },
    B9: { t: 's', v: 'Carried to Collection' },
    F9: withFormulas ? { t: 'n', v: 742.5, f: 'SUM(F5:F7)', z: RM_FORMAT } : { t: 'n', v: 742.5, z: RM_FORMAT },
    // row 10 repeats row 5 on purpose: duplicates must NOT be removed
    A10: { t: 's', v: 'A' }, B10: { t: 's', v: 'SYNTHETIC ITEM 001, depth not exceeding 1.50m' }, C10: { t: 's', v: 'm3' }, D10: { t: 'n', v: 10, z: '#,##0.00' },
    E11: { t: 'n', v: 0.05, z: '0%' },
    D12: { t: 'n', v: 36526, z: 'd/m/yyyy' },
    F13: { t: 'e', v: 7, w: '#DIV/0!' },
    B14: { t: 's', v: '  SYNTHETIC TEXT WITH SPACES  ' },
    G5: { t: 's', v: 'SYNTHETIC INTERNAL NOTE (hidden column)' },
    '!merges': [XLSX.utils.decode_range('A1:F1'), XLSX.utils.decode_range('B4:F4')],
  };
  const cols: XLSX.ColInfo[] = [];
  cols[6] = { hidden: true }; // column G
  ws['!cols'] = cols;
  if (withFormulas) {
    const rows: XLSX.RowInfo[] = [];
    rows[7] = { hidden: true }; // Excel row 8
    ws['!rows'] = rows;
  }
  return ws;
}

function workbook(withFormulas: boolean): XLSX.WorkBook {
  return {
    SheetNames: ['Cover', BILL_SHEET, UNUSUAL_SHEET, 'Rates build-up', 'Locked', 'Empty'],
    Sheets: {
      Cover: { '!ref': 'A1:F1', A1: { t: 's', v: 'SYNTHETIC PROJECT — NOT REAL COST DATA' }, '!merges': [XLSX.utils.decode_range('A1:F1')] },
      [BILL_SHEET]: billSheet(withFormulas),
      [UNUSUAL_SHEET]: { '!ref': 'A1:B2', A1: { t: 's', v: 'Kerja tanah – Bil 3 (ujian sintetik)' }, B2: { t: 'n', v: 1250, z: '#,##0.00' } },
      'Rates build-up': { '!ref': 'A1:B1', A1: { t: 's', v: 'SYNTHETIC BUILD-UP' }, B1: { t: 'n', v: 12.5 } },
      Locked: { '!ref': 'A1', A1: { t: 's', v: 'SYNTHETIC VERY HIDDEN' } },
      Empty: {},
    },
    Workbook: { Sheets: [{ Hidden: 0 }, { Hidden: 0 }, { Hidden: 0 }, { Hidden: 1 }, { Hidden: 2 }, { Hidden: 0 }] },
  } as unknown as XLSX.WorkBook;
}

export const syntheticBqXlsx = (): Uint8Array => new Uint8Array(XLSX.write(workbook(true), { type: 'array', bookType: 'xlsx' }));

/**
 * XLS (Excel 97–2003) version. The XLS writer used to build test files cannot write formulas or
 * hidden rows, so this file has stored values only; it adds a present-but-empty cell (C9).
 */
export function syntheticBqXls(): Uint8Array {
  const wb = workbook(false);
  (wb.Sheets[BILL_SHEET] as XLSX.WorkSheet)['C9'] = { t: 'z' };
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xls' }));
}

/** XLSX with a present-but-empty (styled) cell C2, written directly into the sheet XML. */
export function xlsxWithEmptyStyledCell(): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['SYNTHETIC', 1], ['SYNTHETIC 2', 2]]), 'S');
  const zip = CFB.read(new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' })), { type: 'array' });
  const entry = CFB.find(zip, '/xl/worksheets/sheet1.xml')!;
  const xml = new TextDecoder().decode(entry.content as Uint8Array).replace('</c></row><row r="2">', '</c></row><row r="2">').replace(/(<c r="B2"[^>]*>.*?<\/c>)/, '$1<c r="C2" s="0"/>');
  CFB.utils.cfb_add(zip, '/xl/worksheets/sheet1.xml', new TextEncoder().encode(xml));
  return new Uint8Array(CFB.write(zip, { type: 'array', fileType: 'zip' }) as ArrayBuffer);
}

/** An OLE container shaped like a password-protected Office file (no real content). */
export function passwordProtectedFile(): Uint8Array {
  const c = CFB.utils.cfb_new();
  CFB.utils.cfb_add(c, '/EncryptionInfo', new Uint8Array([4, 0, 4, 0, 0x40, 0, 0, 0, 1, 2, 3, 4]));
  CFB.utils.cfb_add(c, '/EncryptedPackage', new Uint8Array(64));
  return new Uint8Array(CFB.write(c, { type: 'array' }) as ArrayBuffer);
}

/** A ZIP that is not a workbook (like a .docx). */
export function nonWorkbookZip(): Uint8Array {
  const c = CFB.utils.cfb_new();
  CFB.utils.cfb_add(c, '/word/document.xml', new TextEncoder().encode('<w/>'));
  return new Uint8Array(CFB.write(c, { type: 'array', fileType: 'zip' }) as ArrayBuffer);
}

export const utf8 = (text: string) => new TextEncoder().encode(text);
export const withBom = (text: string) => new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(text)]);
export function utf16le(text: string, bom = true): Uint8Array {
  const out = new Uint8Array((bom ? 2 : 0) + text.length * 2);
  let i = 0;
  if (bom) {
    out[i++] = 0xff;
    out[i++] = 0xfe;
  }
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    out[i++] = code & 0xff;
    out[i++] = code >> 8;
  }
  return out;
}

/** Extracts with fixed synthetic project and document ids. */
export function extract(bytes: Uint8Array, fileName: string, options: ExtractionOptions = {}) {
  return extractSpreadsheetFile(
    { bytes, fileName, projectId: 'proj-synthetic', documentId: 'doc-extract', uploadedAt: NOW, uploadedBy: null, organizationId: null },
    options,
  );
}
