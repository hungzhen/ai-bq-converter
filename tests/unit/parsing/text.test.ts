/** Stage 2D — text and unit parsing. SYNTHETIC — NOT REAL COST DATA. */
import { describe, expect, it } from 'vitest';
import { parseTextCell, parseUnitCell } from '../../../src/core/parsing/index.ts';
import { fromBq } from '../../helpers/synthetic/models.ts';

const at = fromBq(10, 2);

describe('descriptions and item numbers', () => {
  it('keeps text exactly as written — spaces, capitals and line breaks included', () => {
    const raw = '  SYNTHETIC TEST ITEM\nwith a second LINE  ';
    const e = parseTextCell(raw, at);
    expect(e.state).toBe('value');
    expect(e.parsed).toBe(raw);
    expect(e.raw).toBe(raw);
  });

  it('distinguishes blank from missing', () => {
    expect(parseTextCell('', at).state).toBe('blank');
    expect(parseTextCell('  ', at).state).toBe('blank');
    expect(parseTextCell(null, at).state).toBe('blank');
    expect(parseTextCell(undefined, at).state).toBe('missing');
  });

  it('uses the text the spreadsheet SHOWS for a stored number, so item "1.10" stays "1.10"', () => {
    const e = parseTextCell(1.1, at, { displayText: '1.10' });
    expect(e.parsed).toBe('1.10');
    expect(e.raw).toBe(1.1);
    expect(e.note).toContain('shown');
  });

  it('falls back to the stored number when the shown text is not available, and says so', () => {
    const e = parseTextCell(1.1, at);
    expect(e.parsed).toBe('1.1');
    expect(e.note).toContain('not available');
  });

  it('TRUE / FALSE are not text', () => {
    expect(parseTextCell(false, at).state).toBe('unparseable');
  });
});

describe('units', () => {
  it.each(['m2', 'm²', 'M2', 'sqm', 'm3', 'nr', 'No.', 'kg', 'tonne', 'item', 'sum', 'LS', 'L.S.', '%'])(
    'keeps unit "%s" exactly as written (no conversion)',
    (raw) => {
      const r = parseUnitCell(raw, at);
      expect(r.evidence.state).toBe('value');
      expect(r.evidence.parsed).toBe(raw);
      expect(r.recognised).toBe(true);
    },
  );

  it('keeps an unrecognised unit too, but says it is not recognised', () => {
    const r = parseUnitCell('bundle', at);
    expect(r.evidence.parsed).toBe('bundle');
    expect(r.recognised).toBe(false);
  });

  it('does not accept a number as a unit (probably a quantity in the wrong column)', () => {
    for (const raw of [10, '10', '1,250.00', '(5)']) {
      const r = parseUnitCell(raw, at);
      expect(r.evidence.state).toBe('unparseable');
      expect(r.evidence.parsed).toBeNull();
      expect(r.evidence.raw).toBe(raw);
    }
  });

  it('a blank unit is blank, not "item"', () => {
    const r = parseUnitCell('', at);
    expect(r.evidence.state).toBe('blank');
    expect(r.evidence.parsed).toBeNull();
  });
});
