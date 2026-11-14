/**
 * Stage 2E — "L.S." means different things in different columns, and D-011 is preserved.
 * SYNTHETIC — NOT REAL COST DATA.
 */
import { describe, expect, it } from 'vitest';
import { parseNumberCell, parseUnitCell } from '../../../src/core/parsing/index.ts';
import { createStagedBQRow } from '../../../src/core/models/index.ts';
import { BQ_XLSX, COL, TODAY, bqCell, fromBq, syntheticProject } from '../../helpers/synthetic/models.ts';
import { parseTextCell } from '../../../src/core/parsing/index.ts';

const unitCell = fromBq(11, COL.unit);
const LS_SPELLINGS = ['L.S.', 'LS', 'l.s.', 'L.S', 'Lump Sum', 'LUMP SUM', 'lumpsum'];

describe('"L.S." in the UNIT column is kept as a unit meaning lump sum', () => {
  it.each(LS_SPELLINGS)('"%s" stays exactly "%s", state value, meaning lump_sum', (raw) => {
    const r = parseUnitCell(raw, unitCell);
    expect(r.evidence.state).toBe('value');
    expect(r.evidence.parsed).toBe(raw);
    expect(r.evidence.raw).toBe(raw);
    expect(r.evidence.special).toBeUndefined(); // a unit, not a marker
    expect(r.meaning).toBe('lump_sum');
    expect(r.recognised).toBe(true);
  });

  it('ordinary units have no special meaning; "%" means percentage', () => {
    expect(parseUnitCell('m2', unitCell).meaning).toBeNull();
    expect(parseUnitCell('%', unitCell).meaning).toBe('percentage');
  });
});

describe('"L.S." in a Qty, Rate or Amount column is a LUMP_SUM marker', () => {
  it.each(['quantity', 'money'] as const)('in a %s column: marker LUMP_SUM, no value', (kind) => {
    for (const raw of LS_SPELLINGS) {
      const { evidence } = parseNumberCell(raw, kind, fromBq(11, COL.quantity));
      expect(evidence.state).toBe('special');
      expect(evidence.special).toBe('LUMP_SUM');
      expect(evidence.parsed).toBeNull();
    }
  });
});

describe('never a quantity of 1', () => {
  it('a row with unit "L.S.", a blank Qty and an amount keeps its quantity as a recorded gap', () => {
    const row = createStagedBQRow({
      id: 'ls-row', project: syntheticProject(), documentId: BQ_XLSX.id, rowClass: 'priced_item', sequence: 11, sources: [bqCell(11)], today: TODAY,
      evidence: {
        description: parseTextCell('SYNTHETIC TEST ITEM 002', fromBq(11, COL.description)),
        unit: parseUnitCell('L.S.', unitCell).evidence,
        quantity: parseNumberCell(null, 'quantity', fromBq(11, COL.quantity)).evidence,
        rate: parseNumberCell(null, 'money', fromBq(11, COL.rate)).evidence,
        amount: parseNumberCell('RM 500.00', 'money', fromBq(11, COL.amount)).evidence,
      },
    });
    expect(row.item.unit).toBe('L.S.');
    expect(row.item.quantity).not.toBe(1);
    expect(row.placeholders).toContainEqual({ field: 'quantity', placeholder: 0, reason: 'blank' });
    expect(row.placeholders).toContainEqual({ field: 'rate', placeholder: 0, reason: 'blank' });
    expect(row.item.originalRate).toBeUndefined(); // 500 ÷ 1 is not worked out either
    expect(row.item.amount).toBe(500);
  });
});

describe('D-011 is preserved', () => {
  it('dash, Nil and blank never become zero', () => {
    for (const raw of ['-', '--', 'RM -', 'Nil', 'NIL', '', null]) {
      const { evidence } = parseNumberCell(raw, 'money', fromBq(10, COL.amount));
      expect(evidence.state).not.toBe('zero');
      expect(evidence.parsed).toBeNull();
    }
  });

  it('ambiguous values never become numbers', () => {
    for (const raw of ['1,25', '1.250,00', '12,50,000', '1 250.00', '50-', '(-50)', '1.2E+05', '10 m2', 'RM 10', 'USD 10', '5%']) {
      const { evidence } = parseNumberCell(raw, 'quantity', fromBq(10, COL.quantity));
      expect(evidence.state, raw).toBe('unparseable');
      expect(evidence.parsed).toBeNull();
    }
    expect(parseNumberCell('0.05', 'percent', fromBq(10, COL.quantity)).evidence.parsed).toBeNull();
  });
});
