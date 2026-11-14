/**
 * Stage 2D — special markers in figure columns. SYNTHETIC — NOT REAL COST DATA.
 * A marker is recorded as a marker: never as 0, never as 1, never as a calculated value.
 */
import { describe, expect, it } from 'vitest';
import { MARKER_RULES, parseNumberCell } from '../../../src/core/parsing/index.ts';
import { fromBq } from '../../helpers/synthetic/models.ts';

const at = fromBq(10, 4);

describe('special markers', () => {
  it.each([
    ['Incl.', 'INCLUDED'],
    ['Included', 'INCLUDED'],
    ['INCL', 'INCLUDED'],
    ['incl', 'INCLUDED'],
    ['Excluded', 'EXCLUDED'],
    ['Rate Only', 'RATE_ONLY'],
    ['RATE ONLY', 'RATE_ONLY'],
    ['R.O.', 'RATE_ONLY'],
    ['P.C. Sum', 'PRIME_COST_SUM'],
    ['PC Sum', 'PRIME_COST_SUM'],
    ['Prime Cost Sum', 'PRIME_COST_SUM'],
    ['Provisional Sum', 'PROVISIONAL_SUM'],
    ['Prov. Sum', 'PROVISIONAL_SUM'],
    ['P.S.', 'PROVISIONAL_SUM'],
    ['L.S.', 'LUMP_SUM'],
    ['LS', 'LUMP_SUM'],
    ['Lump Sum', 'LUMP_SUM'],
    ['N/A', 'NOT_APPLICABLE'],
    ['n.a.', 'NOT_APPLICABLE'],
    ['Nil', 'NIL'],
    ['NIL', 'NIL'],
    ['By Others', 'BY_OTHERS'],
    ['-', 'NIL_DASH'],
    ['–', 'NIL_DASH'],
    ['--', 'NIL_DASH'],
    ['RM -', 'NIL_DASH'],
    ['  Rate   Only  ', 'RATE_ONLY'],
  ])('"%s" → marker %s, with no value', (raw, special) => {
    for (const kind of ['quantity', 'money', 'percent'] as const) {
      const { evidence } = parseNumberCell(raw, kind, at);
      expect(evidence.state).toBe('special');
      expect(evidence.special).toBe(special);
      expect(evidence.parsed).toBeNull();
      expect(evidence.raw).toBe(raw);
    }
  });

  it('a lump sum marker is NOT a quantity of 1', () => {
    const { evidence } = parseNumberCell('L.S.', 'quantity', at);
    expect(evidence.parsed).not.toBe(1);
    expect(evidence.parsed).toBeNull();
  });

  it('"Nil", "-" and "Incl." are NOT zero', () => {
    for (const raw of ['Nil', '-', 'Incl.']) {
      const { evidence } = parseNumberCell(raw, 'money', at);
      expect(evidence.state).not.toBe('zero');
      expect(evidence.parsed).not.toBe(0);
    }
  });

  it('a marker must fill the whole cell; longer text is not guessed at', () => {
    for (const raw of ['Included in item 5', 'Rate only see note', 'PC Sum 50,000']) {
      const { evidence } = parseNumberCell(raw, 'money', at);
      expect(evidence.state).toBe('unparseable');
    }
  });

  it('plain "RO" and "PC" are not taken as markers (too easily something else)', () => {
    expect(parseNumberCell('RO', 'money', at).evidence.state).toBe('unparseable');
    expect(parseNumberCell('PC', 'quantity', at).evidence.state).toBe('unparseable');
  });

  it('every marker rule has examples, and each example is recognised by its own rule', () => {
    for (const rule of MARKER_RULES) {
      expect(rule.examples.length).toBeGreaterThan(0);
      for (const example of rule.examples) {
        expect(parseNumberCell(example, 'money', at).evidence.special).toBe(rule.special);
      }
    }
  });
});
