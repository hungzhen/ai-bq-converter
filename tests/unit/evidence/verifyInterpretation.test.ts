/**
 * Stage 2E — verifying provider answers, including the misbehaviour a future AI provider might show.
 * SYNTHETIC — NOT REAL COST DATA.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { BqRowClass } from '../../../src/core/models/index.ts';
import { BQ_ROW_CLASSES_FOR_CHECKS, verifyInterpretation } from '../../../src/core/evidence/index.ts';
import { type Interpretation, RULE_BASED_LABEL } from '../../../src/providers/types.ts';
import { misbehavingAnswers, SYNTHETIC_RULE_INFO } from '../../helpers/providers.ts';
import { BQ_CSV, BQ_XLSX, CLAIM_PDF, syntheticProject } from '../../helpers/synthetic/models.ts';
import { ALL_TABLES } from '../../helpers/synthetic/tables.ts';

const project = syntheticProject();
const T = 't-bill-1';
const ctx = { project, tables: ALL_TABLES, documentId: BQ_XLSX.id };
const blocking = (i: unknown, c: Parameters<typeof verifyInterpretation>[1] = ctx) =>
  verifyInterpretation(i as Interpretation, c).findings.filter((f) => f.severity === 'blocking').map((f) => f.code);
const all = (i: unknown, c: Parameters<typeof verifyInterpretation>[1] = ctx) =>
  verifyInterpretation(i as Interpretation, c).findings.map((f) => f.code);

const base = { method: 'rule-based', providerId: 'synthetic-test-rules@0.0.1', status: 'proposed', confidence: 0.9, reasoning: 'synthetic rule' } as const;
const good: Record<string, Interpretation> = {
  documentType: { ...base, decisionKind: 'documentType', value: { documentType: 'standard_bq' }, evidence: [{ tableId: T, rowIndex: 0, columnIndex: 3 }], quotedText: ['Qty'] },
  tableRegion: { ...base, decisionKind: 'tableRegion', value: { tableId: T, headerRowIndexes: [0], repeatedHeaderRowIndexes: [], firstDataRowIndex: 1, lastDataRowIndex: 5, include: true }, evidence: [{ tableId: T, rowIndex: 0 }] },
  columnRole: { ...base, decisionKind: 'columnRole', value: { tableId: T, columnIndex: 3, role: 'quantity' }, evidence: [{ tableId: T, rowIndex: 0, columnIndex: 3 }], quotedText: ['Qty'] },
  rowClass: { ...base, decisionKind: 'rowClass', value: { tableId: T, rowIndex: 1, rowClass: 'main_heading' }, evidence: [{ tableId: T, rowIndex: 1, columnIndex: 1 }], quotedText: ['SYNTHETIC SECTION A'] },
  hierarchy: { ...base, decisionKind: 'hierarchy', value: { tableId: T, rowIndex: 2, level: 'item', parentRowIndex: 1 }, evidence: [{ tableId: T, rowIndex: 2 }, { tableId: T, rowIndex: 1 }] },
  classificationSuggestion: { ...base, decisionKind: 'classificationSuggestion', value: { tableId: T, rowIndex: 2, field: 'tradeWork', label: '11-finishes' }, evidence: [{ tableId: T, rowIndex: 2, columnIndex: 1 }] },
  relationship: { ...base, decisionKind: 'relationship', value: { fromDocumentId: CLAIM_PDF.id, toDocumentId: BQ_XLSX.id, kind: 'claim_against' }, evidence: [{ tableId: 't-claim-p2', rowIndex: 0, columnIndex: 0 }, { tableId: T, rowIndex: 2, columnIndex: 0 }] },
  claimMatch: { ...base, decisionKind: 'claimMatch', value: { claimLineId: 'cl-1', bqRowId: 'bq-row-10' }, evidence: [{ tableId: 't-claim-p2', rowIndex: 0, columnIndex: 0 }] },
};
const claimCtx = { ...ctx, claimLineIds: ['cl-1'], bqRowIds: ['bq-row-10'] };

describe('valid answers of every kind pass', () => {
  it.each(Object.keys(good))('%s', (kind) => {
    const report = verifyInterpretation(good[kind]!, claimCtx);
    expect(report.ok).toBe(true);
    expect(report.findings.filter((f) => f.severity !== 'info')).toEqual([]);
  });

  it('the row-class list used for checks is exactly the BqRowClass type', () => {
    expectTypeOf<(typeof BQ_ROW_CLASSES_FOR_CHECKS)[number]>().toEqualTypeOf<BqRowClass>();
  });
});

describe('answers a careless or overreaching interpreter might give are rejected', () => {
  const bad = misbehavingAnswers(T);
  it.each([
    ['claimsApproval', 'NOT_A_PROPOSAL'],
    ['noEvidence', 'NO_EVIDENCE'],
    ['inventsQuantity', 'UNEXPECTED_FIELD'],
    ['inventsRateAndAmount', 'UNEXPECTED_FIELD'],
    ['inventsUnitAndDescription', 'UNEXPECTED_FIELD'],
    ['fakeQuote', 'QUOTE_MISMATCH'],
    ['citesMissingCell', 'CITED_CELL_NOT_FOUND'],
    ['citesMissingTable', 'CITED_TABLE_NOT_FOUND'],
    ['labelIsAFigure', 'LABEL_LOOKS_LIKE_FIGURE'],
    ['extraTopLevelField', 'UNEXPECTED_FIELD'],
  ])('%s → %s', (name, code) => {
    expect(blocking(bad[name])).toContain(code);
  });

  it('every AI answer is marked as a proposal that needs a person\'s approval', () => {
    expect(all({ ...good['rowClass']!, method: 'ai' })).toContain('AI_PROPOSAL');
  });
});

describe('citations must be real, in the right place, and cover the decision', () => {
  it('a table of another document is refused for a single-document decision', () => {
    const answer = { ...good['rowClass']!, evidence: [{ tableId: 't-claim-p2', rowIndex: 0 }] };
    expect(blocking(answer)).toEqual(expect.arrayContaining(['WRONG_DOCUMENT', 'EVIDENCE_DOES_NOT_COVER_DECISION']));
  });

  it('a table whose document is not in the project is refused', () => {
    const outsider = { id: 't-outsider', documentId: 'doc-outsider', origin: { kind: 'csv' as const }, rows: [] };
    const answer = { ...good['documentType']!, evidence: [{ tableId: 't-outsider', rowIndex: 0 }], quotedText: undefined };
    delete (answer as Record<string, unknown>)['quotedText'];
    expect(blocking(answer, { ...ctx, tables: [...ALL_TABLES, outsider] })).toContain('CITED_DOCUMENT_NOT_IN_PROJECT');
  });

  it('a column decision must cite a cell of that column', () => {
    const answer = { ...good['columnRole']!, evidence: [{ tableId: T, rowIndex: 0, columnIndex: 4 }], quotedText: ['Rate'] };
    expect(blocking(answer)).toEqual(['EVIDENCE_DOES_NOT_COVER_DECISION']);
  });

  it('a row decision must cite that row', () => {
    const answer = { ...good['rowClass']!, value: { tableId: T, rowIndex: 2, rowClass: 'priced_item' } };
    expect(blocking(answer)).toEqual(['EVIDENCE_DOES_NOT_COVER_DECISION']);
  });

  it('every header row of a table region must be cited', () => {
    const answer = { ...good['tableRegion']!, value: { tableId: T, headerRowIndexes: [0, 1], repeatedHeaderRowIndexes: [], firstDataRowIndex: 2, lastDataRowIndex: 5, include: true } };
    expect(blocking(answer)).toEqual(['EVIDENCE_DOES_NOT_COVER_DECISION']);
  });

  it('quotes: one per cell, single cells only; spacing differences are noted, not rejected', () => {
    expect(blocking({ ...good['columnRole']!, quotedText: ['Qty', 'Rate'] })).toEqual(['QUOTE_COUNT_MISMATCH']);
    expect(blocking({ ...good['tableRegion']!, quotedText: ['No. Description'] })).toEqual(['QUOTE_MISMATCH']);
    expect(all({ ...good['columnRole']!, quotedText: ['  Qty '] })).toEqual(['QUOTE_SPACING_DIFFERS']);
    expect(blocking({ ...good['columnRole']!, quotedText: ['QTY'] })).toEqual(['QUOTE_MISMATCH']); // capitals matter
  });
});

describe('the decision value itself is checked', () => {
  it.each([
    ['unknown document type', { ...good['documentType']!, value: { documentType: 'invoice' } }],
    ['unknown column role', { ...good['columnRole']!, value: { tableId: T, columnIndex: 3, role: 'guess' } }],
    ['column that does not exist', { ...good['columnRole']!, value: { tableId: T, columnIndex: 40, role: 'quantity' } }],
    ['unknown row class', { ...good['rowClass']!, value: { tableId: T, rowIndex: 1, rowClass: 'probably_item' } }],
    ['unknown hierarchy level', { ...good['hierarchy']!, value: { tableId: T, rowIndex: 2, level: 'chapter', parentRowIndex: 1 } }],
    ['parent after the row', { ...good['hierarchy']!, value: { tableId: T, rowIndex: 2, level: 'item', parentRowIndex: 5 } }],
    ['data range back to front', { ...good['tableRegion']!, value: { tableId: T, headerRowIndexes: [0], repeatedHeaderRowIndexes: [], firstDataRowIndex: 5, lastDataRowIndex: 1, include: true } }],
    ['empty classification label', { ...good['classificationSuggestion']!, value: { tableId: T, rowIndex: 2, field: 'tradeWork', label: ' ' } }],
    ['classification of a non-classification field', { ...good['classificationSuggestion']!, value: { tableId: T, rowIndex: 2, field: 'quantity', label: 'x' } }],
    ['relationship with itself', { ...good['relationship']!, value: { fromDocumentId: BQ_XLSX.id, toDocumentId: BQ_XLSX.id, kind: 'supersedes' } }],
    ['relationship to a document outside the project', { ...good['relationship']!, value: { fromDocumentId: BQ_CSV.id, toDocumentId: 'nope', kind: 'addendum_to' } }],
  ])('%s', (_name, answer) => {
    expect(blocking(answer)).toContain('INVALID_DECISION');
  });

  it('labels that look like figures are refused in any form', () => {
    for (const label of ['1250', '1,250.00', '(50.00)', '0', '5%', '1,25']) {
      expect(blocking({ ...good['classificationSuggestion']!, value: { tableId: T, rowIndex: 2, field: 'costItem', label } })).toContain('LABEL_LOOKS_LIKE_FIGURE');
    }
  });

  it('claim matches must name existing claim lines and BQ rows; without the lists they are flagged', () => {
    expect(blocking({ ...good['claimMatch']!, value: { claimLineId: 'cl-1', bqRowId: 'invented-row' } }, claimCtx)).toContain('INVALID_DECISION');
    expect(all(good['claimMatch']!, ctx)).toContain('CANNOT_CHECK');
  });
});

describe('confidence, reasoning and provider identity', () => {
  it('confidence outside 0–1 is refused; below 0.5 is flagged', () => {
    expect(blocking({ ...good['rowClass']!, confidence: 1.5 })).toEqual(['INVALID_CONFIDENCE']);
    expect(blocking({ ...good['rowClass']!, confidence: Number.NaN })).toEqual(['INVALID_CONFIDENCE']);
    expect(all({ ...good['rowClass']!, confidence: 0.3 })).toContain('LOW_CONFIDENCE');
  });

  it('missing reasoning is flagged', () => {
    expect(all({ ...good['rowClass']!, reasoning: '' })).toContain('NO_REASONING');
  });

  it('an answer must match the provider that produced it', () => {
    const provider = SYNTHETIC_RULE_INFO;
    expect(blocking(good['rowClass']!, { ...ctx, provider })).toEqual([]);
    expect(blocking({ ...good['rowClass']!, providerId: 'someone-else@9' }, { ...ctx, provider })).toEqual(['PROVIDER_MISMATCH']);
    expect(blocking({ ...good['rowClass']!, method: 'ai' }, { ...ctx, provider })).toEqual(['PROVIDER_MISMATCH']);
    expect(provider.displayLabel).toBe(RULE_BASED_LABEL);
  });
});
