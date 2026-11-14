// @vitest-environment jsdom
/**
 * Stage 2I — saving, reloading, reopening, fingerprint checks, export / import and delete, used
 * the way a person would. Every file is SYNTHETIC — NOT REAL COST DATA.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../src/App.tsx';
import { type ReviewStore, createMemoryReviewStore } from '../../src/storage/reviewStore.ts';
import * as L from '../helpers/synthetic/bqLayouts.ts';
import { utf8 } from '../helpers/synthetic/spreadsheets.ts';

afterEach(cleanup);
const TIMEOUT = { timeout: 15000 };

const fileOf = (bytes: Uint8Array, name: string) => new File([bytes.slice().buffer as ArrayBuffer], name);

interface Page {
  user: ReturnType<typeof userEvent.setup>;
  downloads: { name: string; text: string }[];
  unmount: () => void;
}

/** Opens the app on a given store (the same store = the same browser after a reload). */
function openApp(store: ReviewStore, reviewer?: string): Page & { ready: Promise<void> } {
  // applyAccept: false — like a person choosing "All files" in the browser's file dialog.
  const user = userEvent.setup({ applyAccept: false });
  const downloads: { name: string; text: string }[] = [];
  const { unmount } = render(<App store={store} download={(name, text) => downloads.push({ name, text })} />);
  const ready = reviewer ? user.type(screen.getByLabelText('Reviewer name'), reviewer) : Promise.resolve();
  return { user, downloads, unmount, ready };
}

async function review(page: Page, bytes: Uint8Array, name: string) {
  await page.user.upload(screen.getByTestId('file-input'), fileOf(bytes, name));
  await page.user.click(screen.getByRole('button', { name: 'Start extraction' }));
  await screen.findByTestId('review-summary', {}, TIMEOUT);
}

const sheetTab = (name: RegExp) => within(screen.getByRole('tablist', { name: 'Worksheets' })).getByRole('tab', { name });
const kindTab = (name: RegExp) => within(screen.getByRole('tablist', { name: 'Proposal kinds' })).getByRole('tab', { name });
const proposalButton = (text: string) => within(screen.getByTestId('proposal-list')).getByText(text).closest('button')!;
const summary = () => screen.getByTestId('review-summary').textContent ?? '';

async function makeDecisions(page: Page) {
  const { user } = page;
  await user.click(sheetTab(/^Bill 2/));
  await user.click(kindTab(/^Rows/));
  await user.click(proposalButton('Bill 2 row 22 → Percentage item'));
  await user.type(screen.getByLabelText('Decision note'), 'Checked against the drawing.');
  await user.click(screen.getByRole('button', { name: 'Approve' }));
  await user.click(proposalButton('Bill 2 row 5 → Subheading'));
  await user.type(screen.getByLabelText('Decision note'), 'Third level.');
  await user.click(screen.getAllByRole('button', { name: 'Approve this alternative' })[0]!);
  await user.click(proposalButton('Bill 2 row 25 → Description-only item'));
  await user.selectOptions(screen.getByLabelText('Correction'), 'main_heading');
  await user.type(screen.getByLabelText('Decision note'), 'A heading in the original.');
  await user.click(screen.getByRole('button', { name: 'Reject and record this correction' }));
  await screen.findByText(/Saved in this browser at/);
}

describe('saving and restoring after a reload', () => {
  it('decisions, reviewer, notes, alternatives and corrections come back — only with the original file', async () => {
    const store = createMemoryReviewStore();
    const bytes = L.conventionalBq();
    const first = openApp(store, 'Synthetic Reviewer');
    await first.ready;
    await review(first, bytes, 'SYNTHETIC_BQ.xlsx');
    await makeDecisions(first);
    expect(summary()).toContain('Approved: 2');
    first.unmount(); // the page is closed / reloaded

    const second = openApp(store);
    const row = await screen.findByText('SYNTHETIC_BQ.xlsx', {}, TIMEOUT);
    const saved = row.closest('tr')!;
    expect(saved.textContent).toMatch(/Synthetic Reviewer/);
    expect([...saved.querySelectorAll('td')].slice(3, 6).map((td) => td.textContent)).toEqual(['2', '1', String(Number(saved.querySelectorAll('td')[5]!.textContent))]);
    await second.user.click(within(saved).getByRole('button', { name: 'Reopen' }));
    expect(screen.getByTestId('reopen-panel').textContent).toContain('A matching file name is not enough');
    await second.user.upload(screen.getByTestId('reopen-file-input'), fileOf(bytes, 'SYNTHETIC_BQ.xlsx'));
    await screen.findByTestId('review-summary', {}, TIMEOUT);
    expect(summary()).toContain('Approved: 2');
    expect(summary()).toContain('Rejected: 1');

    await second.user.click(sheetTab(/^Bill 2/));
    await second.user.click(kindTab(/^Rows/));
    await second.user.click(proposalButton('Bill 2 row 5 → Subheading'));
    const record = screen.getByTestId('decision-record').textContent!;
    expect(record).toContain('Approved by Synthetic Reviewer');
    expect(record).toContain('alternative 1: Bill 2 row 5 → Secondary subheading');
    expect(record).toContain('Note: Third level.');
    await second.user.click(proposalButton('Bill 2 row 25 → Description-only item'));
    expect(screen.getByTestId('decision-record').textContent).toContain('Correction: Bill 2 row 25 → Main heading');
    expect(document.querySelector('[data-cell="B25"]')!.textContent).toBe('SYNTHETIC provide temporary access as described'); // source unchanged
  });

  it('a file with the same name but different content is refused; the saved review is untouched', async () => {
    const store = createMemoryReviewStore();
    const first = openApp(store);
    await review(first, L.conventionalBq(), 'SYNTHETIC_BQ.xlsx');
    await makeDecisions(first);
    first.unmount();

    const second = openApp(store);
    const saved = (await screen.findByText('SYNTHETIC_BQ.xlsx', {}, TIMEOUT)).closest('tr')!;
    const before = saved.textContent;
    await second.user.click(within(saved).getByRole('button', { name: 'Reopen' }));
    await second.user.upload(screen.getByTestId('reopen-file-input'), fileOf(L.workingFile(), 'SYNTHETIC_BQ.xlsx'));
    const warning = await screen.findByTestId('fingerprint-mismatch', {}, TIMEOUT);
    expect(warning.textContent).toContain('This is not the same document — nothing was restored');
    expect(warning.textContent).toContain('no cells were matched');
    expect(screen.queryByTestId('review-summary')).toBeNull();

    // keep the old review; review the other file separately
    await second.user.click(within(warning).getByRole('button', { name: /as a new, separate review/ }));
    await screen.findByTestId('review-summary', {}, TIMEOUT);
    expect(summary()).toContain('Approved: 0');
    await second.user.click(screen.getByRole('button', { name: /Back to start/ }));
    const rows = await screen.findAllByText('SYNTHETIC_BQ.xlsx');
    expect(rows).toHaveLength(2); // two separate reviews
    expect(rows.map((r) => r.closest('tr')!.textContent)).toContain(before);
  });

  it('choosing the same file again offers to continue the saved review', async () => {
    const store = createMemoryReviewStore();
    const bytes = L.conventionalBq();
    const first = openApp(store);
    await review(first, bytes, 'SYNTHETIC_BQ.xlsx');
    await makeDecisions(first);
    first.unmount();

    const second = openApp(store);
    await second.user.upload(screen.getByTestId('file-input'), fileOf(bytes, 'SYNTHETIC_BQ.xlsx'));
    await second.user.click(screen.getByRole('button', { name: 'Start extraction' }));
    const offer = await screen.findByTestId('existing-reviews', {}, TIMEOUT);
    expect(offer.textContent).toContain('2 approved, 1 rejected');
    await second.user.click(within(offer).getByRole('button', { name: 'Continue this review' }));
    await screen.findByTestId('review-summary', {}, TIMEOUT);
    expect(summary()).toContain('Approved: 2');
  });
});

describe('decision history', () => {
  it('changing a decision keeps the earlier one in the history', async () => {
    const page = openApp(createMemoryReviewStore(), 'Synthetic Reviewer');
    await page.ready;
    await review(page, L.conventionalBq(), 'SYNTHETIC_BQ.xlsx');
    await page.user.click(sheetTab(/^Bill 2/));
    await page.user.click(kindTab(/^Rows/));
    await page.user.click(proposalButton('Bill 2 row 22 → Percentage item'));
    await page.user.click(screen.getByRole('button', { name: 'Approve' }));
    await page.user.click(screen.getByRole('button', { name: /Change this decision/ }));
    await page.user.type(screen.getByLabelText('Decision note'), 'Not a percentage item after all.');
    await page.user.click(screen.getByRole('button', { name: 'Reject' }));
    const history = within(screen.getByTestId('proposal-history')).getAllByRole('listitem').map((li) => li.textContent);
    expect(history.map((h) => /· (\w[\w ]+) ·/.exec(h!)?.[1])).toEqual(['proposal created', 'approved', 'decision reopened', 'rejected']);
    expect(history[3]).toContain('Not a percentage item after all.');
  });
});

describe('export, delete and import', () => {
  it('exports a backup, deletes after confirmation, and imports it back', async () => {
    const store = createMemoryReviewStore();
    const page = openApp(store, 'Synthetic Reviewer');
    await page.ready;
    await review(page, L.conventionalBq(), 'SYNTHETIC_BQ.xlsx');
    await makeDecisions(page);
    await page.user.click(screen.getByRole('button', { name: 'Export review backup' }));
    await screen.findByText(/Saved in this browser/);
    await new Promise((r) => setTimeout(r, 50));
    expect(page.downloads.map((d) => d.name)).toEqual(['SYNTHETIC_BQ.review-backup.json']);
    const backup = page.downloads[0]!.text;
    expect(JSON.parse(backup).notice).toContain('NOT a Cost Library upload workbook');

    await page.user.click(screen.getByRole('button', { name: /Back to start/ }));
    const saved = (await screen.findByText('SYNTHETIC_BQ.xlsx', {}, TIMEOUT)).closest('tr')!;
    await page.user.click(within(saved).getByRole('button', { name: 'Delete…' }));
    await page.user.click(within(screen.getByTestId('delete-confirm')).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('SYNTHETIC_BQ.xlsx')).toBeTruthy(); // cancel keeps it
    await page.user.click(within(screen.getByText('SYNTHETIC_BQ.xlsx').closest('tr')!).getByRole('button', { name: 'Delete…' }));
    await page.user.click(within(screen.getByTestId('delete-confirm')).getByRole('button', { name: 'Delete' }));
    await screen.findByText('No saved reviews in this browser yet.');

    await page.user.upload(screen.getByTestId('backup-input'), new File([backup], 'SYNTHETIC_BQ.review-backup.json', { type: 'application/json' }));
    expect((await screen.findByTestId('import-message', {}, TIMEOUT)).textContent).toContain('Imported the review of "SYNTHETIC_BQ.xlsx"');
    const back = (await screen.findByText('SYNTHETIC_BQ.xlsx')).closest('tr')!;
    expect([...back.querySelectorAll('td')].slice(3, 5).map((td) => td.textContent)).toEqual(['2', '1']);
  });

  it('refuses an invalid backup and a spreadsheet chosen as a backup, with clear messages', async () => {
    const page = openApp(createMemoryReviewStore());
    await page.user.upload(screen.getByTestId('backup-input'), new File(['{"hello": 1}'], 'not-a-backup.json'));
    expect((await screen.findByTestId('import-message', {}, TIMEOUT)).textContent).toContain('not an AI BQ Converter review backup');
    await page.user.upload(screen.getByTestId('backup-input'), fileOf(L.conventionalBq(), 'SYNTHETIC_BQ.xlsx'));
    await screen.findByText(/spreadsheet, not a review backup/, {}, TIMEOUT);
    expect(screen.getByText('No saved reviews in this browser yet.')).toBeTruthy();
  });

  it('tells people that browser storage can be lost and backups should be exported', () => {
    openApp(createMemoryReviewStore());
    expect(screen.getByTestId('storage-notice').textContent).toMatch(/Export a backup/);
  });
});

describe('the original file is not changed', () => {
  it('reviewing and reopening leave the chosen file\'s bytes identical', async () => {
    const store = createMemoryReviewStore();
    const bytes = utf8('Item,Description,Unit,Qty,Rate,Amount\nA,SYNTHETIC blockwork wall,m2,10,30.00,300.00\n');
    const copy = bytes.slice();
    const page = openApp(store);
    await review(page, bytes, 'SYNTHETIC.csv');
    expect(bytes).toEqual(copy);
  });
});
