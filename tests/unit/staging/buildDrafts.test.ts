/**
 * Stage 2J — draft rows from approved decisions, and every safeguard the owner set.
 * SYNTHETIC — NOT REAL COST DATA.
 */
import { describe, expect, it } from 'vitest';
import { cellValueForParsing, findCell, findRow } from '../../../src/core/models/index.ts';
import { reopenProposal } from '../../../src/core/evidence/index.ts';
import { recordChanges, validateReviewRecord } from '../../../src/core/review/index.ts';
import { type DraftResult, ROW_CATEGORIES, type TableDrafts, verifyDrafts } from '../../../src/core/staging/index.ts';
import { draftsBq } from '../../helpers/synthetic/draftLayouts.ts';
import * as L from '../../helpers/synthetic/bqLayouts.ts';
import { newReview } from '../../helpers/reviews.ts';
import { AT, SYNTHETIC_PROJECT, approveAll, correct, drafts, proposalOf, reject, withProject } from '../../helpers/drafts.ts';

const SHEET4 = 'doc-review:sheet:0';
const SHEET5 = 'doc-review:sheet:1';

async function setup() {
  const { run, review } = await newReview(draftsBq(), 'SYNTHETIC_DRAFTS.xlsx');
  return { run, review: withProject(approveAll(review)) };
}
const table = (d: DraftResult, name: string) => d.tables.find((t) => t.name === name)!;
const draftAt = (t: TableDrafts, excelRow: number) => t.drafts.find((d) => d.itemRowIndex === excelRow - 1)!;
const codes = (t: TableDrafts, excelRow: number) => draftAt(t, excelRow).row.issues.map((i) => `${i.code}:${i.severity}:${i.field ?? ''}`);

/** Every source row is accounted for exactly once, in every table. */
function expectAllAccounted(d: DraftResult, run: Awaited<ReturnType<typeof setup>>['run']) {
  for (const t of d.tables) {
    const rows = run.extraction.tables.find((x) => x.id === t.tableId)!.rows;
    expect(ROW_CATEGORIES.reduce((n, c) => n + t.counts[c], 0), t.name).toBe(rows.length);
    expect(t.accounts.map((a) => a.rowIndex).sort((a, b) => a - b), t.name).toEqual(rows.map((r) => r.rowIndex).sort((a, b) => a - b));
  }
}

describe('drafts from approved decisions', () => {
  it('builds draft rows for both approved tables, every value traced, every source row accounted for', async () => {
    const { run, review } = await setup();
    const d = drafts(review, run);
    expect(d.documentBlockers).toEqual([]);
    expect(d.projectIssues).toEqual([]);
    expect(table(d, 'Bill 4')).toMatchObject({ status: 'ready' });
    expect(table(d, 'Bill 5')).toMatchObject({ status: 'ready' });
    expect(table(d, 'Bill 4').drafts.map((x) => x.row.item.itemNo)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', undefined]);
    expect(verifyDrafts(d, run.extraction.tables)).toEqual([]);
    expectAllAccounted(d, run);
    expect(table(d, 'Bill 4').counts).toMatchObject({ draft_item: 7, continuation: 1, header: 1, heading: 1, total_or_carried: 1, outside_table_area: 1 });
  });

  it('nothing is drafted from undecided proposals: every table blocked, every row still accounted for', async () => {
    const { run, review } = await newReview(draftsBq(), 'SYNTHETIC_DRAFTS.xlsx');
    const d = drafts(review, run);
    expect(d.documentBlockers).toContain('The document type has not been decided yet.');
    expect(d.tables.map((t) => t.status)).toEqual(['blocked', 'blocked']);
    expect(d.tables.every((t) => t.drafts.length === 0)).toBe(true);
    expectAllAccounted(d, run);
  });

  it('a progress claim is never turned into BQ rows', async () => {
    const { run, review } = await setup();
    const doc = proposalOf(review, 'documentType', {});
    const reopened = recordChanges(review, [{ before: doc, after: reopenProposal(doc) }], AT, null);
    const r = correct(reopened, run, reopened.proposals.find((p) => p.id === doc.id)!, { documentType: 'progress_claim' });
    const d = drafts(r, run);
    expect(d.tables.map((t) => t.status)).toEqual(['not_converted', 'not_converted']);
    expect(d.tables[0]!.reasons[0]).toContain('Claim data is never turned into BQ rows');
    expectAllAccounted(d, run);
  });
});

describe('decision 1 — a placeholder 0 is never a genuine zero', () => {
  it('a figure stated as 0 is a real zero; an empty cell is a placeholder with a BLOCKING issue', async () => {
    const { run, review } = await setup();
    const t = table(drafts(review, run), 'Bill 4');
    const stated = draftAt(t, 4).row; // "0" in Qty and Amount
    expect(stated.item.quantity).toBe(0);
    expect(stated.evidence.quantity).toMatchObject({ state: 'zero', parsed: 0, raw: 0 });
    expect(stated.placeholders.map((p) => p.field)).toEqual([]);
    expect(stated.issues.filter((i) => i.code === 'REQUIRED_FIELD_NOT_IN_SOURCE')).toEqual([]);

    const empty = draftAt(t, 5).row; // Rate and Amount cells empty
    expect(empty.item.rate).toBe(0);
    expect(empty.evidence.rate.state).not.toBe('zero');
    expect(empty.evidence.rate.parsed).toBeNull();
    expect(empty.placeholders).toContainEqual({ field: 'rate', placeholder: 0, reason: empty.evidence.rate.state });
    expect(codes(t, 5)).toContain('REQUIRED_FIELD_NOT_IN_SOURCE:blocking:rate');
    expect(codes(t, 5)).toContain('REQUIRED_FIELD_NOT_IN_SOURCE:blocking:amount');
  });

  it('markers such as "Rate Only", "-" and "Nil" are placeholders too, never zero (conventional BQ)', async () => {
    const { run, review } = await newReview(L.conventionalBq());
    const t = table(drafts(withProject(approveAll(review)), run), 'Bill 2');
    const rateOnly = draftAt(t, 10).row;
    expect(rateOnly.evidence.quantity).toMatchObject({ state: 'special', special: 'RATE_ONLY', parsed: null });
    expect(codes(t, 10)).toContain('REQUIRED_FIELD_NOT_IN_SOURCE:blocking:quantity');
    const dash = draftAt(t, 14).row;
    expect([dash.evidence.quantity.special, dash.evidence.amount.special]).toEqual(['NIL_DASH', 'NIL']);
    expect(dash.placeholders.map((p) => p.field)).toEqual(['quantity', 'rate', 'amount']);
  });
});

describe('nothing is calculated', () => {
  it('no quantity, rate, amount, extension or total is worked out: every figure is its own cell or a placeholder', async () => {
    const { run, review } = await setup();
    const d = drafts(review, run);
    for (const t of d.tables.filter((x) => x.status === 'ready')) {
      const source = run.extraction.tables.find((x) => x.id === t.tableId)!;
      for (const dr of t.drafts) {
        for (const field of ['quantity', 'rate', 'amount'] as const) {
          const e = dr.row.evidence[field];
          const placeholder = dr.row.placeholders.some((p) => p.field === field);
          if (placeholder) expect(dr.row.item[field]).toBe(0);
          else {
            const cell = findCell(findRow(source, dr.itemRowIndex)!, dr.cells[field]![0]!.columnIndex!)!;
            expect(dr.row.item[field]).toBe(cellValueForParsing(cell));
            expect(e.sources).toEqual([cell.source]);
          }
        }
      }
    }
    // B has Qty 100 but no rate: its amount is NOT 100 × rate, it stays a placeholder.
    expect(draftAt(table(d, 'Bill 4'), 5).row.placeholders.map((p) => p.field)).toEqual(['rate', 'amount']);
    expect(table(d, 'Bill 4').statedTotals).toEqual([expect.objectContaining({ label: 'Total carried to Collection', amountText: '2150' })]);
  });
});

describe('decision 2 — a lump sum keeps its quantity "not stated"', () => {
  it('unit "LS" with no quantity: quantity is a placeholder, never 1; the rate is not worked out from the amount', async () => {
    const { run, review } = await setup();
    const t = table(drafts(review, run), 'Bill 4');
    const ls = draftAt(t, 6);
    expect(ls.unit).toMatchObject({ asWritten: 'LS', meaning: 'lump_sum' });
    expect(ls.row.item.quantity).toBe(0);
    expect(ls.row.item.quantity).not.toBe(1);
    expect(ls.row.placeholders.map((p) => p.field)).toEqual(['quantity', 'rate']);
    expect(ls.row.item.amount).toBe(800);
    expect(codes(t, 6)).toEqual(expect.arrayContaining(['REQUIRED_FIELD_NOT_IN_SOURCE:blocking:quantity', 'LUMP_SUM_QUANTITY_NOT_STATED:info:quantity']));
  });
});

describe('decision 3 — project name and year are typed in, never inferred', () => {
  it('without them the drafts still appear, each with BLOCKING issues; the file name is never used', async () => {
    const { run, review } = await newReview(draftsBq(), 'SYNTHETIC_DRAFTS.xlsx');
    const d = drafts(approveAll(review), run);
    expect(d.projectIssues.map((i) => i.code)).toEqual(['PROJECT_NAME_NOT_ENTERED', 'PROJECT_YEAR_NOT_ENTERED']);
    const row = draftAt(table(d, 'Bill 5'), 3).row;
    expect(table(d, 'Bill 5').status).toBe('ready');
    expect(row.item.projectName).toBe('');
    expect(row.item.projectYear).toBe('');
    expect(row.placeholders.map((p) => p.field)).toEqual(['projectName', 'projectYear']);
    expect(row.issues.filter((i) => i.severity === 'blocking').map((i) => i.code)).toEqual(['PROJECT_NAME_NOT_ENTERED', 'PROJECT_YEAR_NOT_ENTERED']);
    expect(JSON.stringify(d)).not.toContain('"projectName":"SYNTHETIC_DRAFTS');
  });

  it('only the year missing: the name is used, the year blocks', async () => {
    const { run, review } = await newReview(draftsBq(), 'SYNTHETIC_DRAFTS.xlsx');
    const d = drafts(withProject(approveAll(review), { ...SYNTHETIC_PROJECT, year: null }), run);
    const row = draftAt(table(d, 'Bill 5'), 3).row;
    expect(row.item.projectName).toBe(SYNTHETIC_PROJECT.name);
    expect(row.issues.filter((i) => i.severity === 'blocking').map((i) => i.code)).toEqual(['PROJECT_YEAR_NOT_ENTERED']);
  });
});

describe('decision 4 — units exactly as written', () => {
  it('"M2" and "sq.m" are kept; the Cost Library spelling is shown separately, not applied', async () => {
    const { run, review } = await setup();
    const t = table(drafts(review, run), 'Bill 4');
    expect(draftAt(t, 4).row.item.unit).toBe('M2');
    expect(draftAt(t, 4).unit).toEqual({ asWritten: 'M2', costLibrarySpelling: 'm²', differs: true, meaning: null });
    expect(draftAt(t, 5).row.item.unit).toBe('sq.m');
    expect(draftAt(t, 5).unit.costLibrarySpelling).toBe('m²');
    expect(draftAt(t, 8).unit).toMatchObject({ asWritten: 'm', differs: false });
  });
});

describe('exact descriptions, item numbers, negatives', () => {
  it('descriptions and item numbers are the cells\' text exactly', async () => {
    const { run, review } = await setup();
    const t = table(drafts(review, run), 'Bill 5');
    expect(draftAt(t, 3).row.item).toMatchObject({ itemNo: 'A', originalItemNo: 'A', description: 'SYNTHETIC 150mm diameter uPVC pipe' });
  });

  it('a negative credit keeps its sign and BLOCKING issues', async () => {
    const { run, review } = await setup();
    const t = table(drafts(review, run), 'Bill 4');
    expect(draftAt(t, 7).row.item).toMatchObject({ rate: -200, amount: -200, originalRate: -200, originalAmount: -200 });
    expect(codes(t, 7)).toEqual(expect.arrayContaining(['NEGATIVE_VALUE:blocking:rate', 'NEGATIVE_VALUE:blocking:amount']));
  });
});

describe('continuation rows', () => {
  it('joined with one space; every contributing cell kept and verifiable', async () => {
    const { run, review } = await setup();
    const d = drafts(review, run);
    const e = draftAt(table(d, 'Bill 4'), 8);
    expect(e.row.item.description).toBe('SYNTHETIC excavate trench for drainage pipe not exceeding 1.00m deep, including backfilling');
    expect(e.continuationRowIndexes).toEqual([8]);
    expect(e.descriptionParts.map((p) => [p.source.kind === 'worksheet' ? p.source.cellAddress : '', p.text])).toEqual([
      ['B8', 'SYNTHETIC excavate trench for drainage pipe'],
      ['B9', 'not exceeding 1.00m deep, including backfilling'],
    ]);
    expect(e.row.evidence.description.sources.map((s) => (s.kind === 'worksheet' ? s.cellAddress : ''))).toEqual(['B8', 'B9']);
    expect(e.row.evidence.description.derivation?.rule).toBe('join_continuation_rows');
    expect(e.row.sources.map((s) => (s.kind === 'worksheet' ? s.rowNumber : 0))).toEqual([8, 9]);
    expect(table(d, 'Bill 4').accounts.find((a) => a.rowIndex === 8)).toMatchObject({ category: 'continuation', draftId: e.row.id });

    // The check catches a joined description that no longer matches its cells.
    const tampered = JSON.parse(JSON.stringify(d));
    tampered.tables[0].drafts.find((x: { itemRowIndex: number }) => x.itemRowIndex === 7).descriptionParts[1].text = 'EDITED';
    expect(verifyDrafts(tampered, run.extraction.tables).join(' ')).toContain('does not match the cell');
  });

  it('values on a continuation row outside the description are NOT used and BLOCK the item', async () => {
    const { run, review: r0 } = await setup();
    // A person decides row 11 ("laid straight", Qty 3) is a continuation of item F (row 10).
    const cls = proposalOf(r0, 'rowClass', { tableId: SHEET4, rowIndex: 10 });
    const lvl = proposalOf(r0, 'hierarchy', { tableId: SHEET4, rowIndex: 10 });
    let r = recordChanges(r0, [{ before: cls, after: reopenProposal(cls) }, { before: lvl, after: reopenProposal(lvl) }], AT, null);
    r = correct(r, run, r.proposals.find((p) => p.id === cls.id)!, { tableId: SHEET4, rowIndex: 10, rowClass: 'continuation' });
    r = correct(r, run, r.proposals.find((p) => p.id === lvl.id)!, { tableId: SHEET4, rowIndex: 10, level: 'continuation', parentRowIndex: 9 });
    expect(validateReviewRecord(r)).toEqual([]);
    const t = table(drafts(r, run), 'Bill 4');
    const f = draftAt(t, 10);
    expect(f.row.item.description).toBe('SYNTHETIC precast concrete kerb laid straight');
    expect(f.row.item.quantity).toBe(25); // the item's own Qty; the "3" on the continuation row is not used
    expect(codes(t, 10)).toContain('CONTINUATION_VALUES_NOT_USED:blocking:description');
    expect(f.row.issues.find((i) => i.code === 'CONTINUATION_VALUES_NOT_USED')!.message).toContain('D: "3"');
  });

  it('a continuation whose item is not decided blocks its table (it is never attached by guesswork)', async () => {
    const { run, review: r0 } = await setup();
    const lvl = proposalOf(r0, 'hierarchy', { tableId: SHEET4, rowIndex: 8 });
    let r = recordChanges(r0, [{ before: lvl, after: reopenProposal(lvl) }], AT, null);
    r = reject(r, r.proposals.find((p) => p.id === lvl.id)!);
    const t = table(drafts(r, run), 'Bill 4');
    expect(t.status).toBe('blocked');
    expect(t.reasons.join(' ')).toContain('Row 9 is a continuation row, but which item it belongs to has not been decided');
  });
});

describe('decision 5 — unclassified rows are listed, never guessed', () => {
  it('a row decided as "unknown", and a row whose type was rejected, are not drafted and are listed', async () => {
    const { run, review: r0 } = await setup();
    const kerb = proposalOf(r0, 'rowClass', { tableId: SHEET4, rowIndex: 10 });
    const pipe = proposalOf(r0, 'rowClass', { tableId: SHEET5, rowIndex: 3 });
    let r = recordChanges(r0, [{ before: kerb, after: reopenProposal(kerb) }, { before: pipe, after: reopenProposal(pipe) }], AT, null);
    r = correct(r, run, r.proposals.find((p) => p.id === kerb.id)!, { tableId: SHEET4, rowIndex: 10, rowClass: 'unknown' });
    r = reject(r, r.proposals.find((p) => p.id === pipe.id)!);
    const d = drafts(r, run);
    const b4 = table(d, 'Bill 4');
    const b5 = table(d, 'Bill 5');
    expect([b4.status, b5.status]).toEqual(['ready', 'ready']);
    expect(b4.drafts.some((x) => x.itemRowIndex === 10)).toBe(false);
    expect(b4.accounts.find((a) => a.rowIndex === 10)).toMatchObject({ category: 'unclassified', detail: expect.stringContaining('not guessed') });
    expect(b5.accounts.find((a) => a.rowIndex === 3)).toMatchObject({ category: 'unclassified', detail: expect.stringContaining('rejected without a correction') });
    expect(b4.counts.unclassified + b5.counts.unclassified).toBe(2);
    expectAllAccounted(d, run);
  });
});

describe('decision 6 — tables are independent', () => {
  it('an undecided row in Bill 5 blocks only Bill 5; Bill 4 still produces its drafts', async () => {
    const { run, review: r0 } = await setup();
    const p = proposalOf(r0, 'rowClass', { tableId: SHEET5, rowIndex: 3 });
    const r = recordChanges(r0, [{ before: p, after: reopenProposal(p) }], AT, null);
    const d = drafts(r, run);
    expect(table(d, 'Bill 5')).toMatchObject({ status: 'blocked', drafts: [] });
    expect(table(d, 'Bill 5').reasons.join(' ')).toContain('row type has not been decided');
    expect(table(d, 'Bill 5').accounts.find((a) => a.rowIndex === 3)!.category).toBe('undecided');
    expect(table(d, 'Bill 5').counts).toMatchObject({ draft_item: 0, blocked_item: 1 }); // row 3: an item, but not drafted
    expect(table(d, 'Bill 4')).toMatchObject({ status: 'ready' });
    expect(table(d, 'Bill 4').drafts).toHaveLength(7);
    expectAllAccounted(d, run);
  });

  it('an unknown column blocks Bill 4 only; a claim column is refused; Bill 5 stays ready', async () => {
    const { run, review: r0 } = await setup();
    const col = proposalOf(r0, 'columnRole', { tableId: SHEET4, columnIndex: 4 });
    let r = recordChanges(r0, [{ before: col, after: reopenProposal(col) }], AT, null);
    r = correct(r, run, r.proposals.find((p) => p.id === col.id)!, { tableId: SHEET4, columnIndex: 4, role: 'unknown' });
    let d = drafts(r, run);
    expect(table(d, 'Bill 4').status).toBe('blocked');
    expect(table(d, 'Bill 4').reasons.join(' ')).toContain('Column E: its meaning is "unknown"');
    expect(table(d, 'Bill 5').status).toBe('ready');

    const col5 = proposalOf(r0, 'columnRole', { tableId: SHEET5, columnIndex: 3 });
    r = recordChanges(r0, [{ before: col5, after: reopenProposal(col5) }], AT, null);
    r = correct(r, run, r.proposals.find((p) => p.id === col5.id)!, { tableId: SHEET5, columnIndex: 3, role: 'claimCurrentQuantity' });
    d = drafts(r, run);
    expect(table(d, 'Bill 5').reasons.join(' ')).toContain('Claim data is never mixed into BQ rows');
    expect(table(d, 'Bill 4').status).toBe('ready');
  });
});

describe('trade, sub-trade (D-008): only approved suggestions', () => {
  it('pending and rejected suggestions leave the fields blank', async () => {
    const { run, review } = await newReview(L.conventionalBq());
    const d = drafts(withProject(approveAll(review, (p) => p.interpretation.decisionKind === 'classificationSuggestion')), run);
    const a = draftAt(table(d, 'Bill 2'), 6).row;
    expect(a.item.tradeWork).toBeUndefined();
    expect(a.proposals.map((p) => p.status)).toEqual(['pending', 'pending']);
    const approved = draftAt(table(drafts(withProject(approveAll(review)), run), 'Bill 2'), 6).row;
    expect(approved.item).toMatchObject({ tradeWork: '03-earthworks-substructure', subTrade: 'Excavation' });
  });
});
