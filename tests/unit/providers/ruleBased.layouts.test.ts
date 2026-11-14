/**
 * Stage 2G — the rule-based provider on different synthetic BQ layouts.
 * Every document is SYNTHETIC — NOT REAL COST DATA.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { verifyInterpretation } from '../../../src/core/evidence/index.ts';
import { RULE_BASED_INFO, createRuleBasedProvider } from '../../../src/providers/rule-based/index.ts';
import { RULE_BASED_LABEL } from '../../../src/providers/types.ts';
import { describeProviderContract } from '../../contract/providerContract.ts';
import { rolesByColumn, rowClassesByExcelRow, runAll, tableNamed } from '../../helpers/runProvider.ts';
import * as L from '../../helpers/synthetic/bqLayouts.ts';
import { extract, utf8 } from '../../helpers/synthetic/spreadsheets.ts';
import { addSourceDocument, createProject } from '../../../src/core/models/index.ts';

type Run = Awaited<ReturnType<typeof runAll>>;

/** Every answer passes the Stage 2E evidence verifier with no blocking finding. */
function expectAllVerified(loaded: L.Loaded, run: Run) {
  for (const a of run.all) {
    const report = verifyInterpretation(a, { project: loaded.project, tables: loaded.ctx.tables, documentId: loaded.ctx.document.id, provider: RULE_BASED_INFO });
    expect(report.findings.filter((f) => f.severity === 'blocking'), `${a.decisionKind} ${JSON.stringify(a.value)}`).toEqual([]);
  }
}

/** Every row of every table has exactly one row-type proposal (no row discarded). */
function expectEveryRowAccounted(loaded: L.Loaded, run: Run) {
  for (const table of loaded.extraction.tables) {
    const proposed = run.rows.filter((r) => r.value.tableId === table.id).map((r) => r.value.rowIndex).sort((a, b) => a - b);
    expect(proposed).toEqual(table.rows.map((r) => r.rowIndex));
  }
}

describe('provider identity', () => {
  it('is conventional rule-based processing, needing no network', () => {
    expect(RULE_BASED_INFO).toMatchObject({ id: 'rule-based', kind: 'rule-based', displayLabel: RULE_BASED_LABEL, requiresNetwork: false });
    expect(RULE_BASED_INFO.capabilities).not.toContain('relateDocuments');
    expect(RULE_BASED_INFO.capabilities).not.toContain('matchClaimLines');
  });
});

describe('conventional BQ (cover sheet, Bill 2, Bill 3 with another heading layout)', () => {
  let loaded: L.Loaded;
  let run: Run;
  beforeAll(async () => {
    loaded = await L.load(L.conventionalBq(), 'SYNTHETIC_BQ.xlsx');
    run = await runAll(loaded);
  });

  it('every answer passes the evidence verifier, and every row is accounted for', () => {
    expectAllVerified(loaded, run);
    expectEveryRowAccounted(loaded, run);
  });

  it('proposes a standard BQ, citing the headings it relied on', () => {
    const [doc] = run.documentType;
    expect(doc!.value.documentType).toBe('standard_bq');
    expect(doc!.quotedText).toEqual(expect.arrayContaining(['Description', 'Unit', 'Qty']));
    expect(doc!.status).toBe('proposed');
  });

  it('finds headings, the repeated heading on the next page, and proposes leaving out the cover sheet', () => {
    const cover = run.regions.find((r) => r.value.tableId === tableNamed(loaded, 'Cover').id)!;
    expect(cover.value).toMatchObject({ include: false, headerRowIndexes: [] });
    expect(cover.confidence).toBeLessThan(0.5); // left for a person to confirm
    const bill2 = run.regions.find((r) => r.value.tableId === tableNamed(loaded, 'Bill 2').id)!;
    expect(bill2.value).toMatchObject({ include: true, headerRowIndexes: [L.R(3)], repeatedHeaderRowIndexes: [L.R(18)], firstDataRowIndex: L.R(4), lastDataRowIndex: L.R(26) });
    const bill3 = run.regions.find((r) => r.value.tableId === tableNamed(loaded, 'Bill 3').id)!;
    expect(bill3.value).toMatchObject({ headerRowIndexes: [0] });
  });

  it('maps columns from headings and content, in any order', () => {
    expect(rolesByColumn(run.columns, tableNamed(loaded, 'Bill 2').id)).toEqual({ A: 'itemNo', B: 'description', C: 'unit', D: 'quantity', E: 'rate', F: 'amount' });
    expect(rolesByColumn(run.columns, tableNamed(loaded, 'Bill 3').id)).toEqual({ A: 'description', B: 'itemNo', C: 'unit', D: 'quantity', E: 'rate', F: 'amount' });
  });

  it('proposes a type for every row of Bill 2', () => {
    expect(rowClassesByExcelRow(run.rows, tableNamed(loaded, 'Bill 2').id)).toEqual({
      1: 'title', 2: 'blank', 3: 'column_header', 4: 'main_heading', 5: 'subheading',
      6: 'priced_item', 7: 'continuation', 8: 'priced_item', 9: 'priced_item', 10: 'priced_item', 11: 'priced_item',
      12: 'note_label', 13: 'note', 14: 'priced_item', 15: 'blank', 16: 'carried_forward', 17: 'reference', 18: 'column_header',
      19: 'priced_item', 20: 'provisional_sum', 21: 'prime_cost_sum', 22: 'percentage_item', 23: 'percentage_item',
      24: 'priced_item', 25: 'description_only_item', 26: 'total',
    });
  });

  it('keeps uncertain readings open with alternatives (sub-heading level, description-only item)', () => {
    const at = (excelRow: number) => run.rows.find((r) => r.value.tableId === tableNamed(loaded, 'Bill 2').id && r.value.rowIndex === L.R(excelRow))!;
    expect(at(5).alternatives?.map((a) => a.value.rowClass)).toEqual(['secondary_subheading', 'note']);
    expect(at(25).alternatives?.map((a) => a.value.rowClass)).toEqual(['main_heading', 'subheading']);
    expect(at(7).alternatives?.map((a) => a.value.rowClass)).toEqual(['note']);
  });

  it('proposes the hierarchy from headings in the document, and a bill heading inside Bill 3', () => {
    const bill2 = tableNamed(loaded, 'Bill 2').id;
    const h = (excelRow: number, tableId = bill2) => run.hierarchy.find((x) => x.value.tableId === tableId && x.value.rowIndex === L.R(excelRow))?.value;
    expect(h(4)).toMatchObject({ level: 'main_heading', parentRowIndex: null });
    expect(h(5)).toMatchObject({ level: 'subheading', parentRowIndex: L.R(4) });
    expect(h(6)).toMatchObject({ level: 'item', parentRowIndex: L.R(5) });
    expect(h(7)).toMatchObject({ level: 'continuation', parentRowIndex: L.R(6) });
    const bill3 = tableNamed(loaded, 'Bill 3').id;
    expect(h(2, bill3)).toMatchObject({ level: 'bill', parentRowIndex: null });
    expect(h(3, bill3)).toMatchObject({ level: 'item', parentRowIndex: L.R(2) });
  });

  it('suggests trades from the Cost Library taxonomy, citing the description', () => {
    const bill3 = tableNamed(loaded, 'Bill 3').id;
    const s = (excelRow: number, field: string) => run.suggestions.find((x) => x.value.tableId === bill3 && x.value.rowIndex === L.R(excelRow) && x.value.field === field);
    expect(s(3, 'tradeWork')?.value.label).toBe('05-concrete-works');
    expect(s(3, 'subTrade')?.value.label).toBe('Reinforced Concrete');
    expect(s(4, 'subTrade')?.value.label).toBe('Bar Reinforcement');
    expect(s(5, 'tradeWork')?.value.label).toBe('06-masonry-partitions');
    expect(s(5, 'tradeWork')?.quotedText).toEqual(['SYNTHETIC brickwork in cement mortar']);
  });

  it('a trade can come from the heading above, but a sub-trade never does', () => {
    const bill2 = tableNamed(loaded, 'Bill 2').id;
    const dewatering = run.suggestions.filter((x) => x.value.tableId === bill2 && x.value.rowIndex === L.R(11));
    expect(dewatering.map((x) => x.value.field)).toEqual(['tradeWork']);
    expect(dewatering[0]!.reasoning).toContain('heading above');
    expect(dewatering[0]!.quotedText).toEqual(['SYNTHETIC dewatering', 'Excavation in ordinary ground']);
  });
});

describe('contractor working file (with a hidden build-up sheet)', () => {
  let loaded: L.Loaded;
  let run: Run;
  beforeAll(async () => {
    loaded = await L.load(L.workingFile(), 'SYNTHETIC_WORKING.xlsx');
    run = await runAll(loaded);
  });

  it('is proposed as a working file, with "standard BQ" kept as an alternative', () => {
    expectAllVerified(loaded, run);
    expectEveryRowAccounted(loaded, run);
    expect(run.documentType[0]!.value.documentType).toBe('contractor_working_file');
    expect(run.documentType[0]!.alternatives?.map((a) => a.value.documentType)).toEqual(['standard_bq']);
  });

  it('maps cost rate, markup, selling rate and supplier columns', () => {
    expect(rolesByColumn(run.columns, tableNamed(loaded, 'Pricing').id)).toEqual({
      A: 'itemNo', B: 'description', C: 'unit', D: 'quantity', E: 'baseRate', F: 'profitPercent', G: 'tenderRate', H: 'amount', I: 'other',
    });
  });

  it('reads the hidden sheet too, and says it is hidden', () => {
    const hidden = run.regions.find((r) => r.value.tableId === tableNamed(loaded, 'Rates build-up').id)!;
    expect(hidden.reasoning).toContain('hidden');
    expect(rolesByColumn(run.columns, hidden.value.tableId)).toMatchObject({ B: 'other', C: 'other', D: 'other', E: 'baseRate' });
  });
});

describe('progress claim (two-row headings with merged group headings)', () => {
  let loaded: L.Loaded;
  let run: Run;
  beforeAll(async () => {
    loaded = await L.load(L.progressClaim(), 'SYNTHETIC_CLAIM.xlsx');
    run = await runAll(loaded);
  });

  it('is proposed as a progress claim', () => {
    expectAllVerified(loaded, run);
    expectEveryRowAccounted(loaded, run);
    expect(run.documentType[0]!.value.documentType).toBe('progress_claim');
  });

  it('uses the group heading row above the column headings', () => {
    expect(run.regions[0]!.value.headerRowIndexes).toEqual([L.R(2), L.R(3)]);
    expect(rowClassesByExcelRow(run.rows, run.regions[0]!.value.tableId)).toMatchObject({ 1: 'title', 2: 'column_header', 3: 'column_header', 4: 'priced_item', 5: 'priced_item' });
  });

  it('maps previous, current and cumulative quantities and amounts, and % complete', () => {
    expect(rolesByColumn(run.columns, run.regions[0]!.value.tableId)).toEqual({
      A: 'itemNo', B: 'description', C: 'unit', D: 'quantity', E: 'rate', F: 'amount',
      G: 'claimPreviousQuantity', H: 'claimPreviousAmount', I: 'claimCurrentQuantity', J: 'claimCurrentAmount',
      K: 'claimCumulativeQuantity', L: 'claimCumulativeAmount', M: 'claimPercentComplete',
    });
  });

  it('cites the merged group heading as evidence for a claim column', () => {
    const prevQty = run.columns.find((c) => c.value.role === 'claimPreviousQuantity')!;
    expect(prevQty.quotedText).toEqual(expect.arrayContaining(['Qty', 'Previous Claim']));
  });
});

describe('unusual headings', () => {
  it('Malay headings (Bil, Perkara, Kuantiti, Kadar, Jumlah)', async () => {
    const loaded = await L.load(L.malayHeadings(), 'SYNTHETIC_BIL.xlsx');
    const run = await runAll(loaded);
    expectAllVerified(loaded, run);
    expect(rolesByColumn(run.columns, run.regions[0]!.value.tableId)).toEqual({ A: 'itemNo', B: 'description', C: 'unit', D: 'quantity', E: 'rate', F: 'amount' });
  });

  it('several quantity columns: the "Total Qty" is the quantity, the others are additional quantities', async () => {
    const loaded = await L.load(L.multipleQuantities(), 'SYNTHETIC_TOWERS.xlsx');
    const run = await runAll(loaded);
    expectAllVerified(loaded, run);
    expect(rolesByColumn(run.columns, run.regions[0]!.value.tableId)).toMatchObject({ D: 'additionalQuantity', E: 'additionalQuantity', F: 'quantity', G: 'rate', H: 'amount' });
    const towerA = run.columns.find((c) => c.value.columnIndex === 3)!;
    expect(towerA.alternatives?.map((a) => a.value.role)).toEqual(['quantity']);
  });

  it('misleading headings do not produce unsupported mappings', async () => {
    const loaded = await L.load(L.misleadingHeadings(), 'SYNTHETIC_ODD.xlsx');
    const run = await runAll(loaded);
    expectAllVerified(loaded, run);
    const roles = rolesByColumn(run.columns, run.regions[0]!.value.tableId);
    expect(roles['B']).toBe('unknown'); // "Description" over numbers
    expect(roles['D']).toBe('unknown'); // "Qty" over long text
    const qty = run.columns.find((c) => c.value.columnIndex === 3)!;
    expect(qty.alternatives?.map((a) => a.value.role)).toEqual(['quantity', 'description']);
    expect(qty.reasoning).toContain('does not match the content');
    // With no trusted description column, the rows are not called priced items.
    expect(Object.values(rowClassesByExcelRow(run.rows, run.regions[0]!.value.tableId)).slice(1)).toEqual(['unknown', 'unknown', 'unknown']);
  });

  it('a CSV BQ is interpreted the same way', async () => {
    const extraction = await extract(utf8('Item,Description,Unit,Qty,Rate,Amount\nA,SYNTHETIC blockwork wall,m2,10,30.00,300.00\n'), 'SYNTHETIC.csv');
    const project = addSourceDocument(createProject({ id: 'proj-synthetic', name: 'SYNTHETIC' }), extraction.document);
    const loaded = { extraction, project, ctx: { project, document: extraction.document, tables: extraction.tables } };
    const run = await runAll(loaded);
    expectAllVerified(loaded, run);
    expect(rolesByColumn(run.columns, extraction.tables[0]!.id)).toEqual({ A: 'itemNo', B: 'description', C: 'unit', D: 'quantity', E: 'rate', F: 'amount' });
    expect(run.suggestions.find((s) => s.value.field === 'subTrade')?.value.label).toBe('Blockwork');
  });
});

describe('ambiguous and incomplete documents stay unresolved', () => {
  it('a few lines of text and a number: document type unknown, no table, rows unknown', async () => {
    const loaded = await L.load(L.incompleteDocument(), 'SYNTHETIC_NOTES.xlsx');
    const run = await runAll(loaded);
    expectAllVerified(loaded, run);
    expectEveryRowAccounted(loaded, run);
    expect(run.documentType[0]!.value.documentType).toBe('unknown');
    expect(run.documentType[0]!.reasoning).toContain('Left unknown');
    expect(run.regions[0]!.value.include).toBe(false);
    expect(run.columns).toEqual([]);
    expect(new Set(run.rows.map((r) => r.value.rowClass))).toEqual(new Set(['unknown']));
    expect(run.hierarchy).toEqual([]);
    expect(run.suggestions).toEqual([]);
  });

  it('an empty document gets no proposals at all (nothing to cite)', async () => {
    const p = createRuleBasedProvider();
    const loaded = await L.load(L.incompleteDocument(), 'SYNTHETIC.xlsx');
    const empty = { ...loaded.ctx, tables: loaded.ctx.tables.map((t) => ({ ...t, rows: [] })) };
    expect(await p.classifyDocument(empty)).toEqual([]);
    expect(await p.detectTableRegions(empty)).toEqual([]);
  });
});

// The same shared contract every provider must pass (Stage 2E), run on the rule-based provider.
const contractFixture = await L.load(L.conventionalBq(), 'SYNTHETIC_BQ.xlsx');
describeProviderContract('rule-based', createRuleBasedProvider, {
  project: contractFixture.project,
  document: contractFixture.ctx.document,
  tables: contractFixture.ctx.tables,
});
