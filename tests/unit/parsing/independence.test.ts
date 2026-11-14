/**
 * Stage 2D — the parser stands on its own, and it never combines cells.
 * SYNTHETIC — NOT REAL COST DATA.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as parsing from '../../../src/core/parsing/index.ts';
import { createStagedBQRow, checkStagedRowIntegrity } from '../../../src/core/models/index.ts';
import { BQ_XLSX, COL, TODAY, bqCell, fromBq, syntheticProject } from '../../helpers/synthetic/models.ts';

const parsingDir = resolve(import.meta.dirname, '../../../src/core/parsing');

describe('independence', () => {
  it('no parsing file imports React or the Cost Library (its own parseCleanRate removes minus signs)', () => {
    for (const file of readdirSync(parsingDir)) {
      const imports = readFileSync(join(parsingDir, file), 'utf8').split('\n').filter((l) => /^\s*import\b|from\s+['"]/.test(l)).join('\n');
      expect(imports, file).not.toMatch(/react|vendor\/cost-library/);
    }
  });

  it('offers only single-cell functions — nothing that calculates one figure from others', () => {
    const functions = Object.entries(parsing).filter(([, v]) => typeof v === 'function').map(([k]) => k).sort();
    expect(functions).toEqual(['isUnitWord', 'matchMarker', 'normaliseSpacing', 'parseNumberCell', 'parseTextCell', 'parseUnitCell']);
  });
});

describe('parsed cells feed a staged BQ row without anything being calculated', () => {
  const row = (cells: { qty: Parameters<typeof parsing.parseNumberCell>[0]; rate: Parameters<typeof parsing.parseNumberCell>[0]; amount: Parameters<typeof parsing.parseNumberCell>[0] }) =>
    createStagedBQRow({
      id: 'r', project: syntheticProject(), documentId: BQ_XLSX.id, rowClass: 'priced_item', sequence: 10, sources: [bqCell(10)], today: TODAY,
      evidence: {
        description: parsing.parseTextCell('SYNTHETIC TEST ITEM 003', fromBq(10, COL.description)),
        unit: parsing.parseUnitCell('m2', fromBq(10, COL.unit)).evidence,
        quantity: parsing.parseNumberCell(cells.qty, 'quantity', fromBq(10, COL.quantity)).evidence,
        rate: parsing.parseNumberCell(cells.rate, 'money', fromBq(10, COL.rate)).evidence,
        amount: parsing.parseNumberCell(cells.amount, 'money', fromBq(10, COL.amount)).evidence,
      },
    });

  it('a blank amount stays a placeholder even though qty and rate are known (no qty × rate)', () => {
    const r = row({ qty: '10', rate: 'RM 2.00', amount: '' });
    expect(r.item.amount).toBe(0);
    expect(r.placeholders).toContainEqual({ field: 'amount', placeholder: 0, reason: 'blank' });
    expect(r.item.originalAmount).toBeUndefined();
    expect(checkStagedRowIntegrity(r)).toEqual([]);
  });

  it('a blank rate stays a placeholder even though qty and amount are known (no amount ÷ qty)', () => {
    const r = row({ qty: '10', rate: null, amount: 'RM 20.00' });
    expect(r.placeholders).toContainEqual({ field: 'rate', placeholder: 0, reason: 'blank' });
    expect(r.item.originalRate).toBeUndefined();
  });

  it('a lump sum with only an amount does not get a quantity of 1', () => {
    const r = row({ qty: 'L.S.', rate: '', amount: 'RM 500.00' });
    expect(r.item.quantity).toBe(0);
    expect(r.evidence.quantity.special).toBe('LUMP_SUM');
    expect(r.placeholders).toContainEqual({ field: 'quantity', placeholder: 0, reason: 'special' });
  });

  it('a bracketed negative amount reaches the row with its sign and blocks approval', () => {
    const r = row({ qty: '1', rate: '(5.00)', amount: '(5.00)' });
    expect(r.item.amount).toBe(-5);
    expect(r.evidence.amount.raw).toBe('(5.00)');
    expect(r.issues.filter((i) => i.code === 'NEGATIVE_VALUE' && i.severity === 'blocking')).toHaveLength(2);
  });
});
