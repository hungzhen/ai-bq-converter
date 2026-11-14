// @vitest-environment jsdom
/**
 * Stage 2J — the "Draft rows" view, used the way a person would.
 * Every file is SYNTHETIC — NOT REAL COST DATA.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../src/App.tsx';
import { reopenProposal } from '../../src/core/evidence/index.ts';
import { recordChanges } from '../../src/core/review/index.ts';
import { createMemoryReviewStore } from '../../src/storage/reviewStore.ts';
import { draftsBq } from '../helpers/synthetic/draftLayouts.ts';
import { newReview } from '../helpers/reviews.ts';
import { AT, approveAll, proposalOf } from '../helpers/drafts.ts';

afterEach(cleanup);
const TIMEOUT = { timeout: 15000 };
const fileOf = (bytes: Uint8Array, name: string) => new File([bytes.slice().buffer as ArrayBuffer], name);

/** A review decided earlier (saved in this browser), reopened with its original file. */
async function openDecidedReview(adjust = (r: Awaited<ReturnType<typeof newReview>>['review']) => r) {
  const { review } = await newReview(draftsBq(), 'SYNTHETIC_DRAFTS.xlsx');
  const store = createMemoryReviewStore([adjust(approveAll(review))]);
  const user = userEvent.setup({ applyAccept: false });
  render(<App store={store} download={() => {}} />);
  await user.click(within((await screen.findByText('SYNTHETIC_DRAFTS.xlsx', {}, TIMEOUT)).closest('tr')!).getByRole('button', { name: 'Reopen' }));
  await user.upload(await screen.findByTestId('reopen-file-input'), fileOf(draftsBq(), 'SYNTHETIC_DRAFTS.xlsx'));
  await screen.findByTestId('review-summary', {}, TIMEOUT);
  await user.click(screen.getByRole('tab', { name: 'Draft rows' }));
  await screen.findByTestId('draft-rows');
  return { user, store };
}

const section = (name: string) => screen.getByTestId(`draft-table-${name}`);
const line = (name: string, itemNo: string) =>
  within(section(name)).getAllByTestId('draft-line').find((tr) => within(tr).queryAllByRole('button')[0]?.textContent === itemNo)!;

describe('the Draft rows view', () => {
  it('shows a stated zero and a placeholder differently, units as written, and the missing project details as blocking', async () => {
    const { user, store } = await openDecidedReview();
    expect(screen.getByTestId('draft-blockers').textContent).toContain('The project name has not been entered');
    expect(screen.getByTestId('draft-summary').textContent).toContain('9 draft row(s) from 2 ready table(s)');

    const a = line('Bill 4', 'A');
    expect(within(a).getByTestId('draft-quantity').querySelector('[data-value-kind]')!.getAttribute('data-value-kind')).toBe('stated_zero');
    expect(within(a).getByTestId('draft-quantity').textContent).toContain('stated as 0 in the document');
    expect(within(a).getByTestId('draft-unit').textContent).toContain('M2');
    expect(within(a).getByTestId('draft-unit').textContent).toContain('Cost Library would store “m²” (not applied)');

    const b = line('Bill 4', 'B');
    expect(within(b).getByTestId('draft-rate').querySelector('[data-value-kind]')!.getAttribute('data-value-kind')).toBe('placeholder');
    expect(within(b).getByTestId('draft-rate').textContent).toContain('placeholder only — blocking');
    expect(within(b).getByTestId('draft-rate').textContent).not.toMatch(/^0/);

    const c = line('Bill 4', 'C');
    expect(within(c).getByTestId('draft-unit').textContent).toContain('lump sum — quantity never assumed');
    expect(within(line('Bill 4', 'E')).getByTestId('draft-description').textContent).toBe('SYNTHETIC excavate trench for drainage pipe not exceeding 1.00m deep, including backfilling');

    // Enter the project details: recorded in the review, blockers gone.
    await user.type(screen.getByLabelText('Project name (required)'), 'SYNTHETIC PROJECT');
    await user.type(screen.getByLabelText('Project year (required, e.g. 2024 Q1)'), '2024');
    await user.click(screen.getByRole('button', { name: 'Save project details' }));
    expect(screen.getByTestId('project-message').textContent).toContain('"2024 Q1"');
    await user.type(screen.getByLabelText('Project year (required, e.g. 2024 Q1)'), ' Q1');
    await user.click(screen.getByRole('button', { name: 'Save project details' }));
    expect(screen.getByTestId('project-message').textContent).toContain('saved');
    expect(screen.queryByTestId('draft-blockers')).toBeNull();
    const saved = await store.load((await store.list())[0]!.reviewId);
    expect(saved?.ok && saved.review.projectDetails).toEqual({ name: 'SYNTHETIC PROJECT', year: '2024 Q1', projectRef: null, location: null });
  });

  it('a value links back to its source cell in the review view', async () => {
    const { user } = await openDecidedReview();
    await user.click(within(line('Bill 5', 'B')).getByTestId('draft-amount'));
    expect(screen.getByRole('tab', { name: 'Review proposals' }).getAttribute('aria-selected')).toBe('true');
    const grid = screen.getByTestId('source-grid');
    expect(grid.querySelector('[data-cell="F4"]')!.getAttribute('data-highlighted')).toBe('true');
  });

  it('a blocked table shows its reasons while the other table still shows its drafts; all source rows are counted', async () => {
    await openDecidedReview((r) => {
      const p = proposalOf(r, 'rowClass', { tableId: 'doc-review:sheet:1', rowIndex: 3 });
      return recordChanges(r, [{ before: p, after: reopenProposal(p) }], AT, null);
    });
    expect(section('Bill 5').getAttribute('data-status')).toBe('blocked');
    expect(within(section('Bill 5')).getByTestId('table-reasons').textContent).toContain('row type has not been decided');
    expect(within(section('Bill 5')).queryByTestId('draft-table')).toBeNull();
    expect(section('Bill 4').getAttribute('data-status')).toBe('ready');
    expect(within(section('Bill 4')).getAllByTestId('draft-line')).toHaveLength(7);
    expect(within(section('Bill 4')).getByTestId('reconciliation-counts').textContent).toContain('Source rows: 12');
    expect(within(section('Bill 5')).getByTestId('reconciliation-counts').textContent).toContain('Undecided: 1');
  });
});
