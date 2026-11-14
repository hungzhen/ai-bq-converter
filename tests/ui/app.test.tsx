// @vitest-environment jsdom
/**
 * Stage 2H — the first interface, used the way a person would: choose a file, start, inspect the
 * source, select proposals, check the evidence, approve / reject / correct.
 * Every file is SYNTHETIC — NOT REAL COST DATA.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../src/App.tsx';
import { createRuleBasedProvider } from '../../src/providers/rule-based/index.ts';
import type { InterpretationProvider } from '../../src/providers/types.ts';
import * as L from '../helpers/synthetic/bqLayouts.ts';
import { syntheticBqXls, syntheticBqXlsx, utf8 } from '../helpers/synthetic/spreadsheets.ts';

afterEach(cleanup);

const TIMEOUT = { timeout: 15000 };

async function openFile(bytes: Uint8Array, fileName: string, provider?: InterpretationProvider, reviewer?: string) {
  const user = userEvent.setup();
  render(<App {...(provider ? { provider } : {})} />);
  if (reviewer) await user.type(screen.getByLabelText('Reviewer name'), reviewer);
  await user.upload(screen.getByTestId('file-input'), new File([bytes.slice().buffer as ArrayBuffer], fileName));
  return user;
}

async function process(bytes: Uint8Array, fileName: string, provider?: InterpretationProvider, reviewer?: string) {
  const user = await openFile(bytes, fileName, provider, reviewer);
  await user.click(screen.getByRole('button', { name: 'Start extraction' }));
  await screen.findByTestId('review-summary', {}, TIMEOUT);
  return user;
}

const sheetTab = (name: RegExp) => within(screen.getByRole('tablist', { name: 'Worksheets' })).getByRole('tab', { name });
const kindTab = (name: RegExp) => within(screen.getByRole('tablist', { name: 'Proposal kinds' })).getByRole('tab', { name });
const proposalButton = (text: string) => within(screen.getByTestId('proposal-list')).getByText(text).closest('button')!;
const highlightedCells = () => [...document.querySelectorAll('[data-highlighted="true"]')].map((e) => e.getAttribute('data-cell')).filter(Boolean);
const summary = () => screen.getByTestId('review-summary').textContent ?? '';

async function selectRow(user: ReturnType<typeof userEvent.setup>, sheet: RegExp, text: string) {
  await user.click(sheetTab(sheet));
  await user.click(kindTab(/^Rows/));
  await user.click(proposalButton(text));
}

describe('choosing a file', () => {
  it('shows the selected file name and size, can remove it, and only then starts', async () => {
    const user = await openFile(L.conventionalBq(), 'SYNTHETIC_BQ.xlsx');
    const selected = screen.getByTestId('selected-file');
    expect(selected.textContent).toContain('SYNTHETIC_BQ.xlsx');
    expect(selected.textContent).toMatch(/KB/);
    await user.click(within(selected).getByRole('button', { name: 'Remove' }));
    expect(screen.queryByTestId('selected-file')).toBeNull();
    expect(screen.getByRole('button', { name: 'Start extraction' })).toHaveProperty('disabled', true);
  });
});

describe('successful runs show the review screen with nothing approved', () => {
  it.each([
    ['SYNTHETIC_BQ.xlsx', L.conventionalBq],
    ['SYNTHETIC_BQ.xls', syntheticBqXls],
    ['SYNTHETIC.csv', () => utf8('Item,Description,Unit,Qty,Rate,Amount\nA,SYNTHETIC blockwork wall,m2,10,30.00,300.00\n')],
  ] as const)('%s', async (fileName, build) => {
    await process(build(), fileName);
    expect(within(screen.getByTestId('pipeline-stages')).getAllByText(/✓/)).toHaveLength(7);
    expect(summary()).toContain('Approved: 0');
    expect(summary()).toMatch(/\d+ unresolved/);
  });
});

describe('extracted source preview', () => {
  it('lists every worksheet with its visibility, and switching shows that sheet in full', async () => {
    const user = await process(syntheticBqXlsx(), 'SYNTHETIC_BQ.xlsx');
    const tabs = within(screen.getByRole('tablist', { name: 'Worksheets' })).getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual(['Cover', 'Bill 2 – Substructure', "BQ's (Rev.A) #2", 'Rates build-uphidden', 'Lockedvery hidden', 'Empty(empty)']);
    await user.click(sheetTab(/^Bill 2/));
    expect(screen.getByTestId('sheet-summary').textContent).toContain('14 row(s) × 7 column(s)');
    expect(screen.getByTestId('source-grid').querySelectorAll('tbody tr')).toHaveLength(14); // blank row 2 included
    expect(document.querySelector('[data-cell="E7"]')!.textContent).toBe('(RM 12.50)'); // shown text
    expect(document.querySelector('[data-cell="E7"]')!.getAttribute('title')).toContain('stored: -12.5 (number)'); // original value
    expect(document.querySelector('[data-cell="F7"]')!.textContent).toContain('formula, no result');
    await user.click(sheetTab(/^Rates build-up/));
    expect(screen.getByTestId('sheet-summary').textContent).toContain('hidden worksheet');
  });
});

describe('evidence for a selected proposal', () => {
  it('shows the interpretation, confidence with its cited cells, quoted text, and highlights those cells', async () => {
    const user = await process(L.conventionalBq(), 'SYNTHETIC_BQ.xlsx');
    await selectRow(user, /^Bill 2/, 'Bill 2 row 22 → Percentage item');
    const panel = screen.getByTestId('evidence-panel');
    expect(within(panel).getByTestId('proposed-value').textContent).toBe('Bill 2 row 22 → Percentage item');
    expect(panel.textContent).toContain('Confidence 70%, based on the 3 cited source cell(s) below');
    const rows = within(within(panel).getByTestId('evidence-table')).getAllByRole('row').slice(1).map((r) => r.textContent);
    expect(rows).toEqual(['Bill 2!B22“Allow for profit”', 'Bill 2!C22“%”', 'Bill 2!D22“5”']);
    expect(highlightedCells()).toEqual(['B22', 'C22', 'D22']);
  });

  it('clicking a citation highlights exactly that cell, switching worksheet if needed', async () => {
    const user = await process(L.conventionalBq(), 'SYNTHETIC_BQ.xlsx');
    await user.click(kindTab(/^Document/));
    await user.click(within(screen.getByTestId('proposal-list')).getAllByRole('button')[0]!);
    await user.click(within(screen.getByTestId('evidence-table')).getByRole('button', { name: 'Bill 2!D3' }));
    expect(sheetTab(/^Bill 2/).getAttribute('aria-selected')).toBe('true');
    expect(highlightedCells()).toEqual(['D3']);
  });

  it('alternatives and warnings are shown with the proposal', async () => {
    const user = await process(L.conventionalBq(), 'SYNTHETIC_BQ.xlsx');
    await selectRow(user, /^Bill 2/, 'Bill 2 row 5 → Subheading');
    const panel = screen.getByTestId('evidence-panel');
    expect(panel.textContent).toContain('Alternative interpretations');
    expect(panel.textContent).toContain('Bill 2 row 5 → Secondary subheading');
    expect(within(panel).getByTestId('findings').textContent).toContain('LOW_CONFIDENCE');
  });
});

describe('decisions', () => {
  it('approving records the reviewer and changes only the review state', async () => {
    const user = await process(L.conventionalBq(), 'SYNTHETIC_BQ.xlsx', undefined, 'Synthetic Reviewer');
    await selectRow(user, /^Bill 2/, 'Bill 2 row 22 → Percentage item');
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(screen.getByTestId('decision-record').textContent).toContain('Approved by Synthetic Reviewer');
    expect(summary()).toContain('Approved: 1');
    expect(document.querySelector('[data-cell="D22"]')!.textContent).toBe('5'); // source unchanged
  });

  it('with no reviewer name, the decision says "not recorded" — no identity is invented', async () => {
    const user = await process(L.conventionalBq(), 'SYNTHETIC_BQ.xlsx');
    await selectRow(user, /^Bill 2/, 'Bill 2 row 22 → Percentage item');
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    expect(screen.getByTestId('decision-record').textContent).toContain('Rejected by not recorded');
    expect(summary()).toContain('Rejected: 1');
  });

  it('warnings need an acknowledging note; alternatives can be chosen explicitly', async () => {
    const user = await process(L.conventionalBq(), 'SYNTHETIC_BQ.xlsx');
    await selectRow(user, /^Bill 2/, 'Bill 2 row 5 → Subheading');
    const approve = screen.getByRole('button', { name: 'Approve the proposed reading' });
    expect(approve).toHaveProperty('disabled', true);
    expect(screen.getByTestId('decision-controls').textContent).toContain('Approval needs a note acknowledging the warning(s).');
    await user.type(screen.getByLabelText('Decision note'), 'Third-level heading; checked.');
    await user.click(screen.getAllByRole('button', { name: 'Approve this alternative' })[0]!);
    expect(screen.getByTestId('decision-record').textContent).toContain('alternative 1: Bill 2 row 5 → Secondary subheading');
  });

  it('a correction is recorded separately with its note; the source cell is unchanged', async () => {
    const user = await process(L.conventionalBq(), 'SYNTHETIC_BQ.xlsx');
    await selectRow(user, /^Bill 2/, 'Bill 2 row 25 → Description-only item');
    await user.selectOptions(screen.getByLabelText('Correction'), 'main_heading');
    expect(screen.getByRole('button', { name: 'Reject and record this correction' })).toHaveProperty('disabled', true);
    await user.type(screen.getByLabelText('Decision note'), 'This is a heading in the original.');
    await user.click(screen.getByRole('button', { name: 'Reject and record this correction' }));
    const record = screen.getByTestId('decision-record').textContent!;
    expect(record).toContain('Correction: Bill 2 row 25 → Main heading');
    expect(record).toContain('Note: This is a heading in the original.');
    expect(document.querySelector('[data-cell="B25"]')!.textContent).toBe('SYNTHETIC provide temporary access as described');
  });

  it('a proposal that failed verification cannot be approved', async () => {
    const base = createRuleBasedProvider();
    const misquoting: InterpretationProvider = {
      ...base,
      async mapColumns(ctx, regions) {
        const answers = await base.mapColumns(ctx, regions);
        return answers.map((a) => (a.value.columnIndex === 3 ? { ...a, quotedText: a.quotedText?.map(() => 'MISQUOTED') } : a));
      },
    };
    const user = await process(L.conventionalBq(), 'SYNTHETIC_BQ.xlsx', misquoting);
    expect(summary()).toMatch(/Failed verification: [1-9]/);
    await user.click(sheetTab(/^Bill 2/));
    await user.click(kindTab(/^Columns/));
    await user.click(proposalButton('Bill 2 column D → Quantity'));
    expect(screen.getByRole('button', { name: 'Approve' })).toHaveProperty('disabled', true);
    expect(screen.getByTestId('decision-controls').textContent).toContain('failed verification and cannot be approved');
    expect(within(screen.getByTestId('findings')).getAllByText(/QUOTE_MISMATCH/).length).toBeGreaterThan(0);
  });
});

describe('bulk approval and unresolved proposals', () => {
  it('bulk approval needs confirmation and leaves ambiguous, warned, hierarchy and trade proposals unresolved', async () => {
    const user = await process(L.conventionalBq(), 'SYNTHETIC_BQ.xlsx');
    expect(summary()).toContain('Approved: 0'); // nothing approved automatically
    await user.click(screen.getByRole('button', { name: 'Approve straightforward proposals…' }));
    expect(screen.getByTestId('bulk-confirm').textContent).toContain('no alternatives and no warnings');
    await user.click(within(screen.getByTestId('bulk-confirm')).getByRole('button', { name: 'Confirm' }));
    expect(screen.getByRole('status').textContent).toMatch(/Approved \d+ straightforward proposal\(s\)\. \d+ other\(s\) stay for individual review\./);
    expect(summary()).not.toContain('Approved: 0');

    await user.click(sheetTab(/^Bill 2/));
    for (const kind of [/^Hierarchy/, /^Trades/, /^Document/]) {
      await user.click(kindTab(kind));
      const chips = within(screen.getByTestId('proposal-list')).getAllByText(/Verified — awaiting review|Approved/);
      expect(chips.every((c) => c.textContent === 'Verified — awaiting review')).toBe(true);
    }
    await user.click(kindTab(/^Rows/));
    expect(proposalButton('Bill 2 row 5 → Subheading').textContent).toContain('Verified — awaiting review'); // has alternatives + warning
    expect(proposalButton('Bill 2 row 22 → Percentage item').textContent).toContain('Approved'); // straightforward
  });

  it('"Unresolved only" shows just the proposals nobody has decided yet', async () => {
    const user = await process(L.conventionalBq(), 'SYNTHETIC_BQ.xlsx');
    await selectRow(user, /^Bill 2/, 'Bill 2 row 22 → Percentage item');
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await user.selectOptions(screen.getByLabelText('Filter proposals'), 'unresolved');
    expect(within(screen.getByTestId('proposal-list')).queryByText('Bill 2 row 22 → Percentage item')).toBeNull();
    expect(within(screen.getByTestId('proposal-list')).getByText('Bill 2 row 23 → Percentage item')).toBeTruthy();
  });
});

describe('failures are reported clearly', () => {
  it('a corrupted workbook: the stage and the reason are shown, and nothing is proposed', async () => {
    const good = L.conventionalBq();
    const user = await openFile(good.slice(0, 100), 'SYNTHETIC_BROKEN.xlsx');
    await user.click(screen.getByRole('button', { name: 'Start extraction' }));
    const error = await screen.findByTestId('pipeline-error', {}, TIMEOUT);
    expect(error.textContent).toContain('Processing stopped at “Spreadsheet extraction”');
    expect(error.textContent).toContain('could not be read as an Excel workbook');
    expect(error.textContent).toContain('Nothing was extracted or proposed');
    expect(screen.queryByTestId('review-summary')).toBeNull();
  });

  it('an ambiguous CSV highlights the CSV settings; choosing the delimiter then works', async () => {
    const user = await openFile(utf8('a,b;c,d\ne,f;g,h\n'), 'SYNTHETIC.csv');
    await user.click(screen.getByRole('button', { name: 'Start extraction' }));
    expect((await screen.findByTestId('pipeline-error', {}, TIMEOUT)).textContent).toContain('ambiguous');
    await user.selectOptions(screen.getByLabelText('CSV delimiter'), ';');
    await user.click(screen.getByRole('button', { name: 'Start extraction' }));
    await screen.findByTestId('review-summary', {}, TIMEOUT);
  });
});
