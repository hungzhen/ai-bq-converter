/**
 * Stage 2K — resolving draft-row issues and approving draft rows.
 * SYNTHETIC — NOT REAL COST DATA.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { reopenProposal } from '../../../src/core/evidence/index.ts';
import { type SavedReview, recordChanges, validateReviewRecord } from '../../../src/core/review/index.ts';
import {
  DraftRowDecisionError,
  type DraftResult,
  type TableDrafts,
  bulkApproveDraftRows,
  decideDraftRow,
  orphanedRowDecisions,
  reopenDraftRow,
  resolveDraftIssue,
  tableReadiness,
  viewRow,
  withdrawDraftResolution,
} from '../../../src/core/staging/index.ts';
import { sha256HexSync } from '../../../src/lib/sha256Sync.ts';
import { draftsBq } from '../../helpers/synthetic/draftLayouts.ts';
import { editable, newReview, renumber } from '../../helpers/reviews.ts';
import { AT, approveAll, correct, drafts, proposalOf, withProject } from '../../helpers/drafts.ts';

const SHEET4 = 'doc-review:sheet:0';
const SHEET5 = 'doc-review:sheet:1';
const BY = 'Synthetic Reviewer';

async function setup() {
  const { run, review } = await newReview(draftsBq(), 'SYNTHETIC_DRAFTS.xlsx');
  return { run, review: withProject(approveAll(review)) };
}
const table = (d: DraftResult, name: string) => d.tables.find((t) => t.name === name)!;
const draftAt = (t: TableDrafts, excelRow: number) => t.drafts.find((d) => d.itemRowIndex === excelRow - 1)!;
const stateOf = (r: SavedReview, id: string) => r.draftRows?.find((s) => s.draftId === id) ?? null;
const issueId = (t: TableDrafts, excelRow: number, code: string, field?: string) =>
  draftAt(t, excelRow).row.issues.find((i) => i.code === code && (field === undefined || i.field === field))!.id;

describe('synchronous SHA-256', () => {
  it('matches the standard algorithm', () => {
    for (const text of ['', 'abc', 'SYNTHETIC — NOT REAL COST DATA', 'x'.repeat(1000)]) {
      expect(sha256HexSync(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
    }
  });
});

describe('decision 1 — a placeholder is resolved only by confirming the document does not state it', () => {
  it('records the note; the value stays a placeholder (never a zero or a figure); the row can then be approved', async () => {
    const { run, review } = await setup();
    const t = table(drafts(review, run), 'Bill 4');
    const b = draftAt(t, 5); // rate and amount empty
    let r = resolveDraftIssue(review, b, issueId(t, 5, 'REQUIRED_FIELD_NOT_IN_SOURCE', 'rate'), 'Rate not given in the synthetic BQ.', AT, BY);
    expect(() => decideDraftRow(r, b, 'approved', 'warnings seen', AT, BY)).toThrow(/1 blocking issue/);
    r = resolveDraftIssue(r, b, issueId(t, 5, 'REQUIRED_FIELD_NOT_IN_SOURCE', 'amount'), 'Amount not given either.', AT, BY);
    const view = viewRow(b, stateOf(r, b.row.id));
    expect(view.unresolvedBlocking).toEqual([]);
    expect(view.blocking.map((x) => x.resolution?.kind)).toEqual(['confirmed_not_stated', 'confirmed_not_stated']);
    // The value is untouched: still a placeholder, still not a zero.
    const again = draftAt(table(drafts(r, run), 'Bill 4'), 5).row;
    expect(again.placeholders.map((p) => p.field)).toEqual(['rate', 'amount']);
    expect(again.evidence.rate.state).not.toBe('zero');
    expect(view.summary['Rate']).toBe('not stated (empty)');
    // Warnings (the empty cells) need an acknowledging note at approval.
    expect(() => decideDraftRow(r, b, 'approved', null, AT, BY)).toThrow(/warning/);
    r = decideDraftRow(r, b, 'approved', 'Empty cells acknowledged.', AT, BY);
    expect(stateOf(r, b.row.id)!.decision).toMatchObject({ status: 'approved', note: 'Empty cells acknowledged.', acknowledgedWarnings: expect.arrayContaining([expect.stringContaining('SOURCE_VALUE_MISSING')]) });
    expect(validateReviewRecord(r)).toEqual([]);
  });

  it('a resolution needs a note; an issue cannot be resolved twice', async () => {
    const { run, review } = await setup();
    const t = table(drafts(review, run), 'Bill 4');
    const id = issueId(t, 5, 'REQUIRED_FIELD_NOT_IN_SOURCE', 'rate');
    expect(() => resolveDraftIssue(review, draftAt(t, 5), id, '   ', AT, BY)).toThrow(/needs a note/);
    const r = resolveDraftIssue(review, draftAt(t, 5), id, 'Not stated.', AT, BY);
    expect(() => resolveDraftIssue(r, draftAt(t, 5), id, 'Again.', AT, BY)).toThrow(/already resolved/);
  });
});

describe('decision 2 — a negative row can only be excluded', () => {
  it('the negative issue cannot be resolved, the row cannot be approved, exclusion keeps -200 and its evidence', async () => {
    const { run, review } = await setup();
    const t = table(drafts(review, run), 'Bill 4');
    const d = draftAt(t, 7);
    expect(() => resolveDraftIssue(review, d, issueId(t, 7, 'NEGATIVE_VALUE', 'amount'), 'It is a credit.', AT, BY)).toThrow(/negative value cannot be resolved/);
    expect(() => decideDraftRow(review, d, 'approved', 'It is a credit.', AT, BY)).toThrow(/cannot be approved/);
    expect(() => decideDraftRow(review, d, 'excluded', '', AT, BY)).toThrow(/needs a note/);
    const r = decideDraftRow(review, d, 'excluded', 'Credit: the Cost Library import would turn it positive.', AT, BY);
    const after = draftAt(table(drafts(r, run), 'Bill 4'), 7);
    expect(after.row.item).toMatchObject({ rate: -200, amount: -200 });
    expect(after.row.evidence.amount).toMatchObject({ raw: -200, parsed: -200 });
    expect(JSON.stringify(after)).toBe(JSON.stringify(d)); // exclusion never alters the draft row
    expect(viewRow(after, stateOf(r, d.row.id)).effective).toBe('excluded');
    expect(r.history.at(-1)).toMatchObject({ action: 'row_excluded', note: 'Credit: the Cost Library import would turn it positive.' });
  });
});

describe('decision 3 — bulk approval only for rows with no issues at all', () => {
  it('approves the issue-free rows and skips every row with any issue', async () => {
    const { run, review } = await setup();
    const d = drafts(review, run);
    const all = d.tables.flatMap((t) => t.drafts);
    const { review: r, approved, skipped } = bulkApproveDraftRows(review, all, AT, BY);
    const clean = all.filter((x) => x.row.issues.length === 0).map((x) => x.row.id);
    expect(approved).toEqual(clean);
    expect(approved.length).toBeGreaterThan(0);
    expect(skipped.every((s) => s.reason.startsWith('has '))).toBe(true);
    expect(skipped.length).toBe(all.length - clean.length);
    expect(validateReviewRecord(r)).toEqual([]);
    expect(bulkApproveDraftRows(r, all, AT, BY).approved).toEqual([]); // already decided
  });

  it('a row with only project issues (no name/year entered) is not bulk-approved', async () => {
    const { run, review } = await newReview(draftsBq(), 'SYNTHETIC_DRAFTS.xlsx');
    const r = approveAll(review);
    expect(bulkApproveDraftRows(r, drafts(r, run).tables.flatMap((t) => t.drafts), AT, BY).approved).toEqual([]);
  });
});

describe('decision 4 — changed rows make approvals and resolutions outdated', () => {
  async function changedAmountColumn() {
    const { run, review } = await setup();
    const t = table(drafts(review, run), 'Bill 4');
    let r = resolveDraftIssue(review, draftAt(t, 5), issueId(t, 5, 'REQUIRED_FIELD_NOT_IN_SOURCE', 'rate'), 'Not stated.', AT, BY);
    r = decideDraftRow(r, draftAt(t, 8), 'approved', null, AT, BY); // E: no issues
    // A review decision changes: column F is no longer the Amount column.
    const col = proposalOf(r, 'columnRole', { tableId: SHEET4, columnIndex: 5 });
    r = recordChanges(r, [{ before: col, after: reopenProposal(col) }], AT, null);
    r = correct(r, run, r.proposals.find((p) => p.id === col.id)!, { tableId: SHEET4, columnIndex: 5, role: 'ignore' });
    return { run, r, before: t };
  }

  it('shows them as outdated with what changed; the earlier records stay in the history', async () => {
    const { run, r } = await changedAmountColumn();
    const t = table(drafts(r, run), 'Bill 4');
    const e = viewRow(draftAt(t, 8), stateOf(r, draftAt(t, 8).row.id));
    expect(e.effective).toBe('outdated');
    expect(e.decision!.outdated).toBe(true);
    expect(e.decision!.changes.join(' ')).toContain('Amount: "400" → "not stated (no column)"');
    const b = viewRow(draftAt(t, 5), stateOf(r, draftAt(t, 5).row.id));
    expect(b.blocking.find((x) => x.issue.field === 'rate')).toMatchObject({ outdated: true });
    expect(b.unresolvedBlocking.map((i) => i.field)).toContain('rate');
    expect(r.history.filter((h) => h.action === 'row_approved' || h.action === 'row_issue_resolved')).toHaveLength(2);
    expect(validateReviewRecord(r)).toEqual([]);
  });

  it('must be redone: approving again needs the blocking issues resolved again (here: now a missing amount)', async () => {
    const { run, r } = await changedAmountColumn();
    const t = table(drafts(r, run), 'Bill 4');
    const e = draftAt(t, 8);
    expect(() => decideDraftRow(r, e, 'approved', 'again', AT, BY)).toThrow(/blocking issue/);
    const r2 = decideDraftRow(resolveDraftIssue(r, e, issueId(t, 8, 'REQUIRED_FIELD_NOT_IN_SOURCE', 'amount'), 'Amount column ignored on purpose.', AT, BY), e, 'approved', 'Redone.', AT, BY);
    expect(viewRow(e, stateOf(r2, e.row.id)).effective).toBe('approved');
    expect(r2.history.filter((h) => h.draftRow?.draftId === e.row.id).map((h) => h.action)).toEqual(['row_approved', 'row_issue_resolved', 'row_approved']);
  });

  it('a row that no longer exists keeps its decisions in the history and is listed, not applied', async () => {
    const { run, review } = await setup();
    const t = table(drafts(review, run), 'Bill 5');
    let r = decideDraftRow(review, draftAt(t, 4), 'approved', null, AT, BY);
    const cls = proposalOf(r, 'rowClass', { tableId: SHEET5, rowIndex: 3 });
    r = recordChanges(r, [{ before: cls, after: reopenProposal(cls) }], AT, null);
    r = correct(r, run, r.proposals.find((p) => p.id === cls.id)!, { tableId: SHEET5, rowIndex: 3, rowClass: 'note' });
    expect(orphanedRowDecisions(drafts(r, run), r).map((s) => s.draftId)).toEqual([draftAt(t, 4).row.id]);
  });

  it('project details are not source content: entering or changing them does not outdate approvals', async () => {
    const { run, review } = await setup();
    const e = draftAt(table(drafts(review, run), 'Bill 4'), 8);
    const r = withProject(decideDraftRow(review, e, 'approved', null, AT, BY), { name: 'SYNTHETIC RENAMED', year: '2025 Q2', projectRef: null, location: null });
    expect(viewRow(draftAt(table(drafts(r, run), 'Bill 4'), 8), stateOf(r, e.row.id)).effective).toBe('approved');
  });
});

describe('decision 5 — blocking issues individually; warnings by the approval note', () => {
  it('continuation values not used: resolved individually, then approved', async () => {
    const { run, review: r0 } = await setup();
    const cls = proposalOf(r0, 'rowClass', { tableId: SHEET4, rowIndex: 10 });
    const lvl = proposalOf(r0, 'hierarchy', { tableId: SHEET4, rowIndex: 10 });
    let r = recordChanges(r0, [{ before: cls, after: reopenProposal(cls) }, { before: lvl, after: reopenProposal(lvl) }], AT, null);
    r = correct(r, run, r.proposals.find((p) => p.id === cls.id)!, { tableId: SHEET4, rowIndex: 10, rowClass: 'continuation' });
    r = correct(r, run, r.proposals.find((p) => p.id === lvl.id)!, { tableId: SHEET4, rowIndex: 10, level: 'continuation', parentRowIndex: 9 });
    const t = table(drafts(r, run), 'Bill 4');
    const f = draftAt(t, 10);
    r = resolveDraftIssue(r, f, issueId(t, 10, 'CONTINUATION_VALUES_NOT_USED'), 'The "3" is a page note, not a quantity.', AT, BY);
    r = decideDraftRow(r, f, 'approved', null, AT, BY);
    expect(viewRow(f, stateOf(r, f.row.id)).effective).toBe('approved');
    expect(f.row.item.quantity).toBe(25);
  });
});

describe('changing decisions and history integrity', () => {
  it('reopen and withdraw keep the earlier records; withdrawing under an approval is refused', async () => {
    const { run, review } = await setup();
    const t = table(drafts(review, run), 'Bill 4');
    const c = draftAt(t, 6); // LS: quantity and rate placeholders
    let r = resolveDraftIssue(review, c, issueId(t, 6, 'REQUIRED_FIELD_NOT_IN_SOURCE', 'quantity'), 'Lump sum: no quantity stated.', AT, BY);
    r = resolveDraftIssue(r, c, issueId(t, 6, 'REQUIRED_FIELD_NOT_IN_SOURCE', 'rate'), 'Lump sum: no rate stated.', AT, BY);
    r = decideDraftRow(r, c, 'approved', 'Lump sum acknowledged.', AT, BY);
    expect(() => withdrawDraftResolution(r, c, issueId(t, 6, 'REQUIRED_FIELD_NOT_IN_SOURCE', 'rate'), AT, BY)).toThrow(DraftRowDecisionError);
    expect(() => decideDraftRow(r, c, 'excluded', 'x', AT, BY)).toThrow(/Change that decision first/);
    r = reopenDraftRow(r, c.row.id, AT, BY);
    r = withdrawDraftResolution(r, c, issueId(t, 6, 'REQUIRED_FIELD_NOT_IN_SOURCE', 'rate'), AT, BY);
    r = decideDraftRow(r, c, 'needs_changes', 'Check the rate with the QS.', AT, BY);
    expect(r.history.filter((h) => h.draftRow).map((h) => h.action)).toEqual(['row_issue_resolved', 'row_issue_resolved', 'row_approved', 'row_decision_reopened', 'row_resolution_withdrawn', 'row_needs_changes']);
    expect(validateReviewRecord(r)).toEqual([]);
  });

  it('row decisions edited outside the app fail the checks', async () => {
    const { run, review } = await setup();
    const t = table(drafts(review, run), 'Bill 4');
    const r = decideDraftRow(review, draftAt(t, 7), 'excluded', 'Negative credit.', AT, BY);
    const a = editable(r);
    a['draftRows'][0]['decision']['status'] = 'approved';
    expect(validateReviewRecord(a).join(' ')).toContain('do not match the last decisions recorded in the history');
    const b = editable(r);
    b['history'] = b['history'].filter((e: { action: string }) => e.action !== 'row_excluded');
    expect(validateReviewRecord(renumber(b)).join(' ')).toContain('have no entry in the history');
    const c = editable(r);
    c['draftRows'][0]['decision']['note'] = ' ';
    c['history'].at(-1)['draftRow']['next']['decision']['note'] = ' ';
    expect(validateReviewRecord(c).join(' ')).toContain('excluding a row needs a note');
    const d = editable(r);
    d['draftRows'][0]['resolutions'] = [{ issueId: `${draftAt(t, 7).row.id}:NEGATIVE_VALUE:amount`, kind: 'confirmed_not_stated', by: null, at: AT, note: 'x', rowFingerprint: 'a'.repeat(64), contentSummary: {} }];
    expect(validateReviewRecord(d).join(' ')).toContain('cannot resolve issue');
  });

  it('an approval stored for a row with an unresolved blocking issue is never shown as approved', async () => {
    const { run, review } = await setup();
    const t = table(drafts(review, run), 'Bill 4');
    const d = draftAt(t, 7);
    const view = viewRow(d, { draftId: d.row.id, resolutions: [], decision: { status: 'approved', by: null, at: AT, note: 'forged', acknowledgedWarnings: [], rowFingerprint: viewRow(d, null).fingerprint, contentSummary: viewRow(d, null).summary } });
    expect(view.effective).toBe('outdated');
    expect(view.decision!.changes[0]).toContain('not valid');
  });
});

describe('table readiness (shown only — nothing is exported)', () => {
  it('ready for export only when every draft row is approved or excluded and the project details are complete', async () => {
    const { run, review } = await setup();
    let r = review;
    const t5 = table(drafts(r, run), 'Bill 5');
    expect(tableReadiness(t5, r, []).readyForExport).toBe(false);
    for (const d of t5.drafts) r = decideDraftRow(r, d, 'approved', null, AT, BY);
    const ready = tableReadiness(table(drafts(r, run), 'Bill 5'), r, []);
    expect(ready).toMatchObject({ readyForExport: true, counts: { approved: 2 } });
    expect(tableReadiness(table(drafts(r, run), 'Bill 5'), r, [{ code: 'PROJECT_YEAR_NOT_ENTERED', message: '' }]).readyForExport).toBe(false);
  });
});
