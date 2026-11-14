/** Stage 2C — StagedBQRow wrapping FullBQItem. SYNTHETIC — NOT REAL COST DATA. */
import { describe, expect, it } from 'vitest';
import {
  type StagedBQRow,
  ReviewError,
  StagedRowError,
  approveClassificationProposal,
  blankEvidence,
  checkStagedRowIntegrity,
  createCsvReference,
  createStagedBQRow,
  missingEvidence,
  notStatedEvidence,
  numberEvidence,
  rejectClassificationProposal,
  resolveIssue,
  setReviewStatus,
  specialEvidence,
  textEvidence,
  traceField,
  unparseableEvidence,
  unresolvedBlockingIssues,
} from '../../../src/core/models/index.ts';
import { BQ_CSV, BQ_XLSX, COL, NOW, REVIEWER, TODAY, bqCell, fromBq, syntheticPricedRow, syntheticProject } from '../../helpers/synthetic/models.ts';

const ROW = 12;
const cell = (col: number) => fromBq(ROW, col);
const baseEvidence = {
  description: textEvidence('SYNTHETIC TEST ITEM 002', 'SYNTHETIC TEST ITEM 002', cell(COL.description)),
  unit: textEvidence('nr', 'nr', cell(COL.unit)),
  quantity: numberEvidence(4, 4, cell(COL.quantity)),
  rate: numberEvidence(5, 5, cell(COL.rate)),
  amount: numberEvidence(20, 20, cell(COL.amount)),
};

function makeRow(overrides: Partial<typeof baseEvidence> & Record<string, unknown> = {}, extra: Partial<Parameters<typeof createStagedBQRow>[0]> = {}): StagedBQRow {
  return createStagedBQRow({
    id: 'bq-row-12',
    project: syntheticProject(),
    documentId: BQ_XLSX.id,
    rowClass: 'priced_item',
    sequence: ROW,
    sources: [bqCell(ROW)],
    evidence: { ...baseEvidence, ...overrides } as Parameters<typeof createStagedBQRow>[0]['evidence'],
    today: TODAY,
    ...extra,
  });
}

describe('a fully stated priced item', () => {
  const row = syntheticPricedRow(10, { quantity: 10, rate: 2, amount: 20 });

  it('wraps a FullBQItem built only from the evidence', () => {
    expect(row.item).toMatchObject({
      id: 'bq-row-10',
      projectId: 'proj-synthetic',
      projectName: 'SYNTHETIC PROJECT — NOT REAL COST DATA',
      projectYear: '2000 Q1',
      itemNo: 'A',
      description: 'SYNTHETIC TEST ITEM 001',
      unit: 'm2',
      quantity: 10,
      rate: 2,
      amount: 20,
      originalRate: 2,
      originalAmount: 20,
      sourceFile: 'SYNTHETIC_BQ.xlsx',
      sourceReference: 'Sheet: Bill 1 | Row 10',
      sourceRowNumber: 10,
      sourceSequence: 10,
      dateCreated: TODAY,
    });
  });

  it('keeps the unit text exactly as written (no Cost Library normalisation to m²)', () => {
    expect(row.item.unit).toBe('m2');
  });

  it('records no placeholders and no issues, and passes the integrity check', () => {
    expect(row.placeholders).toEqual([]);
    expect(row.issues).toEqual([]);
    expect(checkStagedRowIntegrity(row)).toEqual([]);
  });

  it('starts as "pending review"', () => {
    expect(row.review.status).toBe('pending_review');
  });

  it('never fills actualCost, Trade, Cost Item or Element by itself', () => {
    for (const field of ['actualCost', 'tradeWork', 'subTrade', 'costItem', 'element', 'elementCode'] as const) {
      expect(row.item[field]).toBeUndefined();
    }
  });

  it('can trace every value back to its cell', () => {
    expect(traceField(row, 'amount')).toMatchObject({
      itemValue: 20,
      isPlaceholder: false,
      sources: ['SYNTHETIC_BQ.xlsx | Sheet: Bill 1 | Row 10 | Cell F10'],
    });
  });
});

describe('missing required values are never silently filled', () => {
  it('a BLANK quantity is a recorded placeholder (0) with a warning — not a quantity of 0', () => {
    const row = makeRow({ quantity: blankEvidence('', cell(COL.quantity)) });
    expect(row.item.quantity).toBe(0); // FullBQItem demands a number…
    expect(row.placeholders).toEqual([{ field: 'quantity', placeholder: 0, reason: 'blank' }]); // …so it is recorded
    expect(row.evidence.quantity.state).toBe('blank');
    expect(row.evidence.quantity.parsed).toBeNull();
    expect(row.issues.map((i) => [i.code, i.severity, i.field])).toEqual([['REQUIRED_FIELD_NOT_IN_SOURCE', 'warning', 'quantity']]);
  });

  it('a quantity of ZERO shown in the document is a real value — no placeholder, no issue', () => {
    const row = makeRow({ quantity: numberEvidence('0.00', 0, cell(COL.quantity)), amount: numberEvidence('0.00', 0, cell(COL.amount)) });
    expect(row.item.quantity).toBe(0);
    expect(row.evidence.quantity.state).toBe('zero');
    expect(row.placeholders).toEqual([]);
    expect(row.issues).toEqual([]);
    expect(row.item.originalAmount).toBe(0);
  });

  it('a rate NOT STATED leaves originalRate empty and records the placeholder', () => {
    const row = makeRow({ rate: notStatedEvidence('No rate column.') });
    expect(row.item.originalRate).toBeUndefined();
    expect(row.placeholders).toContainEqual({ field: 'rate', placeholder: 0, reason: 'not_stated' });
  });

  it('a MISSING unit is a recorded empty-text placeholder with two warnings (required field + unreadable)', () => {
    const row = makeRow({ unit: missingEvidence<string>({ ...cell(COL.unit), note: 'Cell outside the extracted range.' }) });
    expect(row.item.unit).toBe('');
    expect(row.placeholders).toContainEqual({ field: 'unit', placeholder: '', reason: 'missing' });
    expect(row.issues.map((i) => i.code).sort()).toEqual(['REQUIRED_FIELD_NOT_IN_SOURCE', 'SOURCE_VALUE_MISSING']);
  });

  it('an UNPARSEABLE amount keeps its text in the evidence and is not turned into a number', () => {
    const row = makeRow({ amount: unparseableEvidence<number>('twenty', cell(COL.amount)) });
    expect(row.evidence.amount.raw).toBe('twenty');
    expect(row.item.originalAmount).toBeUndefined();
    expect(row.issues.map((i) => i.code)).toContain('UNPARSEABLE_VALUE');
  });

  it('a SPECIAL marker ("Rate Only") in the quantity is kept as a marker, not a figure', () => {
    const row = makeRow({ quantity: specialEvidence<number>('Rate Only', 'RATE_ONLY', cell(COL.quantity)) });
    expect(row.evidence.quantity.special).toBe('RATE_ONLY');
    expect(row.placeholders).toContainEqual({ field: 'quantity', placeholder: 0, reason: 'special' });
    expect(row.issues.map((i) => i.code)).toContain('SPECIAL_VALUE');
  });

  it('a heading row without figures gets the same placeholders, reported as information only', () => {
    const row = makeRow(
      { unit: notStatedEvidence(), quantity: notStatedEvidence(), rate: notStatedEvidence(), amount: notStatedEvidence() },
      { rowClass: 'main_heading' },
    );
    expect(row.placeholders.map((p) => p.field)).toEqual(['unit', 'quantity', 'rate', 'amount']);
    expect(row.issues.every((i) => i.severity === 'info')).toBe(true);
    expect(checkStagedRowIntegrity(row)).toEqual([]);
  });

  it('a project year that was not entered is a BLOCKING issue — never assumed', () => {
    const row = makeRow({}, { project: syntheticProject(null) });
    expect(row.item.projectYear).toBe('');
    expect(row.placeholders).toContainEqual({ field: 'projectYear', placeholder: '', reason: 'not_entered' });
    expect(unresolvedBlockingIssues(row).map((i) => i.code)).toEqual(['PROJECT_YEAR_NOT_ENTERED']);
  });

  it('records the entered project year as the person\'s input, not as document data', () => {
    expect(makeRow().evidence.projectYear).toMatchObject({ method: 'user_entered', parsed: '2000 Q1', sources: [] });
  });
});

describe('negative values', () => {
  const row = makeRow({ amount: numberEvidence('(20.00)', -20, cell(COL.amount)) });

  it('keep their sign in the FullBQItem and in originalAmount', () => {
    expect(row.item.amount).toBe(-20);
    expect(row.item.originalAmount).toBe(-20);
    expect(row.evidence.amount.raw).toBe('(20.00)');
  });

  it('raise a BLOCKING issue (D-004)', () => {
    expect(unresolvedBlockingIssues(row).map((i) => [i.code, i.field])).toEqual([['NEGATIVE_VALUE', 'amount']]);
  });

  it('block approval until a person resolves them', () => {
    expect(() => setReviewStatus(row, 'approved', REVIEWER, NOW)).toThrow(ReviewError);
  });

  it('resolving records who and why, but does NOT change the value', () => {
    const issue = row.issues.find((i) => i.code === 'NEGATIVE_VALUE')!;
    const resolved = resolveIssue(row, issue.id, { by: REVIEWER, at: NOW, note: 'Omission item; confirmed negative.' });
    expect(resolved.item.amount).toBe(-20);
    expect(resolved.issues.find((i) => i.id === issue.id)?.resolution?.by).toBe(REVIEWER);
    const approved = setReviewStatus(resolved, 'approved', REVIEWER, NOW);
    expect(approved.review.status).toBe('approved');
    expect(approved.review.history).toHaveLength(1);
  });

  it('a resolution needs a note', () => {
    const issue = row.issues[0]!;
    expect(() => resolveIssue(row, issue.id, { by: REVIEWER, at: NOW, note: ' ' })).toThrow(StagedRowError);
  });

  it('negative values in optional columns (e.g. base amount) are caught too', () => {
    const r = makeRow({ baseAmount: numberEvidence(-3, -3, cell(8)) });
    expect(r.item.baseAmount).toBe(-3);
    expect(r.issues.map((i) => [i.code, i.field])).toContainEqual(['NEGATIVE_VALUE', 'baseAmount']);
  });
});

describe('proposed classifications (Trade, Cost Item, Element) — D-008', () => {
  const proposalRow = makeRow({}, {
    proposals: [
      { id: 'p-trade', field: 'tradeWork', value: '05-concrete-works', method: 'rule-based', providerId: 'rule-based@0.1.0', reason: 'synthetic test rule', sources: [bqCell(ROW, COL.description)], status: 'pending' },
      { id: 'p-cost', field: 'costItem', value: 'SYNTHETIC COST ITEM', method: 'rule-based', providerId: 'rule-based@0.1.0', reason: 'synthetic test rule', sources: [], status: 'pending' },
    ],
  });

  it('a pending proposal leaves the field blank', () => {
    expect(proposalRow.item.tradeWork).toBeUndefined();
    expect(proposalRow.item.costItem).toBeUndefined();
  });

  it('an approved proposal fills the field and records who approved it', () => {
    const approved = approveClassificationProposal(proposalRow, 'p-trade', REVIEWER, NOW);
    expect(approved.item.tradeWork).toBe('05-concrete-works');
    expect(approved.evidence.tradeWork).toMatchObject({ method: 'user_entered', verification: 'user_confirmed' });
    expect(approved.proposals.find((p) => p.id === 'p-trade')).toMatchObject({ status: 'approved', decidedBy: REVIEWER });
    expect(checkStagedRowIntegrity(approved)).toEqual([]);
  });

  it('a rejected proposal leaves the field blank', () => {
    const rejected = rejectClassificationProposal(proposalRow, 'p-cost', REVIEWER, NOW);
    expect(rejected.item.costItem).toBeUndefined();
    expect(rejected.proposals.find((p) => p.id === 'p-cost')?.status).toBe('rejected');
  });

  it('a proposal cannot arrive already approved', () => {
    expect(() =>
      makeRow({}, { proposals: [{ id: 'x', field: 'element', value: 'Frame', method: 'rule-based', providerId: 'r', reason: 'r', sources: [], status: 'approved' }] }),
    ).toThrow(StagedRowError);
  });
});

describe('traceability and immutability', () => {
  it('keeps every contributing source row (an item and its continuation line)', () => {
    const row = makeRow({}, { sources: [bqCell(ROW), bqCell(ROW + 1)] });
    expect(row.sources.map((s) => s.kind === 'worksheet' && s.rowNumber)).toEqual([12, 13]);
  });

  it('refuses evidence or sources from a different document', () => {
    const csvRef = createCsvReference(BQ_CSV, { rowNumber: 1, columnNumber: 2 });
    expect(() => makeRow({}, { sources: [csvRef] })).toThrow(StagedRowError);
    expect(() => makeRow({ description: textEvidence('X', 'X', { sources: [csvRef], method: 'csv_cell' }) })).toThrow(StagedRowError);
  });

  it('a staged row cannot be changed in place', () => {
    const row = syntheticPricedRow();
    expect(() => {
      (row.item as { quantity: number }).quantity = 999;
    }).toThrow(TypeError);
    expect(() => {
      (row.evidence.quantity as { parsed: number }).parsed = 999;
    }).toThrow(TypeError);
    expect(row.item.quantity).toBe(10);
  });

  it('the integrity check detects a value that no longer matches its evidence', () => {
    const tampered = structuredClone(syntheticPricedRow()) as StagedBQRow & { item: { quantity: number; tradeWork?: string } };
    tampered.item.quantity = 11;
    tampered.item.tradeWork = 'unapproved';
    const problems = checkStagedRowIntegrity(tampered);
    expect(problems).toContain('quantity in the item (11) differs from its evidence (10).');
    expect(problems).toContain('tradeWork is filled without an approved proposal.');
  });
});
