/**
 * Stage 2F — CSV extraction. Every file is SYNTHETIC — NOT REAL COST DATA.
 */
import { describe, expect, it } from 'vitest';
import { ExtractionError, parseCsvText } from '../../../src/core/extraction/index.ts';
import { extract, utf16le, utf8, withBom } from '../../helpers/synthetic/spreadsheets.ts';

const HEADER = ['No.', 'Description', 'Unit', 'Qty', 'Rate', 'Amount'];
const csvOf = (d: string) =>
  [
    HEADER.join(d),
    ['A', 'SYNTHETIC ITEM 001', 'm2', '10', '2.00', '20.00'].join(d),
    ['B', 'SYNTHETIC ITEM 002', 'L.S.', '', '', 'RM 500.00'].join(d),
    ['C', 'SYNTHETIC OMISSION 003', 'nr', '1', '(5.00)', '-5.00'].join(d),
  ].join('\r\n') + '\r\n';

const rowsOf = async (bytes: Uint8Array, opts = {}) => (await extract(bytes, 'SYNTHETIC.csv', opts)).tables[0]!.rows.map((r) => r.cells.map((c) => c.raw));

describe('delimiters', () => {
  it.each([
    [',', 'comma'],
    [';', 'semicolon'],
    ['\t', 'tab'],
    ['|', 'vertical bar'],
  ])('detects "%s" (%s) and reads the same table', async (d) => {
    const r = await extract(utf8(csvOf(d)), 'SYNTHETIC.csv');
    expect(r.csv).toMatchObject({ delimiter: d, delimiterSource: 'detected', fieldCount: 6, recordCount: 4, lineEnding: 'CRLF' });
    expect(r.tables[0]!.rows.map((row) => row.cells.map((c) => c.raw))).toEqual([
      HEADER,
      ['A', 'SYNTHETIC ITEM 001', 'm2', '10', '2.00', '20.00'],
      ['B', 'SYNTHETIC ITEM 002', 'L.S.', '', '', 'RM 500.00'],
      ['C', 'SYNTHETIC OMISSION 003', 'nr', '1', '(5.00)', '-5.00'],
    ]);
  });

  it('uses a delimiter chosen by the user', async () => {
    const r = await extract(utf8('a;b\nc;d\n'), 'SYNTHETIC.csv', { csv: { delimiter: ';' } });
    expect(r.csv).toMatchObject({ delimiter: ';', delimiterSource: 'chosen' });
  });

  it('refuses to guess when two delimiters fit equally well', async () => {
    await expect(extract(utf8('a,b;c,d\ne,f;g,h\n'), 'SYNTHETIC.csv')).rejects.toMatchObject({ code: 'CSV_DELIMITER_AMBIGUOUS' });
  });

  it('refuses to guess when no delimiter is found', async () => {
    await expect(extract(utf8('SYNTHETIC LINE ONE\nSYNTHETIC LINE TWO\n'), 'SYNTHETIC.csv')).rejects.toMatchObject({ code: 'CSV_DELIMITER_UNDETERMINED' });
  });
});

describe('values are kept exactly as text — nothing converted', () => {
  it('RM values, brackets, minus signs, percentages and dates stay as written', async () => {
    const rows = await rowsOf(utf8('No.,Amount,Pct,Date\nA,"RM 1,250.00",5%,01/02/2000\nB,(50.00),-,-50.00\n'));
    expect(rows[1]).toEqual(['A', 'RM 1,250.00', '5%', '01/02/2000']);
    expect(rows[2]).toEqual(['B', '(50.00)', '-', '-50.00']);
  });

  it('every CSV cell is text with no shown-text substitute', async () => {
    const r = await extract(utf8(csvOf(',')), 'SYNTHETIC.csv');
    for (const row of r.tables[0]!.rows) for (const c of row.cells) expect(c).toMatchObject({ cellType: 'text', displayText: null });
  });
});

describe('quoting', () => {
  it('keeps commas inside quoted descriptions', async () => {
    const rows = await rowsOf(utf8('No.,Description,Unit\nA,"SYNTHETIC ITEM, depth n.e. 1.5m, in clay",m3\n'));
    expect(rows[1]).toEqual(['A', 'SYNTHETIC ITEM, depth n.e. 1.5m, in clay', 'm3']);
  });

  it('keeps line breaks inside quoted descriptions, and records the line each row starts on', async () => {
    const r = await extract(utf8('No.,Description,Unit\nA,"SYNTHETIC LINE 1\nSYNTHETIC LINE 2",m3\nB,SYNTHETIC ITEM,nr\n'), 'SYNTHETIC.csv');
    const rows = r.tables[0]!.rows;
    expect(rows[1]!.cells[1]!.raw).toBe('SYNTHETIC LINE 1\nSYNTHETIC LINE 2');
    expect(rows[2]!.source).toMatchObject({ kind: 'csv', rowNumber: 3, lineNumber: 4 });
    expect(rows[2]!.cells[1]!.source).toMatchObject({ rowNumber: 3, columnNumber: 2, cellAddress: 'B3', lineNumber: 4 });
  });

  it('turns "" inside quotes into one quote, and keeps a stray quote (with a warning)', async () => {
    const r = await extract(utf8('No.,Description\nA,"SYNTHETIC 12"" PIPE"\nB,SYNTHETIC 6" PIPE\n'), 'SYNTHETIC.csv');
    expect(r.tables[0]!.rows[1]!.cells[1]!.raw).toBe('SYNTHETIC 12" PIPE');
    expect(r.tables[0]!.rows[2]!.cells[1]!.raw).toBe('SYNTHETIC 6" PIPE');
    expect(r.issues.map((i) => i.code)).toContain('CSV_STRAY_QUOTE');
  });

  it('refuses a file whose quote is never closed', async () => {
    await expect(extract(utf8('No.,Description\nA,"SYNTHETIC NEVER CLOSED\nB,x\n'), 'SYNTHETIC.csv')).rejects.toMatchObject({ code: 'CSV_UNTERMINATED_QUOTE' });
  });
});

describe('blank versus absent', () => {
  it('an empty field is a present cell with "" ; a short row has absent cells; a blank line is an empty row', async () => {
    const r = await extract(utf8('a,b,c\n1,,3\n4\n\n7,8,9\n'), 'SYNTHETIC.csv');
    const rows = r.tables[0]!.rows;
    expect(rows[1]!.cells.map((c) => c.raw)).toEqual(['1', '', '3']); // middle field present but empty
    expect(rows[2]!.cells.map((c) => c.raw)).toEqual(['4']); // b and c absent
    expect(rows[3]!.cells).toEqual([]); // blank line kept in place
    expect(rows[4]!.source).toMatchObject({ rowNumber: 5 });
    expect(r.issues.find((i) => i.code === 'CSV_FIELD_COUNT_DIFFERS')?.rowNumber).toBe(3);
  });

  it('keeps spaces around values', async () => {
    expect((await rowsOf(utf8('a,b\n  x  , y \n')))[1]).toEqual(['  x  ', ' y ']);
  });
});

describe('encodings and special characters', () => {
  const special = 'No.,Description,Unit\nA,Kerja tanah – lapisan 150mm ø12 (ujian) 中文,m²\n';

  it('reads UTF-8 with a BOM and does not keep the BOM in the first cell', async () => {
    const r = await extract(withBom(special), 'SYNTHETIC.csv');
    expect(r.csv).toMatchObject({ encoding: 'utf-8', hadBom: true });
    expect(r.tables[0]!.rows[0]!.cells[0]!.raw).toBe('No.');
    expect(r.tables[0]!.rows[1]!.cells.map((c) => c.raw)).toEqual(['A', 'Kerja tanah – lapisan 150mm ø12 (ujian) 中文', 'm²']);
  });

  it('reads UTF-8 without a BOM', async () => {
    const r = await extract(utf8(special), 'SYNTHETIC.csv');
    expect(r.csv).toMatchObject({ encoding: 'utf-8', hadBom: false });
  });

  it('reads UTF-16 with a BOM (Excel "Unicode text")', async () => {
    const r = await extract(utf16le('No.\tDescription\nA\tSYNTHETIC m²\n'), 'SYNTHETIC.csv');
    expect(r.csv).toMatchObject({ encoding: 'utf-16le', delimiter: '\t' });
    expect(r.tables[0]!.rows[1]!.cells[1]!.raw).toBe('SYNTHETIC m²');
  });

  it('refuses text that is not valid UTF-8 unless the encoding is chosen', async () => {
    const latin1 = new Uint8Array([...utf8('No.,Description\nA,SYNTHETIC '), 0xe9, ...utf8('\n')]); // "é" in Windows-1252
    await expect(extract(latin1, 'SYNTHETIC.csv')).rejects.toMatchObject({ code: 'CSV_ENCODING_UNDETERMINED' });
    const r = await extract(latin1, 'SYNTHETIC.csv', { csv: { encoding: 'windows-1252' } });
    expect(r.tables[0]!.rows[1]!.cells[1]!.raw).toBe('SYNTHETIC é');
  });

  it('refuses UTF-16 without a BOM instead of reading it wrongly', async () => {
    await expect(extract(utf16le('a,b\n1,2\n', false), 'SYNTHETIC.csv')).rejects.toBeInstanceOf(ExtractionError);
  });
});

describe('line endings', () => {
  it.each([
    ['\n', 'LF'],
    ['\r\n', 'CRLF'],
    ['\r', 'CR'],
  ])('%j line endings', (eol, name) => {
    const parsed = parseCsvText(`a,b${eol}c,d${eol}`, ',');
    expect(parsed.records.map((r) => r.fields)).toEqual([['a', 'b'], ['c', 'd']]);
    expect(parsed.lineEnding).toBe(name);
  });
});
