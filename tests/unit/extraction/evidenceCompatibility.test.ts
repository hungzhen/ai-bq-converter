/**
 * Stage 2F — extracted cells work with the Stage 2C models and the Stage 2E evidence verifier,
 * and the original file is never changed. SYNTHETIC — NOT REAL COST DATA.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  type ExtractedCell,
  type ExtractedTable,
  type FieldEvidence,
  type ParseOriginLike,
  addSourceDocument,
  checkReferencesBelongToProject,
  createProject,
  cellValueForParsing,
  findCellBySource,
} from './compat-imports.ts';
import { verifyFieldEvidence } from '../../../src/core/evidence/index.ts';
import { parseNumberCell, parseTextCell } from '../../../src/core/parsing/index.ts';
import type { ExtractionResult } from '../../../src/core/extraction/index.ts';
import { BILL_SHEET, extract, syntheticBqXls, syntheticBqXlsx, utf8 } from '../../helpers/synthetic/spreadsheets.ts';

function cellAt(table: ExtractedTable, address: string): ExtractedCell {
  for (const row of table.rows) for (const c of row.cells) if ('cellAddress' in c.source && c.source.cellAddress === address) return c;
  throw new Error(`no cell ${address}`);
}
const originOf = (cell: ExtractedCell): ParseOriginLike => ({ sources: [cell.source], method: cell.source.kind === 'csv' ? 'csv_cell' : 'spreadsheet_cell' });
const numberFrom = (cell: ExtractedCell, kind: 'quantity' | 'money' | 'percent') =>
  parseNumberCell(cellValueForParsing(cell), kind, originOf(cell), cell.displayText !== null ? { displayText: cell.displayText } : {}).evidence;
const blocking = (f: readonly { severity: string; code: string }[]) => f.filter((x) => x.severity === 'blocking').map((x) => x.code);
const tamper = (e: FieldEvidence) => structuredClone(e) as { -readonly [K in keyof FieldEvidence]: FieldEvidence[K] };

describe.each([
  ['XLSX', 'SYNTHETIC_BQ.xlsx', syntheticBqXlsx],
  ['XLS', 'SYNTHETIC_BQ.xls', syntheticBqXls],
] as const)('%s cells and the evidence verifier', (_label, fileName, build) => {
  let r: ExtractionResult;
  let bill: ExtractedTable;
  let ctx: Parameters<typeof verifyFieldEvidence>[3];
  beforeAll(async () => {
    r = await extract(build(), fileName);
    bill = r.tables.find((t) => t.origin.kind === 'worksheet' && t.origin.sheetName === BILL_SHEET)!;
    const project = addSourceDocument(createProject({ id: 'proj-synthetic', name: 'SYNTHETIC', projectYear: '2000 Q1' }), r.document);
    ctx = { project, documentId: r.document.id, tables: r.tables };
  });

  it('every extracted cell has a valid reference into the document, its worksheet and its own position', () => {
    const refs = r.tables.flatMap((t) => t.rows.flatMap((row) => [row.source, ...row.cells.map((c) => c.source)]));
    expect(refs.length).toBeGreaterThan(50);
    expect(checkReferencesBelongToProject(ctx.project, refs)).toEqual([]);
    for (const t of r.tables) for (const row of t.rows) for (const c of row.cells) expect(findCellBySource(r.tables, c.source)).toBe(c);
  });

  it('evidence built from extracted cells passes the verifier unchanged', () => {
    expect(blocking(verifyFieldEvidence('description', parseTextCell(cellAt(bill, 'B5').raw, originOf(cellAt(bill, 'B5'))), { valueType: 'text' }, ctx))).toEqual([]);
    for (const [address, kind] of [['D5', 'quantity'], ['E5', 'money'], ['F6', 'money'], ['E7', 'money'], ['E11', 'percent']] as const) {
      const cell = cellAt(bill, address);
      const findings = verifyFieldEvidence(address, numberFrom(cell, kind), { valueType: 'number', kind }, ctx);
      expect(blocking(findings), address).toEqual([]);
    }
  });

  it('the verifier still catches a changed raw value or parsed value', () => {
    const e = tamper(numberFrom(cellAt(bill, 'E7'), 'money'));
    e.raw = -125;
    e.parsed = -125;
    expect(blocking(verifyFieldEvidence('rate', e as FieldEvidence, { valueType: 'number', kind: 'money' }, ctx))).toEqual(['RAW_TEXT_ALTERED']);
    const p = tamper(numberFrom(cellAt(bill, 'E7'), 'money'));
    p.parsed = 12.5; // sign dropped
    expect(blocking(verifyFieldEvidence('rate', p as FieldEvidence, { valueType: 'number', kind: 'money' }, ctx))).toEqual(['PARSED_VALUE_MISMATCH']);
  });

  it('the verifier refuses a citation to a worksheet that does not exist', () => {
    const cell = cellAt(bill, 'D5');
    const e = tamper(numberFrom(cell, 'quantity'));
    (e.sources as unknown as Record<string, unknown>[])[0]!['sheetName'] = 'No Such Sheet';
    expect(blocking(verifyFieldEvidence('quantity', e as FieldEvidence, { valueType: 'number', kind: 'quantity' }, ctx))).toContain('SOURCE_CELL_NOT_FOUND');
  });
});

describe('formula cells and the evidence verifier (XLSX)', () => {
  let r: ExtractionResult;
  let bill: ExtractedTable;
  let ctx: Parameters<typeof verifyFieldEvidence>[3];
  beforeAll(async () => {
    r = await extract(syntheticBqXlsx(), 'SYNTHETIC_BQ.xlsx');
    bill = r.tables.find((t) => t.origin.kind === 'worksheet' && t.origin.sheetName === BILL_SHEET)!;
    ctx = { project: addSourceDocument(createProject({ id: 'proj-synthetic', name: 'SYNTHETIC' }), r.document), documentId: r.document.id, tables: r.tables };
  });

  it('a value from a formula passes but is flagged as a cached formula result', () => {
    const findings = verifyFieldEvidence('amount', numberFrom(cellAt(bill, 'F5'), 'money'), { valueType: 'number', kind: 'money' }, ctx);
    expect(blocking(findings)).toEqual([]);
    expect(findings.find((f) => f.code === 'FORMULA_RESULT')?.severity).toBe('warning');
  });

  it('a formula with no cached result must be recorded as MISSING — never blank or zero', () => {
    const cell = cellAt(bill, 'F7');
    const missing = numberFrom(cell, 'money');
    expect(missing.state).toBe('missing');
    const ok = verifyFieldEvidence('amount', missing, { valueType: 'number', kind: 'money' }, ctx);
    expect(blocking(ok)).toEqual([]);
    expect(ok.map((f) => f.code)).toContain('FORMULA_RESULT_MISSING');

    const asBlank = parseNumberCell(cell.raw, 'money', originOf(cell)).evidence; // raw null → would be "blank"
    expect(blocking(verifyFieldEvidence('amount', asBlank, { valueType: 'number', kind: 'money' }, ctx))).toEqual(['CONFLICTING_EVIDENCE']);
    const asZero = { ...asBlank, state: 'zero', parsed: 0 } as FieldEvidence;
    expect(blocking(verifyFieldEvidence('amount', asZero, { valueType: 'number', kind: 'money' }, ctx))).toContain('CONFLICTING_EVIDENCE');
  });
});

describe('CSV cells and the evidence verifier', () => {
  it('evidence from a CSV cell passes; an altered value is caught', async () => {
    const r = await extract(utf8('No.,Amount\nA,"RM 1,250.00"\nB,(50.00)\n'), 'SYNTHETIC.csv');
    const ctx = { project: addSourceDocument(createProject({ id: 'proj-synthetic', name: 'SYNTHETIC' }), r.document), documentId: r.document.id, tables: r.tables };
    const table = r.tables[0]!;
    const e = numberFrom(cellAt(table, 'B2'), 'money');
    expect(e.parsed).toBe(1250);
    expect(blocking(verifyFieldEvidence('amount', e, { valueType: 'number', kind: 'money' }, ctx))).toEqual([]);
    const neg = numberFrom(cellAt(table, 'B3'), 'money');
    expect(neg.parsed).toBe(-50);
    const t = tamper(neg);
    t.raw = '50.00';
    t.parsed = 50;
    expect(blocking(verifyFieldEvidence('amount', t as FieldEvidence, { valueType: 'number', kind: 'money' }, ctx))).toEqual(['RAW_TEXT_ALTERED']);
  });
});

describe('the original file is never changed', () => {
  it.each([
    ['SYNTHETIC_BQ.xlsx', syntheticBqXlsx],
    ['SYNTHETIC_BQ.xls', syntheticBqXls],
    ['SYNTHETIC.csv', () => utf8('No.,Amount\nA,"RM 1,250.00"\n')],
  ] as const)('%s: same bytes before and after, and the recorded fingerprint matches', async (fileName, build) => {
    const bytes = build();
    const copy = bytes.slice();
    const before = createHash('sha256').update(bytes).digest('hex');
    const r = await extract(bytes, fileName);
    expect(bytes).toEqual(copy);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(before);
    expect(r.document.sha256).toBe(before);
    expect(r.document.fileSizeBytes).toBe(bytes.length);
  });

  it('results are frozen so they cannot be edited afterwards', async () => {
    const r = await extract(syntheticBqXlsx(), 'SYNTHETIC_BQ.xlsx');
    const cell = r.tables[1]!.rows[4]!.cells[3]!;
    expect(() => {
      (cell as { raw: unknown }).raw = 999;
    }).toThrow(TypeError);
  });
});
