/**
 * Stage 2H — the pipeline: file → format → extraction → source references → interpretation →
 * verification → proposals. SYNTHETIC — NOT REAL COST DATA.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { approvedDecisions, reviewState } from '../../../src/core/evidence/index.ts';
import { type PipelineSuccess, STAGES, runPipeline } from '../../../src/core/pipeline/runPipeline.ts';
import { createRuleBasedProvider } from '../../../src/providers/rule-based/index.ts';
import type { InterpretationProvider } from '../../../src/providers/types.ts';
import * as L from '../../helpers/synthetic/bqLayouts.ts';
import { passwordProtectedFile, syntheticBqXls, syntheticBqXlsx, utf8 } from '../../helpers/synthetic/spreadsheets.ts';

const provider = createRuleBasedProvider();
const run = (bytes: Uint8Array, fileName: string, p: InterpretationProvider = provider, options = {}) =>
  runPipeline({ bytes, fileName, documentId: 'doc-pipeline', uploadedAt: '2000-01-01T00:00:00.000Z' }, p, options);

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

describe('successful runs', () => {
  it.each([
    ['SYNTHETIC_BQ.xlsx', L.conventionalBq, 'xlsx'],
    ['SYNTHETIC_BQ.xls', syntheticBqXls, 'xls'],
    ['SYNTHETIC.csv', () => utf8('Item,Description,Unit,Qty,Rate,Amount\nA,SYNTHETIC blockwork wall,m2,10,30.00,300.00\n'), 'csv'],
  ] as const)('%s: every stage done, proposals verified, none approved', async (fileName, build, format) => {
    const result = await run(build(), fileName);
    expect(result.ok).toBe(true);
    const r = result as PipelineSuccess;
    expect(r.stages.map((s) => [s.stage, s.status])).toEqual(STAGES.map((s) => [s.name, 'done']));
    expect(r.extraction.format).toBe(format);
    expect(r.proposals.length).toBeGreaterThan(0);
    expect(r.verification.failed).toBe(0);
    expect(new Set(r.proposals.map(reviewState))).toEqual(new Set(['verified']));
    expect(approvedDecisions(r.proposals)).toEqual([]);
  });

  it('reads every worksheet, including hidden and very hidden ones, and interprets them', async () => {
    const r = (await run(syntheticBqXlsx(), 'SYNTHETIC_BQ.xlsx')) as PipelineSuccess;
    expect(r.extraction.sheets.map((s) => s.visibility)).toEqual(['visible', 'visible', 'visible', 'hidden', 'very_hidden', 'visible']);
    const hiddenTable = r.extraction.tables.find((t) => t.origin.kind === 'worksheet' && t.origin.visibility === 'hidden')!;
    expect(r.proposals.some((p) => (p.interpretation.value as { tableId?: string }).tableId === hiddenTable.id)).toBe(true);
  });

  it('a hidden working-file sheet is interpreted too', async () => {
    const r = (await run(L.workingFile(), 'SYNTHETIC_WORKING.xlsx')) as PipelineSuccess;
    const hidden = r.extraction.tables.find((t) => t.origin.kind === 'worksheet' && t.origin.visibility === 'hidden')!;
    expect(r.proposals.filter((p) => p.interpretation.decisionKind === 'columnRole' && (p.interpretation.value as { tableId: string }).tableId === hidden.id).length).toBeGreaterThan(0);
  });

  it('the CSV settings reach the extractor', async () => {
    const r = await run(utf8('a;b\n1;2\n'), 'SYNTHETIC.csv', provider, { csv: { delimiter: ';' } });
    expect(r.ok && r.extraction.csv?.delimiterSource).toBe('chosen');
  });
});

describe('failures stop the pipeline with a clear message', () => {
  it('an empty file stops at file selection', async () => {
    const r = await run(new Uint8Array(0), 'SYNTHETIC.xlsx');
    expect(r).toMatchObject({ ok: false, failedStage: 'file_selection', code: 'EMPTY_FILE' });
  });

  it('an unsupported file stops at format detection; later stages are marked "not run"', async () => {
    const r = await run(utf8('%PDF-1.4'), 'SYNTHETIC.pdf');
    expect(r).toMatchObject({ ok: false, failedStage: 'format_detection', code: 'UNSUPPORTED_FORMAT' });
    expect(r.stages.filter((s) => s.status === 'not_run').map((s) => s.stage)).toEqual(['extraction', 'source_references', 'interpretation', 'verification', 'proposals']);
  });

  it('a password-protected workbook stops at extraction', async () => {
    expect(await run(passwordProtectedFile(), 'SYNTHETIC_LOCKED.xlsx')).toMatchObject({ ok: false, failedStage: 'extraction', code: 'PASSWORD_PROTECTED' });
  });

  it('an ambiguous CSV stops at extraction with its code (so the screen can offer CSV settings)', async () => {
    expect(await run(utf8('a,b;c,d\ne,f;g,h\n'), 'SYNTHETIC.csv')).toMatchObject({ ok: false, failedStage: 'extraction', code: 'CSV_DELIMITER_AMBIGUOUS' });
  });

  it('a provider that crashes stops at interpretation — nothing half-done is shown', async () => {
    const broken: InterpretationProvider = { ...provider, classifyDocument: async () => { throw new Error('synthetic failure'); } };
    const r = await run(L.conventionalBq(), 'SYNTHETIC_BQ.xlsx', broken);
    expect(r).toMatchObject({ ok: false, failedStage: 'interpretation' });
    expect(r.ok ? '' : r.message).toContain('synthetic failure');
  });
});

describe('evidence verification is never bypassed', () => {
  it('an answer that fails verification is kept and marked "failed verification" (never approvable)', async () => {
    const misquoting: InterpretationProvider = {
      ...provider,
      async mapColumns(ctx, regions) {
        const answers = await provider.mapColumns(ctx, regions);
        return answers.map((a, n) => (n === 0 ? { ...a, quotedText: a.quotedText?.map(() => 'MISQUOTED') } : a));
      },
    };
    const r = (await run(L.conventionalBq(), 'SYNTHETIC_BQ.xlsx', misquoting)) as PipelineSuccess;
    expect(r.ok).toBe(true);
    expect(r.verification.failed).toBe(1);
    const bad = r.proposals.find((p) => !p.verification.ok)!;
    expect(reviewState(bad)).toBe('failed_verification');
    expect(bad.verification.findings.map((f) => f.code)).toContain('QUOTE_MISMATCH');
    expect(r.stages.find((s) => s.stage === 'verification')!.message).toContain('FAILED');
  });
});

describe('original data is never changed', () => {
  it('the uploaded bytes and the extracted tables stay identical', async () => {
    const bytes = L.conventionalBq();
    const before = sha(bytes);
    const r = (await run(bytes, 'SYNTHETIC_BQ.xlsx')) as PipelineSuccess;
    expect(sha(bytes)).toBe(before);
    expect(r.extraction.document.sha256).toBe(before);
    const tablesBefore = JSON.stringify(r.extraction.tables);
    // running the provider again over the same tables changes nothing
    await createRuleBasedProvider().classifyRows({ project: r.project, document: r.extraction.document, tables: r.extraction.tables }, []);
    expect(JSON.stringify(r.extraction.tables)).toBe(tablesBefore);
    expect(Object.isFrozen(r.extraction.tables[1]!.rows[5]!.cells[0])).toBe(true);
  });
});
