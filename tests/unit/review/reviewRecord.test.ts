/**
 * Stage 2I — the saved review: original proposals, decisions and an append-only history.
 * SYNTHETIC — NOT REAL COST DATA.
 */
import { describe, expect, it } from 'vitest';
import { approveProposal, correctProposal, rejectProposal, reopenProposal } from '../../../src/core/evidence/index.ts';
import { historyOf, recordChanges, reviewCounts } from '../../../src/core/review/index.ts';
import { RULE_BASED_INFO } from '../../../src/providers/rule-based/index.ts';
import { newReview, rowOf } from '../../helpers/reviews.ts';

const AT = '2000-01-02T10:00:00.000Z';

describe('a new saved review', () => {
  it('keeps the document identity, the original proposals with evidence, and a "created" history', async () => {
    const { run, review } = await newReview();
    expect(review.document).toEqual(run.extraction.document);
    expect(review.document.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(review.proposals).toEqual(run.proposals); // original proposals, evidence and verification included
    expect(review.proposals[0]!.interpretation.quotedText?.length).toBeGreaterThan(0);
    expect(review.history[0]).toMatchObject({ sequence: 1, action: 'review_created', by: 'Synthetic Reviewer' });
    expect(review.history.filter((e) => e.action === 'proposal_created')).toHaveLength(run.proposals.length);
    expect(review.sheets.map((s) => s.name)).toEqual(['Cover', 'Bill 2', 'Bill 3']);
    expect(reviewCounts(review)).toMatchObject({ approved: 0, rejected: 0, unresolved: run.proposals.length });
  });
});

describe('every decision is recorded in the history', () => {
  it('approval with warnings and an alternative: warning acknowledged, alternative chosen, approved — with name and note', async () => {
    const { review } = await newReview();
    const p = rowOf(review, 1, 5); // sub-heading: alternatives + low-confidence warning
    const after = approveProposal(p, { by: 'Synthetic Reviewer', at: AT, note: 'Third-level heading.' }, 0);
    const r = recordChanges(review, [{ before: p, after }], AT, 'Synthetic Reviewer');
    const events = historyOf(r, p.id).slice(1); // after "proposal_created"
    expect(events.map((e) => e.action)).toEqual(['warning_acknowledged', 'alternative_chosen', 'approved']);
    expect(events[0]).toMatchObject({ by: 'Synthetic Reviewer', note: 'Third-level heading.', warningCodes: ['LOW_CONFIDENCE'] });
    expect(events[2]!.previous).toEqual({ status: 'proposed' });
    expect(events[2]!.next).toMatchObject({ status: 'approved', chosen: 0, decision: { by: 'Synthetic Reviewer', at: AT, note: 'Third-level heading.' } });
  });

  it('a correction is recorded with its value', async () => {
    const { run, review } = await newReview();
    const p = rowOf(review, 1, 25);
    const ctx = { project: run.project, tables: run.extraction.tables, documentId: run.extraction.document.id };
    const after = correctProposal(p, { by: null, at: AT, note: 'A heading.' }, { ...(p.interpretation.value as object), rowClass: 'main_heading' } as never, ctx);
    const e = historyOf(recordChanges(review, [{ before: p, after }], AT, null), p.id).at(-1)!;
    expect(e).toMatchObject({ action: 'correction_recorded', by: null, note: 'A heading.' });
    expect(e.next?.correctionValue).toMatchObject({ rowClass: 'main_heading' });
  });

  it('changing a decision keeps the earlier one: approved → reopened → rejected, all in order', async () => {
    const { review } = await newReview();
    const p = rowOf(review, 1, 22);
    const approved = approveProposal(p, { by: 'A', at: AT });
    let r = recordChanges(review, [{ before: p, after: approved }], AT, 'A');
    const reopened = reopenProposal(approved);
    r = recordChanges(r, [{ before: approved, after: reopened }], AT, 'A');
    const rejected = rejectProposal(reopened, { by: 'B', at: AT, note: 'On reflection, no.' });
    r = recordChanges(r, [{ before: reopened, after: rejected }], AT, 'B');
    const events = historyOf(r, p.id);
    expect(events.map((e) => e.action)).toEqual(['proposal_created', 'approved', 'decision_reopened', 'rejected']);
    expect(events[2]!.previous).toMatchObject({ status: 'approved', decision: { by: 'A' } }); // earlier decision kept
    expect(events[3]).toMatchObject({ by: 'B', note: 'On reflection, no.' });
    expect(r.history.map((e) => e.sequence)).toEqual(r.history.map((_, n) => n + 1)); // nothing removed or reordered
    expect(r.proposals.find((x) => x.id === p.id)!.status).toBe('rejected');
  });

  it('recording changes never alters earlier history entries', async () => {
    const { review } = await newReview();
    const before = JSON.stringify(review.history);
    const p = rowOf(review, 1, 22);
    const r = recordChanges(review, [{ before: p, after: rejectProposal(p, { by: null, at: AT }) }], AT, null);
    expect(JSON.stringify(r.history.slice(0, review.history.length))).toBe(before);
    expect(r.providerId).toBe(`${RULE_BASED_INFO.id}@${RULE_BASED_INFO.version}`);
  });
});
