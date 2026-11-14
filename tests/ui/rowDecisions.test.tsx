// @vitest-environment jsdom
/**
 * Stage 2K — resolving issues and deciding draft rows on the Draft rows tab, used the way a
 * person would. Every file is SYNTHETIC — NOT REAL COST DATA.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../src/App.tsx';
import { reopenProposal } from '../../src/core/evidence/index.ts';
import { type SavedReview, recordChanges, validateReviewRecord } from '../../src/core/review/index.ts';
import { decideDraftRow } from '../../src/core/staging/index.ts';
import { createMemoryReviewStore } from '../../src/storage/reviewStore.ts';
import { draftsBq } from '../helpers/synthetic/draftLayouts.ts';
import { newReview } from '../helpers/reviews.ts';
import { AT, approveAll, correct, drafts, proposalOf, withProject } from '../helpers/drafts.ts';

afterEach(cleanup);
const TIMEOUT = { timeout: 15000 };
const fileOf = (bytes: Uint8Array, name: string) => new File([bytes.slice().buffer as ArrayBuffer], name);

async function open(prepare: (r: SavedReview, run: Awaited<ReturnType<typeof newReview>>['run']) => SavedReview = (r) => r) {
  const { run, review } = await newReview(draftsBq(), 'SYNTHETIC_DRAFTS.xlsx');
  const store = createMemoryReviewStore([prepare(withProject(approveAll(review)), run)]);
  const user = userEvent.setup({ applyAccept: false });
  render(<App store={store} download={() => {}} />);
  await user.click(within((await screen.findByText('SYNTHETIC_DRAFTS.xlsx', {}, TIMEOUT)).closest('tr')!).getByRole('button', { name: 'Reopen' }));
  await user.upload(await screen.findByTestId('reopen-file-input'), fileOf(draftsBq(), 'SYNTHETIC_DRAFTS.xlsx'));
  await screen.findByTestId('review-summary', {}, TIMEOUT);
  await user.click(screen.getByRole('tab', { name: 'Draft rows' }));
  await screen.findByTestId('draft-rows');
  const saved = async () => {
    const id = (await store.list())[0]!.reviewId;
    const l = await store.load(id);
    return (l as { review: SavedReview }).review;
  };
  return { user, store, saved };
}

const line = (sheet: string, itemNo: string) =>
  within(screen.getByTestId(`draft-table-${sheet}`)).getAllByTestId('draft-line').find((tr) => within(tr).queryAllByRole('button')[0]?.textContent === itemNo)!;
async function openActions(user: ReturnType<typeof userEvent.setup>, tr: HTMLElement) {
  await user.click(within(tr).getByText('Decide / resolve…'));
}

describe('resolving and deciding draft rows', () => {
  it('a placeholder is confirmed as not stated (stays blank, not a zero), then the row is approved with the warnings acknowledged', async () => {
    const { user, saved } = await open();
    const b = () => line('Bill 4', 'B');
    await openActions(user, b());
    expect(within(b()).getByRole('button', { name: 'Approve row' })).toHaveProperty('disabled', true);
    await user.click(within(b()).getByRole('button', { name: /rate is not stated in the document/ }));
    expect(within(b()).getByTestId('row-error').textContent).toContain('needs a note');
    await user.type(within(b()).getByLabelText(/Note for/), 'Rate not given in the synthetic BQ.');
    await user.click(within(b()).getByRole('button', { name: /rate is not stated in the document/ }));
    await user.type(within(b()).getByLabelText(/Note for/), 'Amount not given either.');
    await user.click(within(b()).getByRole('button', { name: /amount is not stated in the document/ }));
    expect(within(b()).getAllByTestId('confirmed-blank')).toHaveLength(2);
    expect(within(b()).getByTestId('draft-rate').textContent).toContain('not stated');
    expect(within(b()).getByTestId('draft-rate').querySelector('[data-value-kind]')!.getAttribute('data-value-kind')).toBe('placeholder');

    await user.click(within(b()).getByRole('button', { name: 'Approve row' }));
    expect(within(b()).getByTestId('row-error').textContent).toContain('warning');
    await user.type(within(b()).getByLabelText(/Note for/), 'Empty cells acknowledged.');
    await user.click(within(b()).getByRole('button', { name: 'Approve row' }));
    expect(b().getAttribute('data-row-status')).toBe('approved');
    const r = await saved();
    expect(validateReviewRecord(r)).toEqual([]);
    expect(r.history.filter((h) => h.draftRow).map((h) => h.action)).toEqual(['row_issue_resolved', 'row_issue_resolved', 'row_approved']);
  });

  it('a negative row cannot be approved, only excluded with a reason; it stays listed with -200', async () => {
    const { user, saved } = await open();
    const d = () => line('Bill 4', 'D');
    await openActions(user, d());
    expect(within(d()).getAllByText(/negative value cannot be resolved/)).toHaveLength(2); // rate and amount
    expect(within(d()).getByRole('button', { name: 'Approve row' })).toHaveProperty('disabled', true);
    await user.click(within(d()).getByRole('button', { name: 'Exclude from upload' }));
    expect(within(d()).getByTestId('row-error').textContent).toContain('needs a note');
    await user.type(within(d()).getByLabelText(/Note for/), 'Credit: would be turned positive by the import.');
    await user.click(within(d()).getByRole('button', { name: 'Exclude from upload' }));
    expect(d().getAttribute('data-row-status')).toBe('excluded');
    expect(within(d()).getByTestId('draft-amount').textContent).toContain('-200');
    const excluded = within(screen.getByTestId('draft-table-Bill 4')).getByTestId('excluded-rows').textContent!;
    expect(excluded).toContain('Amount -200');
    expect(excluded).toContain('Credit: would be turned positive by the import.');
    expect(excluded).toContain('Sheet: Bill 4 | Row 7');
    expect((await saved()).history.at(-1)).toMatchObject({ action: 'row_excluded' });
  });

  it('bulk approval asks for confirmation and approves only rows with no issues', async () => {
    const { user } = await open();
    await user.click(screen.getByRole('button', { name: 'Approve rows with no issues…' }));
    expect(screen.getByTestId('bulk-rows-confirm').textContent).toContain('Approve 5 draft row(s) that have no issues at all');
    await user.click(within(screen.getByTestId('bulk-rows-confirm')).getByRole('button', { name: 'Confirm' }));
    const statuses = screen.getAllByTestId('draft-line').map((tr) => [within(tr).queryAllByRole('button')[0]?.textContent, tr.getAttribute('data-row-status')]);
    expect(statuses.filter(([, s]) => s === 'approved').map(([i]) => i)).toEqual(['A', 'E', 'F', 'A', 'B']); // Bill 4 A (stated zeros, no issues), E, F; Bill 5 A, B
    expect(line('Bill 4', 'B').getAttribute('data-row-status')).toBe('pending');
    expect(within(screen.getByTestId('draft-table-Bill 5')).getByTestId('table-readiness').textContent).toContain('ready for export (nothing is exported yet)');
  });

  it('a changed review decision makes the approval outdated, visibly, with what changed', async () => {
    const { user } = await open((r, run) => {
      const t = drafts(r, run).tables[0]!;
      let x = decideDraftRow(r, t.drafts.find((d) => d.itemRowIndex === 7)!, 'approved', null, AT, 'Synthetic Reviewer');
      const col = proposalOf(x, 'columnRole', { tableId: 'doc-review:sheet:0', columnIndex: 5 });
      x = recordChanges(x, [{ before: col, after: reopenProposal(col) }], AT, null);
      return correct(x, run, x.proposals.find((p) => p.id === col.id)!, { tableId: 'doc-review:sheet:0', columnIndex: 5, role: 'ignore' });
    });
    const e = line('Bill 4', 'E');
    expect(e.getAttribute('data-row-status')).toBe('outdated');
    expect(within(e).getByTestId('decision-outdated').textContent).toContain('Amount: "400" → "not stated (no column)"');
    await user.selectOptions(screen.getByTestId('row-filter'), 'outdated');
    expect(screen.getAllByTestId('draft-line').map((tr) => tr.getAttribute('data-row-status'))).toEqual(['outdated']);
  });

  it('a Stage 2I/2J review without row decisions shows every row as not yet decided', async () => {
    await open();
    expect(screen.getAllByTestId('draft-line').every((tr) => tr.getAttribute('data-row-status') === 'pending')).toBe(true);
  });
});
