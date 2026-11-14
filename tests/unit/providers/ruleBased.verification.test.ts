/**
 * Stage 2G — the provider's answers against the evidence verifier: real answers pass; altered
 * answers (bad citations, misquotes, invented figures, claimed approval, extra fields, invalid
 * alternatives or labels) are rejected. SYNTHETIC — NOT REAL COST DATA.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { verifyInterpretation } from '../../../src/core/evidence/index.ts';
import { addSourceDocument } from '../../../src/core/models/index.ts';
import { RULE_BASED_INFO } from '../../../src/providers/rule-based/index.ts';
import type { Interpretation } from '../../../src/providers/types.ts';
import { runAll, tableNamed } from '../../helpers/runProvider.ts';
import * as L from '../../helpers/synthetic/bqLayouts.ts';

let loaded: L.Loaded;
let run: Awaited<ReturnType<typeof runAll>>;
let ctx: Parameters<typeof verifyInterpretation>[1];

beforeAll(async () => {
  loaded = await L.load(L.conventionalBq(), 'SYNTHETIC_BQ.xlsx');
  run = await runAll(loaded);
  ctx = { project: loaded.project, tables: loaded.ctx.tables, documentId: loaded.ctx.document.id, provider: RULE_BASED_INFO };
});

const blocking = (a: unknown, c = ctx) => verifyInterpretation(a as Interpretation, c).findings.filter((f) => f.severity === 'blocking').map((f) => f.code);
const copy = <T>(x: T) => structuredClone(x) as unknown as Record<string, unknown> & { value: Record<string, unknown>; evidence: Record<string, unknown>[]; quotedText?: string[]; alternatives?: Record<string, unknown>[] };
const columnAnswer = () => run.columns.find((c) => c.value.tableId === tableNamed(loaded, 'Bill 2').id && c.value.role === 'quantity')!;
const rowAnswer = (excelRow: number) => run.rows.find((r) => r.value.tableId === tableNamed(loaded, 'Bill 2').id && r.value.rowIndex === L.R(excelRow))!;

describe('every real answer cites valid cells and passes', () => {
  it('all answers: no blocking findings, and every citation is a real cell of this document', () => {
    for (const a of run.all) {
      expect(blocking(a), a.decisionKind).toEqual([]);
      for (const ref of a.evidence) {
        const table = loaded.ctx.tables.find((t) => t.id === ref.tableId)!;
        expect(table.documentId).toBe(loaded.ctx.document.id);
        const row = table.rows.find((r) => r.rowIndex === ref.rowIndex)!;
        expect(row).toBeDefined();
        if (ref.columnIndex !== undefined) expect(row.cells.some((c) => c.columnIndex === ref.columnIndex)).toBe(true);
      }
    }
  });
});

describe('altered answers are rejected', () => {
  it('no citations', () => {
    const a = copy(columnAnswer());
    a.evidence = [];
    delete a.quotedText;
    expect(blocking(a)).toEqual(expect.arrayContaining(['NO_EVIDENCE']));
  });

  it('a citation to a cell that does not exist', () => {
    const a = copy(columnAnswer());
    a.evidence[0]!['rowIndex'] = 999;
    expect(blocking(a)).toContain('CITED_CELL_NOT_FOUND');
  });

  it('a citation to a cell of another document', async () => {
    const other = await L.load(L.workingFile(), 'SYNTHETIC_OTHER.xlsx');
    const otherDoc = { ...other.extraction.document, id: 'doc-other' };
    const otherTables = other.extraction.tables.map((t) => ({ ...t, id: `other:${t.id}`, documentId: 'doc-other' }));
    const project = addSourceDocument(loaded.project, otherDoc);
    const a = copy(rowAnswer(6));
    a.evidence = [{ tableId: otherTables[0]!.id, rowIndex: 1, columnIndex: 1 }];
    a.quotedText = ['SYNTHETIC excavation to pile caps'];
    expect(blocking(a, { ...ctx, project, tables: [...loaded.ctx.tables, ...otherTables] })).toEqual(expect.arrayContaining(['WRONG_DOCUMENT']));
  });

  it('misquoted source text', () => {
    const a = copy(rowAnswer(6));
    a.quotedText![1] = 'SYNTHETIC excavation for pile caps, depth not exceeding 2.00m';
    expect(blocking(a)).toEqual(['QUOTE_MISMATCH']);
  });

  it('an introduced quantity, rate, amount, unit or description', () => {
    for (const field of ['quantity', 'rate', 'amount', 'unit', 'description']) {
      const a = copy(rowAnswer(11));
      a.value[field] = field === 'description' ? 'Better wording' : 1;
      expect(blocking(a), field).toContain('UNEXPECTED_FIELD');
    }
  });

  it('a claim to be approved', () => {
    const a = copy(columnAnswer());
    a['status'] = 'approved';
    expect(blocking(a)).toContain('NOT_A_PROPOSAL');
  });

  it('fields outside the provider contract', () => {
    const a = copy(columnAnswer());
    a['approvedBy'] = 'someone';
    expect(blocking(a)).toContain('UNEXPECTED_FIELD');
  });

  it('an alternative that adds a figure, repeats the main answer, or has an invalid value', () => {
    const base = copy(rowAnswer(5)); // has alternatives
    const withFigure = copy(base);
    withFigure.alternatives![0]!['value'] = { ...(withFigure.alternatives![0]!['value'] as object), amount: 100 };
    expect(blocking(withFigure)).toContain('UNEXPECTED_FIELD');
    const repeat = copy(base);
    repeat.alternatives![0]!['value'] = repeat.value;
    expect(blocking(repeat)).toContain('INVALID_DECISION');
    const invalid = copy(base);
    invalid.alternatives![0]!['value'] = { ...(invalid.alternatives![0]!['value'] as object), rowClass: 'invented_class' };
    expect(blocking(invalid)).toContain('INVALID_DECISION');
    const extra = copy(base);
    extra.alternatives![0]!['approved'] = true;
    expect(blocking(extra)).toContain('UNEXPECTED_FIELD');
  });

  it('a trade or sub-trade label that is not in the Cost Library taxonomy', () => {
    const trade = copy(run.suggestions.find((s) => s.value.field === 'tradeWork')!);
    trade.value['label'] = '99-invented-trade';
    expect(blocking(trade)).toContain('INVALID_DECISION');
    const sub = copy(run.suggestions.find((s) => s.value.field === 'subTrade')!);
    sub.value['label'] = 'Invented Sub-trade';
    expect(blocking(sub)).toContain('INVALID_DECISION');
  });

  it('a repeated header row that is not cited, or comes before the first header', () => {
    const region = copy(run.regions.find((r) => r.value.tableId === tableNamed(loaded, 'Bill 2').id)!);
    const uncited = copy(region);
    uncited.value['repeatedHeaderRowIndexes'] = [L.R(18), L.R(19)];
    expect(blocking(uncited)).toContain('EVIDENCE_DOES_NOT_COVER_DECISION');
    const before = copy(region);
    before.value['repeatedHeaderRowIndexes'] = [0];
    expect(blocking(before)).toContain('INVALID_DECISION');
  });
});
