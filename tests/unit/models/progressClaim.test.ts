/** Stage 2C — progress claim records and their link to BQ rows. SYNTHETIC — NOT REAL COST DATA. */
import { describe, expect, it } from 'vitest';
import {
  type ClaimProgress,
  type ProgressClaimRecord,
  ClaimError,
  blankEvidence,
  compareContractFigures,
  confirmBqLink,
  createClaimDocumentRecord,
  createPdfReference,
  createProgressClaimRecord,
  notStatedEvidence,
  numberEvidence,
  rejectBqLink,
  suggestBqLink,
  textEvidence,
  withContractFigureIssues,
} from '../../../src/core/models/index.ts';
import { BQ_XLSX, CLAIM_PDF, NOW, REVIEWER, syntheticPricedRow } from '../../helpers/synthetic/models.ts';

/** Text-layer reference to page 2, line `line` of the synthetic claim PDF. */
const claimAt = (line: number) => ({
  sources: [createPdfReference(CLAIM_PDF, { pageNumber: 2, lineNumber: line, extraction: 'text_layer' })],
  method: 'pdf_text_layer' as const,
});
const n = (value: number, line = 20) => numberEvidence(String(value), value, claimAt(line));
const progress = (previous: number, current: number, cumulative: number): ClaimProgress => ({
  previous: n(previous), current: n(current), cumulative: n(cumulative),
});
const NONE: ClaimProgress = { previous: notStatedEvidence(), current: notStatedEvidence(), cumulative: notStatedEvidence() };

function claimLine(overrides: Partial<Parameters<typeof createProgressClaimRecord>[0]> = {}): ProgressClaimRecord {
  return createProgressClaimRecord({
    id: 'claim-line-1',
    projectId: 'proj-synthetic',
    claimDocumentId: 'claim-doc-5',
    sourceDocumentId: CLAIM_PDF.id,
    sequence: 1,
    asWritten: {
      itemNo: textEvidence('A', 'A', claimAt(20)),
      description: textEvidence('SYNTHETIC CLAIM LINE 001', 'SYNTHETIC CLAIM LINE 001', claimAt(20)),
      unit: textEvidence('m2', 'm2', claimAt(20)),
    },
    contractFiguresInClaim: { quantity: n(10), rate: n(2), amount: n(20) },
    claimedQuantity: progress(2, 3, 5),
    claimedAmount: progress(4, 6, 10),
    percentComplete: progress(20, 30, 50),
    certifiedQuantity: NONE,
    certifiedAmount: progress(4, 5, 9),
    sources: claimAt(20).sources,
    ...overrides,
  });
}

describe('claim document record', () => {
  const doc = createClaimDocumentRecord({
    id: 'claim-doc-5',
    projectId: 'proj-synthetic',
    sourceDocumentId: CLAIM_PDF.id,
    claimReference: textEvidence('Progress Claim No. 5', 'Progress Claim No. 5', claimAt(1)),
    claimDate: textEvidence('01/01/2000', '01/01/2000', claimAt(2)),
    periodEnd: notStatedEvidence(),
    contractorName: textEvidence('SYNTHETIC CONTRACTOR', 'SYNTHETIC CONTRACTOR', claimAt(3)),
    basis: 'claimed_and_certified',
    certification: {
      certificateReference: textEvidence('Cert 5', 'Cert 5', claimAt(40)),
      certifiedDate: notStatedEvidence(),
      certifiedBy: blankEvidence<string>('', claimAt(41)),
      certifiedAmount: n(9, 42),
    },
    relatedBqDocumentIds: [BQ_XLSX.id],
    adjustments: [
      { id: 'adj-ret', kind: 'retention', description: textEvidence('Less retention', 'Less retention', claimAt(43)), amount: numberEvidence('(1.00)', -1, claimAt(43)), sources: claimAt(43).sources },
    ],
  });

  it('keeps the claim reference, dates, contractor and certification with their evidence', () => {
    expect(doc.claimReference.parsed).toBe('Progress Claim No. 5');
    expect(doc.periodEnd.state).toBe('not_stated');
    expect(doc.certification.certifiedBy.state).toBe('blank');
    expect(doc.certification.certifiedAmount.parsed).toBe(9);
    expect(doc.relatedBqDocumentIds).toEqual(['doc-bq-xlsx']);
  });

  it('keeps a negative adjustment (retention) with its sign and reports it', () => {
    expect(doc.adjustments[0]!.amount.parsed).toBe(-1);
    expect(doc.issues.map((i) => [i.code, i.severity])).toEqual([['NEGATIVE_VALUE', 'warning']]);
  });
});

describe('claim line: previous, current and cumulative figures', () => {
  const line = claimLine();

  it('keeps claimed quantities and amounts for previous, current and cumulative', () => {
    expect([line.claimedQuantity.previous.parsed, line.claimedQuantity.current.parsed, line.claimedQuantity.cumulative.parsed]).toEqual([2, 3, 5]);
    expect([line.claimedAmount.previous.parsed, line.claimedAmount.current.parsed, line.claimedAmount.cumulative.parsed]).toEqual([4, 6, 10]);
    expect(line.certifiedAmount.cumulative.parsed).toBe(9);
    expect(line.certifiedQuantity.current.state).toBe('not_stated');
  });

  it('starts unlinked, with an information note', () => {
    expect(line.bqLink).toEqual({ bqRowId: null, status: 'unmatched', method: null, matchedOn: [] });
    expect(line.issues.map((i) => i.code)).toEqual(['CLAIM_NOT_LINKED']);
  });

  it('reports previous + current ≠ cumulative, and keeps the figures as written', () => {
    const wrong = claimLine({ claimedAmount: progress(4, 6, 11) });
    expect(wrong.issues.map((i) => [i.code, i.field])).toContainEqual(['CLAIM_ARITHMETIC_MISMATCH', 'claimedAmount']);
    expect(wrong.claimedAmount.cumulative.parsed).toBe(11);
  });

  it('distinguishes a current claim of ZERO from a BLANK current claim', () => {
    const zero = claimLine({ claimedQuantity: progress(5, 0, 5) });
    const blank = claimLine({ claimedQuantity: { previous: n(5), current: blankEvidence<number>('', claimAt(20)), cumulative: n(5) } });
    expect(zero.claimedQuantity.current).toMatchObject({ state: 'zero', parsed: 0 });
    expect(blank.claimedQuantity.current).toMatchObject({ state: 'blank', parsed: null });
    expect(zero.issues.some((i) => i.code === 'CLAIM_ARITHMETIC_MISMATCH')).toBe(false);
    expect(blank.issues.some((i) => i.code === 'CLAIM_ARITHMETIC_MISMATCH')).toBe(false); // not checked: no current figure
  });

  it('keeps a negative current claim (e.g. a reversal) with its sign', () => {
    const negative = claimLine({ claimedAmount: progress(10, -2, 8) });
    expect(negative.claimedAmount.current.parsed).toBe(-2);
    expect(negative.issues.map((i) => i.field)).toContain('claimedAmount.current');
  });

  it('refuses sources outside the claim document', () => {
    expect(() => claimLine({ sources: syntheticPricedRow().sources })).toThrow(ClaimError);
  });
});

describe('link from a claim line to the original BQ row', () => {
  const bqRow = syntheticPricedRow(10, { quantity: 10, rate: 2, amount: 20 });

  it('is suggested by item number and description, then confirmed by a person', () => {
    const suggested = suggestBqLink(claimLine(), bqRow, 'item_no_and_description', ['item no "A"', 'description']);
    expect(suggested.bqLink).toMatchObject({ bqRowId: 'bq-row-10', status: 'suggested' });
    expect(suggested.issues.some((i) => i.code === 'CLAIM_NOT_LINKED')).toBe(false);

    const confirmed = confirmBqLink(suggested, REVIEWER, NOW);
    expect(confirmed.bqLink).toMatchObject({ status: 'confirmed', decidedBy: REVIEWER });
  });

  it('stores only the BQ row\'s id — never the BQ row itself', () => {
    const linked = suggestBqLink(claimLine(), bqRow, 'item_no', ['item no "A"']);
    expect(JSON.stringify(linked)).not.toContain('SYNTHETIC TEST ITEM 001'); // the BQ description is not copied in
    expect(linked.bqLink.bqRowId).toBe(bqRow.id);
  });

  it('can be rejected, leaving the claim line unmatched', () => {
    const rejected = rejectBqLink(suggestBqLink(claimLine(), bqRow, 'item_no', []));
    expect(rejected.bqLink.status).toBe('unmatched');
    expect(rejected.issues.map((i) => i.code)).toContain('CLAIM_NOT_LINKED');
  });

  it('cannot link to a BQ row of another project, nor confirm a link that was never suggested', () => {
    expect(() => suggestBqLink(claimLine(), { ...bqRow, projectId: 'other' }, 'user', [])).toThrow(ClaimError);
    expect(() => confirmBqLink(claimLine(), REVIEWER, NOW)).toThrow(ClaimError);
  });

  it('reports contract figures that differ from the BQ — on the claim only', () => {
    const differing = suggestBqLink(claimLine({ contractFiguresInClaim: { quantity: n(12), rate: n(2), amount: n(24) } }), bqRow, 'item_no', []);
    expect(compareContractFigures(differing, bqRow).map((d) => [d.field, d.claimValue, d.bqValue])).toEqual([
      ['quantity', 12, 10],
      ['amount', 24, 20],
    ]);
    const withIssues = withContractFigureIssues(differing, bqRow);
    expect(withIssues.issues.filter((i) => i.code === 'CLAIM_CONTRACT_FIGURE_DIFFERS')).toHaveLength(2);
    expect(bqRow.item.quantity).toBe(10); // the BQ keeps its own figure
  });

  it('compares only with the BQ row it is linked to', () => {
    expect(() => compareContractFigures(claimLine(), bqRow)).toThrow(ClaimError);
  });
});
