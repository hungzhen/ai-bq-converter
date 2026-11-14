/**
 * Stage 2F — unreadable, unsupported and partly broken files. SYNTHETIC — NOT REAL COST DATA.
 */
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { ExtractionError, detectSpreadsheetFormat, extractWorkbookObject } from '../../../src/core/extraction/index.ts';
import { createSourceDocument } from '../../../src/core/models/index.ts';
import { extract, nonWorkbookZip, passwordProtectedFile, syntheticBqXls, syntheticBqXlsx, utf8 } from '../../helpers/synthetic/spreadsheets.ts';

const failsWith = async (bytes: Uint8Array, fileName: string, code: string) => {
  const attempt = extract(bytes, fileName);
  await expect(attempt).rejects.toBeInstanceOf(ExtractionError);
  await expect(attempt).rejects.toMatchObject({ code });
};

describe('whole-file problems give a clear error', () => {
  it('unsupported file types', async () => {
    for (const name of ['SYNTHETIC.pdf', 'SYNTHETIC.xlsm', 'SYNTHETIC.xlsb', 'SYNTHETIC.ods', 'SYNTHETIC.txt', 'SYNTHETIC']) {
      await failsWith(utf8('a,b'), name, 'UNSUPPORTED_FORMAT');
    }
  });

  it('empty files', async () => {
    await failsWith(new Uint8Array(0), 'SYNTHETIC.xlsx', 'EMPTY_FILE');
    await failsWith(new Uint8Array(0), 'SYNTHETIC.csv', 'EMPTY_FILE');
    await failsWith(utf8(' \r\n \n'), 'SYNTHETIC.csv', 'EMPTY_FILE');
    await failsWith(new Uint8Array([0xef, 0xbb, 0xbf]), 'SYNTHETIC.csv', 'EMPTY_FILE');
  });

  it('a password-protected workbook', async () => {
    await failsWith(passwordProtectedFile(), 'SYNTHETIC_LOCKED.xlsx', 'PASSWORD_PROTECTED');
  });

  it('corrupted workbooks: truncated, random bytes, a non-workbook ZIP (e.g. .docx)', async () => {
    const good = syntheticBqXlsx();
    await failsWith(good.slice(0, Math.floor(good.length / 2)), 'SYNTHETIC.xlsx', 'CORRUPTED_FILE');
    await failsWith(new Uint8Array(Array.from({ length: 300 }, (_, i) => (i * 37 + 11) % 256)), 'SYNTHETIC.xlsx', 'CORRUPTED_FILE');
    await failsWith(nonWorkbookZip(), 'SYNTHETIC.xlsx', 'CORRUPTED_FILE');
  });

  it('a web page or XML file saved with an Excel name', async () => {
    await failsWith(utf8('<html><table><tr><td>1</td></tr></table></html>'), 'SYNTHETIC.xls', 'UNSUPPORTED_FORMAT');
    await failsWith(utf8('<?xml version="1.0"?><Workbook/>'), 'SYNTHETIC.xlsx', 'UNSUPPORTED_FORMAT');
  });

  it('a very old Excel 2–4 file', async () => {
    await failsWith(new Uint8Array([0x09, 0x04, 0x06, 0x00, 0, 0, 0x10, 0]), 'SYNTHETIC.xls', 'UNSUPPORTED_FORMAT');
  });

  it('an Excel workbook named .csv', async () => {
    await failsWith(syntheticBqXlsx(), 'SYNTHETIC.csv', 'FORMAT_MISMATCH');
  });
});

describe('extension and content that disagree are read by content, with a warning', () => {
  it('an .xlsx file named .xls', async () => {
    const r = await extract(syntheticBqXlsx(), 'SYNTHETIC.xls');
    expect(r.format).toBe('xlsx');
    expect(r.issues.find((i) => i.code === 'EXTENSION_MISMATCH')?.severity).toBe('warning');
  });

  it('an .xls file named .xlsx', async () => {
    const r = await extract(syntheticBqXls(), 'SYNTHETIC.xlsx');
    expect(r.format).toBe('xls');
    expect(r.issues.map((i) => i.code)).toContain('EXTENSION_MISMATCH');
  });

  it('file-name case does not matter', () => {
    expect(detectSpreadsheetFormat(syntheticBqXlsx(), 'SYNTHETIC.XLSX').format).toBe('xlsx');
  });
});

describe('a worksheet that cannot be read is reported, not skipped silently', () => {
  const doc = createSourceDocument({
    id: 'doc-broken', projectId: 'proj-synthetic', fileName: 'SYNTHETIC_BROKEN.xlsx', fileSizeBytes: 1, sha256: 'a'.repeat(64),
    format: 'xlsx', documentType: 'unknown', uploadedAt: 'x', uploadedBy: null, organizationId: null,
  });

  it('the other worksheets are still extracted; the failure is listed as an error', () => {
    const wb = {
      SheetNames: ['Good', 'Broken', 'Missing'],
      Sheets: { Good: { '!ref': 'A1', A1: { t: 's', v: 'SYNTHETIC' } }, Broken: { '!ref': 'not-a-range', A1: { t: 's', v: 'x' } } },
    } as unknown as XLSX.WorkBook;
    const r = extractWorkbookObject(wb, doc);
    expect(r.sheets.map((s) => [s.name, s.status])).toEqual([['Good', 'extracted'], ['Broken', 'failed'], ['Missing', 'failed']]);
    expect(r.tables.map((t) => t.origin.kind === 'worksheet' && t.origin.sheetName)).toEqual(['Good']);
    expect(r.issues.filter((i) => i.code === 'SHEET_EXTRACTION_FAILED').map((i) => [i.sheetName, i.severity])).toEqual([['Broken', 'error'], ['Missing', 'error']]);
  });

  it('a cell with an invalid address is reported as an error; the rest of the sheet is extracted', () => {
    const wb = { SheetNames: ['S'], Sheets: { S: { '!ref': 'A1:B1', A1: { t: 's', v: 'SYNTHETIC' }, '1A': { t: 's', v: 'bad' } } } } as unknown as XLSX.WorkBook;
    const r = extractWorkbookObject(wb, doc);
    expect(r.tables[0]!.rows[0]!.cells.map((c) => c.raw)).toEqual(['SYNTHETIC']);
    expect(r.issues.find((i) => i.code === 'CELL_EXTRACTION_FAILED')).toMatchObject({ severity: 'error', cellAddress: '1A' });
  });

  it('overlapping merged ranges are reported as unusual', () => {
    const wb = { SheetNames: ['S'], Sheets: { S: { '!ref': 'A1:C3', A1: { t: 's', v: 'x' }, '!merges': [XLSX.utils.decode_range('A1:B2'), XLSX.utils.decode_range('B2:C3')] } } } as unknown as XLSX.WorkBook;
    expect(extractWorkbookObject(wb, doc).issues.map((i) => i.code)).toContain('OVERLAPPING_MERGES');
  });

  it('a workbook where every sheet is empty gets a warning; one with no sheets at all is refused', () => {
    const empty = { SheetNames: ['A', 'B'], Sheets: { A: {}, B: {} } } as unknown as XLSX.WorkBook;
    expect(extractWorkbookObject(empty, doc).issues.find((i) => i.code === 'EMPTY_WORKBOOK')?.severity).toBe('warning');
    expect(() => extractWorkbookObject({ SheetNames: [], Sheets: {} } as unknown as XLSX.WorkBook, doc)).toThrow(ExtractionError);
  });
});
