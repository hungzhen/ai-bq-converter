/**
 * Stage 2L — the upload workbook and the reconciliation workbook.
 * Every file is SYNTHETIC — NOT REAL COST DATA.
 */
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  INSTRUCTIONS_SHEET,
  NOT_VALIDATED,
  RECONCILIATION_BANNER,
  RECONCILIATION_SHEETS,
  UPLOAD_HEADERS,
  UPLOAD_SHEET,
  WorkbookWriteError,
  buildUploadWorkbook,
  checkUploadWorkbook,
  createExport,
  planExport,
} from '../../../src/core/export/index.ts';
import { sha256Hex } from '../../../src/core/extraction/hash.ts';
import { type SavedReview, createBackup, readBackup, recordChanges, recordDraftRowChange, validateReviewRecord } from '../../../src/core/review/index.ts';
import { reopenProposal } from '../../../src/core/evidence/index.ts';
import { viewRow } from '../../../src/core/staging/index.ts';
import type { PipelineSuccess } from '../../../src/core/pipeline/runPipeline.ts';
import { draftsBq } from '../../helpers/synthetic/draftLayouts.ts';
import { FORMULA_LIKE, formulaTextBq } from '../../helpers/synthetic/exportLayouts.ts';
import { newReview, reread } from '../../helpers/reviews.ts';
import { AT, approveAll, correct, drafts, proposalOf, withProject } from '../../helpers/drafts.ts';
import { decideAllRows, sheetsOf } from '../../helpers/export.ts';

const BY = 'Synthetic Reviewer';

async function decided(bytes = draftsBq(), name = 'SYNTHETIC_DRAFTS.xlsx', only?: (t: string) => boolean) {
  const { run, review } = await newReview(bytes, name);
  return { run, review: decideAllRows(withProject(approveAll(review)), run, only), bytes };
}
/** The formula-text BQ: a reviewer first corrects column A (proposed "unknown") to the item-number column. */
async function decidedFormulaBq() {
  const { run, review } = await newReview(formulaTextBq(), 'SYNTHETIC_FORMULAS.xlsx');
  const col = proposalOf(review, 'columnRole', { tableId: 'doc-review:sheet:0', columnIndex: 0 });
  const r = correct(review, run, col, { tableId: 'doc-review:sheet:0', columnIndex: 0, role: 'itemNo' }, 'SYNTHETIC: column A holds item numbers.');
  return { run, review: decideAllRows(withProject(approveAll(r)), run) };
}
const exportOf = (review: SavedReview, run: PipelineSuccess) =>
  createExport({ review, drafts: drafts(review, run), tables: run.extraction.tables, document: run.extraction.document, at: '2000-01-05T09:00:00.000Z', by: BY });
async function exported(review: SavedReview, run: PipelineSuccess) {
  const res = await exportOf(review, run);
  if (!res.ok) throw new Error(res.errors.join('\n'));
  return res;
}
/** A sheet as rows of cells exactly as stored (undefined = no cell). */
function grid(ws: XLSX.WorkSheet): (XLSX.CellObject | undefined)[][] {
  const range = XLSX.utils.decode_range(ws['!ref']!);
  const out: (XLSX.CellObject | undefined)[][] = [];
  for (let r = 0; r <= range.e.r; r++) {
    const row: (XLSX.CellObject | undefined)[] = [];
    for (let c = 0; c <= range.e.c; c++) row.push(ws[XLSX.utils.encode_cell({ r, c })]);
    out.push(row);
  }
  return out;
}
const values = (ws: XLSX.WorkSheet) => grid(ws).map((r) => r.map((c) => (c === undefined ? null : c.v)));
const allCells = (wb: XLSX.WorkBook) => wb.SheetNames.flatMap((n) => grid(wb.Sheets[n]!).flat().filter((c): c is XLSX.CellObject => c !== undefined));

describe('the upload workbook (read back cell by cell, independently with SheetJS)', () => {
  it('has the template sheets and columns in order, approved rows only, exact values and genuine blanks', async () => {
    const { run, review } = await decided();
    const res = await exported(review, run);
    const wb = sheetsOf(res.files[0].bytes);
    expect(wb.SheetNames).toEqual([INSTRUCTIONS_SHEET, UPLOAD_SHEET]);
    const rows = values(wb.Sheets[UPLOAD_SHEET]!);
    expect(rows[0]).toEqual([...UPLOAD_HEADERS]);
    // Bill 4: A, B, C, E, F, (row 11) — D (negative) excluded; Bill 5: A, B
    expect(rows.slice(1).map((r) => r[0])).toEqual(['A', 'B', 'C', 'E', 'F', null, 'A', 'B']);
    expect(rows.length).toBe(9);
    // Row A: stated zeros are real 0 numbers; unit exactly as written
    expect(rows[1]).toEqual(['A', null, null, 'SITE CLEARANCE', null, null, 'SYNTHETIC clear site of vegetation', 'M2', 0, 1.5, 0]);
    // Row B: rate and amount confirmed not stated → NO cell at all (not 0, not "")
    const g = grid(wb.Sheets[UPLOAD_SHEET]!);
    expect(g[2]![8]).toMatchObject({ t: 'n', v: 100 });
    expect(g[2]![9]).toBeUndefined();
    expect(g[2]![10]).toBeUndefined();
    // Row C: lump sum: quantity blank (never 1), amount 800 as written
    expect(rows[3]!.slice(7)).toEqual(['LS', null, null, 800]);
    // Row E: joined description exactly
    expect(rows[4]![6]).toBe('SYNTHETIC excavate trench for drainage pipe not exceeding 1.00m deep, including backfilling');
    // Text cells are text; numbers are numbers; no formula anywhere; no negative figure anywhere
    for (const r of g.slice(1)) {
      for (const c of [0, 1, 3, 6, 7]) if (r[c]) expect(r[c]!.t).toBe('s');
      for (const c of [8, 9, 10]) if (r[c]) expect(r[c]!.t).toBe('n');
    }
    expect(allCells(wb).filter((c) => c.f !== undefined)).toEqual([]);
    expect(allCells(wb).some((c) => typeof c.v === 'number' && c.v < 0)).toBe(false);
  });

  it('is labelled NOT YET VALIDATED FOR COST LIBRARY IMPORT (file name, Instructions sheet, properties)', async () => {
    const { run, review } = await decided();
    const res = await exported(review, run);
    expect(res.files[0].fileName).toBe('NOT-VALIDATED_SYNTHETIC_DRAFTS.cost-library-upload.xlsx');
    const wb = XLSX.read(res.files[0].bytes, { type: 'array' });
    expect(wb.Sheets[INSTRUCTIONS_SHEET]!['A1']!.v).toBe(NOT_VALIDATED);
    expect(wb.Props?.Title).toBe(NOT_VALIDATED);
    expect(String(wb.Sheets[INSTRUCTIONS_SHEET]!['A2']!.v)).toContain('Do not upload it until the separate compatibility test');
  });

  it('every value equals its source cell (descriptions, item numbers, units, figures)', async () => {
    const { run, review } = await decided();
    const res = await exported(review, run);
    const rows = values(sheetsOf(res.files[0].bytes).Sheets[UPLOAD_SHEET]!);
    const src = run.extraction.tables[1]!; // Bill 5
    const cell = (r: number, c: number) => src.rows.find((x) => x.rowIndex === r)!.cells.find((x) => x.columnIndex === c)!.raw;
    expect(rows[7]!.slice(6)).toEqual([cell(2, 1), cell(2, 2), cell(2, 3), cell(2, 4), cell(2, 5)]);
    expect(rows[7]![0]).toBe(cell(2, 0));
  });

  it('text that looks like a formula stays text (formula-injection protection); "1.10" stays "1.10"', async () => {
    const { run, review } = await decidedFormulaBq();
    const res = await exported(review, run);
    const wb = sheetsOf(res.files[0].bytes);
    const g = grid(wb.Sheets[UPLOAD_SHEET]!);
    expect(g.slice(1).map((r) => r[6]?.v)).toEqual(FORMULA_LIKE);
    expect(g.slice(1).map((r) => r[0]?.v)).toEqual(['1.10', '=1+1', 'C', 'D']);
    for (const r of g.slice(1)) for (const c of [0, 6]) expect(r[c]).toMatchObject({ t: 's' });
    expect(allCells(wb).filter((c) => c.f !== undefined)).toEqual([]);
    expect(allCells(sheetsOf(res.files[1].bytes)).filter((c) => c.f !== undefined)).toEqual([]);
  });
});

describe('the reconciliation workbook', () => {
  it('every sheet labelled; every source row exactly once; excluded negative kept with sign and reason', async () => {
    const { run, review } = await decided();
    const res = await exported(review, run);
    const wb = sheetsOf(res.files[1].bytes);
    expect(res.files[1].fileName).toBe('SYNTHETIC_DRAFTS.reconciliation.xlsx');
    expect(wb.SheetNames).toEqual([...RECONCILIATION_SHEETS]);
    for (const n of wb.SheetNames) expect(wb.Sheets[n]!['A1']!.v).toBe(RECONCILIATION_BANNER);

    const coverage = values(wb.Sheets['Coverage']!).slice(2);
    expect(coverage).toHaveLength(12 + 4);
    expect(new Set(coverage.map((r) => `${r[0]}|${r[1]}`)).size).toBe(16);
    expect(coverage.find((r) => r[1] === 'Sheet: Bill 4 | Row 9')![6]).toBe('Part of upload workbook row 5.');
    expect(coverage.find((r) => r[1] === 'Sheet: Bill 4 | Row 7')![6]).toContain('Excluded from the upload');

    const excluded = values(wb.Sheets['Excluded Rows']!).slice(2);
    expect(excluded).toHaveLength(1);
    expect(excluded[0]!.slice(0, 10)).toEqual(['Sheet: Bill 4 | Row 7', 'D', 'SYNTHETIC credit for salvaged materials', 'item', 1, '1', -200, '-200', -200, '-200']);
    expect(excluded[0]![10]).toBe('SYNTHETIC: negative credit, excluded from the upload.');

    const trace = values(wb.Sheets['Line Trace']!).slice(2);
    expect(trace.find((r) => r[0] === 5)![3]).toBe('Sheet: Bill 4 | Row 8; Sheet: Bill 4 | Row 9'); // every contributing source row
  });

  it('placeholders, import effects, stated totals listed only — no totals calculated', async () => {
    const { run, review } = await decided();
    const res = await exported(review, run);
    const wb = sheetsOf(res.files[1].bytes);
    const placeholders = values(wb.Sheets['Placeholders']!).slice(2);
    expect(placeholders.filter((r) => r[0] === 3).map((r) => r[2])).toEqual(['rate', 'amount']);
    expect(placeholders.every((r) => r[7] === 'Genuinely blank in the upload workbook (not zero, not calculated).')).toBe(true);
    const effects = values(wb.Sheets['Import Effects']!).slice(2).map((r) => `${r[0]} ${r[2]} ${r[3]}`);
    expect(effects).toContain('2 Unit Written "M2" (exactly as in the document); the Cost Library is expected to store "m²".');
    expect(effects).toContain('3 Rate (RM) Blank: the importer is expected to store 0.');
    expect(effects).toContain('4 Qty Blank: the importer is expected to store 0.'); // the lump sum: never 1
    expect(values(wb.Sheets['Import Effects']!).slice(2).every((r) => String(r[4]).includes('NOT YET CONFIRMED'))).toBe(true);
    const summary = values(wb.Sheets['Summary']!).flat();
    expect(summary).toContain('2150'); // stated total, as written
    for (const sum of [6300, 2700 + 3600 + 255, 400 + 750 + 800]) expect(allCells(wb).some((c) => c.v === sum)).toBe(false);
  });
});

describe('partial export', () => {
  it('a ready table is exported while a blocked one is listed in Blocked Tables and never in the upload workbook', async () => {
    const { run, review } = await decided(draftsBq(), 'SYNTHETIC_DRAFTS.xlsx', (t) => t === 'Bill 4');
    const res = await exported(review, run);
    expect(res.record.tables.map((t) => t.name)).toEqual(['Bill 4']);
    const upload = values(sheetsOf(res.files[0].bytes).Sheets[UPLOAD_SHEET]!);
    expect(upload.some((r) => String(r[6]).includes('uPVC'))).toBe(false);
    const recon = sheetsOf(res.files[1].bytes);
    expect(values(recon.Sheets['Blocked Tables']!).slice(2).map((r) => r[0])).toEqual(['Bill 5']);
    expect(values(recon.Sheets['Coverage']!).slice(2).filter((r) => r[0] === 'Bill 5' && r[5] !== '' && r[5] !== null).every((r) => r[6] === 'Not exported: its table is not ready for export.')).toBe(true);
  });
});

describe('failed checks produce no files', () => {
  it('missing project year, no ready table, an outdated approval', async () => {
    const { run, review } = await decided();
    const noYear = withProject(review, { name: 'SYNTHETIC', year: null, projectRef: null, location: null });
    expect(await exportOf(noYear, run)).toMatchObject({ ok: false });
    const { run: run2, review: undecided } = await newReview(draftsBq(), 'SYNTHETIC_DRAFTS.xlsx');
    const none = await exportOf(withProject(approveAll(undecided)), run2);
    expect(none.ok ? '' : none.errors.join(' ')).toContain('No table is ready for export');
    // A review decision changes Bill 5's amount column: its approvals become outdated → not exported.
    const col = proposalOf(review, 'columnRole', { tableId: 'doc-review:sheet:1', columnIndex: 5 });
    let r = recordChanges(review, [{ before: col, after: reopenProposal(col) }], AT, null);
    r = correct(r, run, r.proposals.find((p) => p.id === col.id)!, { tableId: 'doc-review:sheet:1', columnIndex: 5, role: 'ignore' });
    const res = await exported(r, run);
    expect(res.record.tables.map((t) => t.name)).toEqual(['Bill 4']);
  });

  it('a forged approval of a negative row or of an unconfirmed placeholder is never exported', async () => {
    const { run, review } = await decided(draftsBq(), 'SYNTHETIC_DRAFTS.xlsx', (t) => t === 'Bill 5');
    const t4 = drafts(review, run).tables[0]!;
    let r = review;
    for (const d of t4.drafts) {
      const v = viewRow(d, null); // approve every Bill 4 row without resolving anything (bypassing the rules)
      r = recordDraftRowChange(r, { draftId: d.row.id, resolutions: [], decision: { status: 'approved', by: null, at: AT, note: 'forged', acknowledgedWarnings: [], rowFingerprint: v.fingerprint, contentSummary: v.summary } }, 'row_approved', 'forged', AT, null);
    }
    expect(validateReviewRecord(r)).toEqual([]); // the record itself is well-formed …
    const res = await exported(r, run);
    expect(res.record.tables.map((t) => t.name)).toEqual(['Bill 5']); // … but Bill 4 is not ready and is not exported
    expect(values(sheetsOf(res.files[0].bytes).Sheets[UPLOAD_SHEET]!).flat().includes(-200)).toBe(false);
  });

  it('drafts that no longer match their source cells stop the export', async () => {
    const { run, review } = await decided();
    const d = JSON.parse(JSON.stringify(drafts(review, run)));
    d.tables[0].drafts[4].descriptionParts[0].text = 'EDITED';
    const res = await createExport({ review, drafts: d, tables: run.extraction.tables, document: run.extraction.document, at: AT, by: BY });
    expect(res.ok ? '' : res.errors.join(' ')).toContain('did not pass the check against their source cells');
  });

  it('text longer than one Excel cell allows stops the writing: no file is produced', async () => {
    const { run, review } = await decided();
    const plan = planExport(drafts(review, run), review, run.extraction.tables);
    if (!plan.ok) throw new Error('plan');
    const rows = plan.rows.map((r, n) => (n === 0 ? { ...r, values: { ...r.values, description: 'x'.repeat(32768) } } : r));
    expect(() => buildUploadWorkbook(rows, { sourceFile: 'SYNTHETIC.xlsx', at: AT })).toThrow(WorkbookWriteError);
  });

  it('the read-back check catches a workbook that differs from what was meant (changed, blank turned 0, formula)', async () => {
    const { run, review } = await decided();
    const res = await exported(review, run);
    const plan = planExport(drafts(review, run), review, run.extraction.tables);
    if (!plan.ok) throw new Error('plan');
    const tamper = (edit: (ws: XLSX.WorkSheet) => void) => {
      const wb = XLSX.read(res.files[0].bytes, { type: 'array' });
      edit(wb.Sheets[UPLOAD_SHEET]!);
      return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
    };
    expect(await checkUploadWorkbook(res.files[0].bytes, plan.rows)).toEqual([]);
    expect((await checkUploadWorkbook(tamper((ws) => (ws['G2'] = { t: 's', v: 'EDITED' })), plan.rows)).join(' ')).toContain('expected');
    expect((await checkUploadWorkbook(tamper((ws) => (ws['J3'] = { t: 'n', v: 0 })), plan.rows)).join(' ')).toContain('should be blank');
    expect((await checkUploadWorkbook(tamper((ws) => (ws['K2'] = { t: 'n', v: 0, f: 'I2*J2' })), plan.rows)).join(' ')).toContain('formula');
  });
});

describe('export history, files and older reviews', () => {
  it('records time, name, tables and both files\' SHA-256; the record passes its checks and survives a backup', async () => {
    const { run, review } = await decided();
    const res = await exported(review, run);
    const e = res.review.history.at(-1)!;
    expect(e).toMatchObject({ action: 'review_exported', by: BY, at: '2000-01-05T09:00:00.000Z' });
    expect(e.exported!.files.map((f) => f.sha256)).toEqual([await sha256Hex(res.files[0].bytes), await sha256Hex(res.files[1].bytes)]);
    expect(e.exported!.tables).toEqual([{ tableId: 'doc-review:sheet:0', name: 'Bill 4', rows: 6 }, { tableId: 'doc-review:sheet:1', name: 'Bill 5', rows: 2 }]);
    expect(validateReviewRecord(res.review)).toEqual([]);
    expect((await readBackup(new TextEncoder().encode(await createBackup(res.review, AT)))).ok).toBe(true);
    const recon = values(sheetsOf(res.files[1].bytes).Sheets['Summary']!).flat();
    expect(recon).toContain(res.files[0].sha256);
  });

  it('the source file is unchanged by exporting', async () => {
    const bytes = draftsBq();
    const copy = bytes.slice();
    const { run, review } = await decided(bytes);
    await exported(review, run);
    expect(bytes).toEqual(copy);
  });

  it('a Stage 2J backup (no row decisions) can be decided and exported in Stage 2L; Stage 2I/2K data still load', async () => {
    const dir = resolve(import.meta.dirname, '../../fixtures/stage2j');
    const read = await readBackup(new Uint8Array(readFileSync(`${dir}/SYNTHETIC_DRAFTS.review-backup.json`)));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const run = await reread(read.review, new Uint8Array(readFileSync(`${dir}/SYNTHETIC_DRAFTS.xlsx`)));
    const res = await exported(decideAllRows(read.review, run), run);
    expect(res.record.tables).toHaveLength(2);
    const old2i = await readBackup(new Uint8Array(readFileSync(resolve(import.meta.dirname, '../../fixtures/stage2i/SYNTHETIC_BQ.review-backup.json'))));
    expect(old2i.ok).toBe(true);
  });
});

describe('Stage 2K data in Stage 2L', () => {
  it('a Stage 2K backup with row decisions imports, reopens and exports without redoing anything', async () => {
    const dir = resolve(import.meta.dirname, '../../fixtures/stage2k');
    const read = await readBackup(new Uint8Array(readFileSync(`${dir}/SYNTHETIC_DRAFTS.review-backup.json`)));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.review.draftRows?.length).toBe(9);
    const run = await reread(read.review, new Uint8Array(readFileSync(`${dir}/SYNTHETIC_DRAFTS.xlsx`)));
    const res = await exported(read.review, run);
    expect(res.record.tables.map((t) => [t.name, t.rows])).toEqual([['Bill 4', 6], ['Bill 5', 2]]);
    expect(validateReviewRecord(res.review)).toEqual([]);
  });
});
