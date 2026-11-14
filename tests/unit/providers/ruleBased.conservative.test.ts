/**
 * Stage 2G — the rule-based provider stays conservative: nothing calculated, removed, combined
 * or changed, and uncertain readings stay open. SYNTHETIC — NOT REAL COST DATA.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { runAll, rowClassesByExcelRow, tableNamed } from '../../helpers/runProvider.ts';
import * as L from '../../helpers/synthetic/bqLayouts.ts';

type Run = Awaited<ReturnType<typeof runAll>>;

function allKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (value !== null && typeof value === 'object') for (const [k, v] of Object.entries(value)) {
    out.add(k);
    allKeys(v, out);
  }
  return out;
}

describe('the original data is never changed', () => {
  it('the extracted tables are identical before and after interpretation', async () => {
    const loaded = await L.load(L.conventionalBq(), 'SYNTHETIC_BQ.xlsx');
    const before = JSON.stringify(loaded.extraction.tables);
    await runAll(loaded);
    expect(JSON.stringify(loaded.extraction.tables)).toBe(before);
  });
});

describe('no figures, units or descriptions are supplied — missing values stay missing', () => {
  let loaded: L.Loaded;
  let run: Run;
  beforeAll(async () => {
    loaded = await L.load(L.conventionalBq(), 'SYNTHETIC_BQ.xlsx');
    run = await runAll(loaded);
  });

  it('no answer (or alternative) contains a quantity, rate, amount, unit or description field', () => {
    for (const a of run.all) {
      const keys = allKeys([a.value, ...(a.alternatives ?? []).map((x) => x.value)]);
      for (const k of ['quantity', 'qty', 'rate', 'amount', 'unit', 'description', 'total', 'value']) expect(keys.has(k)).toBe(false);
    }
  });

  it('the lump-sum row (unit "L.S.", Qty blank) is an item — no quantity of 1 appears anywhere', () => {
    const bill2 = tableNamed(loaded, 'Bill 2');
    const row11 = run.rows.find((r) => r.value.tableId === bill2.id && r.value.rowIndex === L.R(11))!;
    expect(row11.value.rowClass).toBe('priced_item');
    expect(row11.quotedText).toEqual(['E', 'SYNTHETIC dewatering', 'L.S.', '500']); // the Qty cell is not cited: it is empty
    expect(bill2.rows[L.R(11)]!.cells.find((c) => c.columnIndex === 3)).toBeUndefined();
  });

  it('dash and Nil stay as written in the source and in the quotes', () => {
    const row14 = run.rows.find((r) => r.value.tableId === tableNamed(loaded, 'Bill 2').id && r.value.rowIndex === L.R(14))!;
    expect(row14.quotedText).toEqual(['F', 'SYNTHETIC concrete grade 30 in pile caps', 'm3', '-', 'Nil']);
    expect(row14.reasoning).not.toMatch(/\b0\b/);
  });

  it('negative figures are quoted as written', () => {
    const row9 = run.rows.find((r) => r.value.tableId === tableNamed(loaded, 'Bill 2').id && r.value.rowIndex === L.R(9))!;
    expect(row9.quotedText).toEqual(['C', 'SYNTHETIC omission of temporary works', 'item', '1', '-50', '-50']);
  });
});

describe('nothing is combined, removed or discarded', () => {
  let loaded: L.Loaded;
  let run: Run;
  beforeAll(async () => {
    loaded = await L.load(L.conventionalBq(), 'SYNTHETIC_BQ.xlsx');
    run = await runAll(loaded);
  });

  it('the continuation line keeps its own row and proposal; the item description is not extended', () => {
    const bill2 = tableNamed(loaded, 'Bill 2');
    const item = run.rows.find((r) => r.value.tableId === bill2.id && r.value.rowIndex === L.R(6))!;
    expect(item.quotedText![1]).toBe('SYNTHETIC excavation for pile caps, depth not exceeding 1.50m');
    expect(run.rows.find((r) => r.value.tableId === bill2.id && r.value.rowIndex === L.R(7))!.value.rowClass).toBe('continuation');
    expect(run.hierarchy.find((h) => h.value.tableId === bill2.id && h.value.rowIndex === L.R(7))!.reasoning).toContain('not joined');
  });

  it('a duplicate-looking row is kept and classified like any other row', () => {
    const classes = rowClassesByExcelRow(run.rows, tableNamed(loaded, 'Bill 2').id);
    expect(classes[6]).toBe('priced_item');
    expect(classes[19]).toBe('priced_item');
  });

  it('notes, page markers, repeated headings and totals are kept as rows of their own', () => {
    const classes = rowClassesByExcelRow(run.rows, tableNamed(loaded, 'Bill 2').id);
    expect([classes[12], classes[13], classes[16], classes[17], classes[18], classes[26]]).toEqual(['note_label', 'note', 'carried_forward', 'reference', 'column_header', 'total']);
  });
});

describe('a number does not make a priced item; text does not make a heading', () => {
  async function classesOf(rows: (string | number | null)[][]) {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([L.HEADER, ...rows]), 'S');
    const loaded = await L.load(new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' })), 'SYNTHETIC.xlsx');
    const run = await runAll(loaded);
    return { run, classes: rowClassesByExcelRow(run.rows, loaded.extraction.tables[0]!.id) };
  }

  it('a figure with no description is unknown (possibly a total), not a priced item', async () => {
    const { run, classes } = await classesOf([[null, null, null, null, null, 1250]]);
    expect(classes[2]).toBe('unknown');
    expect(run.rows[1]!.alternatives?.map((a) => a.value.rowClass)).toEqual(['subtotal']);
  });

  it('long text with no figures is a note, not a heading', async () => {
    const { classes } = await classesOf([[null, 'SYNTHETIC GENERAL CLAUSE. All work shall comply with the synthetic specification; the contractor shall allow for everything necessary.']]);
    expect(classes[2]).toBe('note');
  });

  it('a percentage without context is not taken as a percentage item', async () => {
    const { run, classes } = await classesOf([
      ['A', 'SYNTHETIC ordinary item one', 'm2', 10, 10, 100],
      ['B', 'SYNTHETIC ordinary item two', 'm2', 20, 10, 200],
      ['C', 'SYNTHETIC ordinary item three', 'm2', '5%', 10, null],
    ]);
    expect([classes[2], classes[3]]).toEqual(['priced_item', 'priced_item']);
    expect(classes[4]).toBe('unknown');
    expect(run.rows[3]!.alternatives?.map((a) => a.value.rowClass)).toEqual(['percentage_item', 'priced_item']);
  });

  it('"%" as the unit with profit / attendance wording is a percentage item', async () => {
    const { classes } = await classesOf([[null, 'Allow for profit', '%', 5, null, null]]);
    expect(classes[2]).toBe('percentage_item');
  });

  it('a heading reading "PROVISIONAL SUMS" with no figures is a heading, not a Provisional Sum item', async () => {
    const { classes } = await classesOf([[null, 'PROVISIONAL SUMS'], ['A', 'Provisional Sum for SYNTHETIC signage', 'sum', null, null, 1000]]);
    expect(classes[2]).toBe('main_heading');
    expect(classes[3]).toBe('provisional_sum');
  });
});
