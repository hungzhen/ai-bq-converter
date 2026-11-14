// @vitest-environment jsdom
/**
 * Stage 2L — the Export panel, used the way a person would. SYNTHETIC — NOT REAL COST DATA.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as XLSX from 'xlsx';
import App from '../../src/App.tsx';
import { type SavedReview, validateReviewRecord } from '../../src/core/review/index.ts';
import { createMemoryReviewStore } from '../../src/storage/reviewStore.ts';
import { draftsBq } from '../helpers/synthetic/draftLayouts.ts';
import { newReview } from '../helpers/reviews.ts';
import { approveAll, withProject } from '../helpers/drafts.ts';
import { decideAllRows } from '../helpers/export.ts';

afterEach(cleanup);
const TIMEOUT = { timeout: 15000 };
const fileOf = (bytes: Uint8Array, name: string) => new File([bytes.slice().buffer as ArrayBuffer], name);

async function open(decide: boolean, only?: (t: string) => boolean) {
  const { run, review } = await newReview(draftsBq(), 'SYNTHETIC_DRAFTS.xlsx');
  const base = withProject(approveAll(review));
  const store = createMemoryReviewStore([decide ? decideAllRows(base, run, only) : base]);
  const files: { name: string; bytes: Uint8Array }[] = [];
  const user = userEvent.setup({ applyAccept: false });
  render(<App store={store} download={() => {}} downloadFile={(name, bytes) => files.push({ name, bytes })} />);
  await user.click(within((await screen.findByText('SYNTHETIC_DRAFTS.xlsx', {}, TIMEOUT)).closest('tr')!).getByRole('button', { name: 'Reopen' }));
  await user.upload(await screen.findByTestId('reopen-file-input'), fileOf(draftsBq(), 'SYNTHETIC_DRAFTS.xlsx'));
  await screen.findByTestId('review-summary', {}, TIMEOUT);
  await user.click(screen.getByRole('tab', { name: 'Draft rows' }));
  await screen.findByTestId('export-panel');
  return { user, store, files };
}

describe('the Export panel', () => {
  it('is labelled NOT YET VALIDATED and never recommends uploading', async () => {
    await open(false);
    const panel = screen.getByTestId('export-panel');
    expect(panel.textContent).toContain('NOT YET VALIDATED FOR COST LIBRARY IMPORT');
    expect(within(panel).getByTestId('not-validated-warning').textContent).toContain('Do not upload it to the Cost Library until the separate compatibility test');
    expect(within(panel).getByRole('button', { name: /Create export files/ })).toHaveProperty('disabled', true); // nothing decided yet
    expect(within(panel).getByTestId('export-tables').textContent).toContain('not exported');
  });

  it('creates both files only for ready tables, reports their fingerprints, and records the export', async () => {
    const { user, store, files } = await open(true, (t) => t === 'Bill 4');
    const panel = screen.getByTestId('export-panel');
    expect(within(panel).getByTestId('export-tables').textContent).toMatch(/Bill 4: will be exported — 6 approved row\(s\); 1 excluded/);
    expect(within(panel).getByTestId('export-tables').textContent).toMatch(/Bill 5: not exported/);
    await user.click(within(panel).getByRole('button', { name: /Create export files/ }));
    const done = await screen.findByTestId('export-done', {}, TIMEOUT);
    expect(done.textContent).toContain('NOT-VALIDATED_SYNTHETIC_DRAFTS.cost-library-upload.xlsx');
    expect(done.textContent).toContain('reconciliation only, never for upload');
    expect(files.map((f) => f.name)).toEqual(['NOT-VALIDATED_SYNTHETIC_DRAFTS.cost-library-upload.xlsx', 'SYNTHETIC_DRAFTS.reconciliation.xlsx']);
    const bq = XLSX.read(files[0]!.bytes, { type: 'array' }).Sheets['BQ']!;
    expect(XLSX.utils.decode_range(bq['!ref']!).e.r).toBe(6); // header + 6 rows of Bill 4 only
    await new Promise((r) => setTimeout(r, 50));
    const saved = (await store.load((await store.list())[0]!.reviewId)) as { review: SavedReview };
    expect(saved.review.history.at(-1)).toMatchObject({ action: 'review_exported' });
    expect(validateReviewRecord(saved.review)).toEqual([]);
  });
});
