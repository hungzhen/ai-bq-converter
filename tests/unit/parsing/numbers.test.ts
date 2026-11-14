/**
 * Stage 2D — number parsing. Every input below is SYNTHETIC — NOT REAL COST DATA.
 */
import { describe, expect, it } from 'vitest';
import { type NumericFieldKind, parseNumberCell } from '../../../src/core/parsing/index.ts';
import { createPdfReference } from '../../../src/core/models/index.ts';
import { CLAIM_PDF, fromBq } from '../../helpers/synthetic/models.ts';

const at = fromBq(10, 6);
const parse = (raw: Parameters<typeof parseNumberCell>[0], kind: NumericFieldKind = 'money', displayText?: string) =>
  parseNumberCell(raw, kind, at, displayText !== undefined ? { displayText } : {});

describe('positive and negative amounts, minus signs and brackets', () => {
  it.each([
    ['1,250.00', 1250],
    ['RM 1,250.00', 1250],
    ['1250', 1250],
    ['(50.00)', -50],
    ['-50.00', -50],
    ['-1,250.00', -1250],
    ['(1,250.00)', -1250],
    ['RM (1,250.00)', -1250],
    ['(RM 1,250.00)', -1250],
    ['RM -1,250.00', -1250],
    ['-RM 1,250.00', -1250],
    ['−50.00', -50], // Unicode minus sign
    ['12,345,678.90', 12345678.9],
  ])('"%s" → %d', (raw, expected) => {
    const { evidence } = parse(raw);
    expect(evidence.state).toBe('value');
    expect(evidence.parsed).toBe(expected);
  });

  it('records how a negative was written: minus sign or brackets', () => {
    expect(parse('-50.00').detail.negativeStyle).toBe('minus');
    expect(parse('(50.00)').detail.negativeStyle).toBe('parentheses');
    expect(parse('50.00').detail.negativeStyle).toBeNull();
  });

  it('keeps the brackets in the raw text', () => {
    expect(parse('(50.00)').evidence.raw).toBe('(50.00)');
  });

  it('keeps negative numbers stored by the spreadsheet, and notes bracket display', () => {
    const r = parse(-50, 'money', '(50.00)');
    expect(r.evidence.parsed).toBe(-50);
    expect(r.detail.negativeStyle).toBe('parentheses');
    expect(r.detail.notation).toBe('stored_number');
  });
});

describe('thousands separators and decimal places', () => {
  it.each([
    ['1,000', 1000, 0, true],
    ['1,000,000.5', 1000000.5, 1, true],
    ['0.125', 0.125, 3, false],
    ['2.50', 2.5, 2, false],
    ['10', 10, 0, false],
  ])('"%s" → %d (%i decimal places, separators: %s)', (raw, value, decimals, thousands) => {
    const r = parse(raw, 'quantity');
    expect(r.evidence.parsed).toBe(value);
    expect(r.detail.decimalPlaces).toBe(decimals);
    expect(r.detail.thousandsSeparators).toBe(thousands);
  });

  it('accepts integer and decimal quantities', () => {
    expect(parse('12', 'quantity').evidence.parsed).toBe(12);
    expect(parse('12.375', 'quantity').evidence.parsed).toBe(12.375);
    expect(parse(12.375, 'quantity').evidence.parsed).toBe(12.375);
  });

  it('keeps a stored number exactly — no rounding to the displayed decimals', () => {
    const r = parse(1250.004, 'money', 'RM 1,250.00');
    expect(r.evidence.parsed).toBe(1250.004);
    expect(r.detail.displayText).toBe('RM 1,250.00');
  });

  it('accepts but notes a leading "+", leading zeros and a missing leading digit', () => {
    expect(parse('+5', 'quantity').detail.flags.map((f) => f.code)).toEqual(['LEADING_PLUS']);
    expect(parse('007', 'quantity').detail.flags.map((f) => f.code)).toEqual(['LEADING_ZEROS']);
    expect(parse('.5', 'quantity').evidence.parsed).toBe(0.5);
    expect(parse('.5', 'quantity').detail.flags.map((f) => f.code)).toEqual(['NO_INTEGER_DIGITS']);
  });
});

describe('currency prefixes', () => {
  it.each(['RM 1,250.00', 'RM1,250.00', 'rm 1,250.00', 'RM. 1,250.00', 'MYR 1,250.00', 'RM 1,250.00', '  RM   1,250.00  '])(
    'Ringgit format "%s" → 1250 in a money column',
    (raw) => {
      const r = parse(raw);
      expect(r.evidence.parsed).toBe(1250);
      expect(r.detail.currency).toBe('RM');
    },
  );

  it('does not accept other currencies', () => {
    for (const raw of ['$1,250.00', 'USD 1,250.00', 'S$ 1,250.00', 'SGD 1,250.00']) {
      const r = parse(raw);
      expect(r.evidence.state).toBe('unparseable');
      expect(r.detail.flags.map((f) => f.code)).toContain('FOREIGN_CURRENCY');
    }
  });

  it('does not accept money in a quantity or percentage column', () => {
    for (const kind of ['quantity', 'percent'] as const) {
      const r = parse('RM 10', kind);
      expect(r.evidence.state).toBe('unparseable');
      expect(r.detail.flags.map((f) => f.code)).toContain('CURRENCY_IN_NON_MONEY_FIELD');
      expect(r.detail.candidates).toEqual([{ value: 10, meaning: 'money amount' }]);
    }
  });

  it('flags a stored number that the spreadsheet shows as Ringgit in a quantity column', () => {
    const r = parse(10, 'quantity', 'RM 10.00');
    expect(r.evidence.state).toBe('unparseable');
    expect(r.detail.flags.map((f) => f.code)).toEqual(['CURRENCY_IN_NON_MONEY_FIELD']);
  });
});

describe('blank versus zero versus missing', () => {
  it.each(['0', '0.00', 'RM 0.00', '(0.00)', '-0', ' 0 '])('"%s" is ZERO (a real value of 0)', (raw) => {
    const r = parse(raw);
    expect(r.evidence.state).toBe('zero');
    expect(r.evidence.parsed).toBe(0);
  });

  it('a stored 0 is zero', () => {
    expect(parse(0).evidence.state).toBe('zero');
  });

  it.each([null, '', '   ', ' ', '\t'])('%j is BLANK (no value, not 0)', (raw) => {
    const r = parse(raw);
    expect(r.evidence.state).toBe('blank');
    expect(r.evidence.parsed).toBeNull();
  });

  it('a cell that is not present at all is MISSING (no value, not 0)', () => {
    const r = parse(undefined);
    expect(r.evidence.state).toBe('missing');
    expect(r.evidence.parsed).toBeNull();
    expect(r.evidence.sources).toHaveLength(1); // where it should have been
  });
});

describe('percentages', () => {
  it.each([
    ['5%', 5],
    ['5 %', 5],
    ['12.5%', 12.5],
    ['-5%', -5],
    ['(5%)', -5],
    ['0%', 0],
    ['5', 5],
    ['25', 25],
  ])('"%s" in a percentage column → %d', (raw, expected) => {
    expect(parse(raw, 'percent').evidence.parsed).toBe(expected);
  });

  it('a spreadsheet percentage cell (stored 0.05, shown "5%") → 5', () => {
    const r = parse(0.05, 'percent', '5%');
    expect(r.evidence.parsed).toBe(5);
    expect(r.detail.percentSign).toBe(true);
  });

  it('avoids floating-point noise when converting a stored fraction (0.07 → 7, not 7.000000000000001)', () => {
    expect(parse(0.07, 'percent', '7%').evidence.parsed).toBe(7);
  });

  it('a value between -1 and 1 in a percentage column is ambiguous and offers both readings', () => {
    for (const raw of ['0.05', 0.05]) {
      const r = parse(raw, 'percent');
      expect(r.evidence.state).toBe('unparseable');
      expect(r.detail.flags.map((f) => f.code)).toEqual(['PERCENT_SCALE_UNCONFIRMED']);
      expect(r.detail.candidates.map((c) => c.value)).toEqual([0.05, 5]);
    }
  });

  it('a percentage in a Qty / Rate / Amount column is NOT taken as a value (its meaning depends on the row)', () => {
    for (const kind of ['quantity', 'money'] as const) {
      const r = parse('5%', kind);
      expect(r.evidence.state).toBe('unparseable');
      expect(r.evidence.parsed).toBeNull();
      expect(r.detail.flags.map((f) => f.code)).toEqual(['PERCENT_IN_NON_PERCENT_FIELD']);
      expect(r.detail.candidates).toEqual([{ value: 5, meaning: 'percentage as written' }]);
    }
  });

  it('a spreadsheet percentage cell in a quantity column is flagged too', () => {
    const r = parse(0.015, 'quantity', '1.5%');
    expect(r.evidence.state).toBe('unparseable');
    expect(r.detail.candidates[0]?.value).toBe(1.5);
  });
});

describe('ambiguous or invalid text is flagged, never guessed', () => {
  it.each([
    ['1,25', 'COMMA_DECIMAL', [1.25]],
    ['1.250,00', 'COMMA_DECIMAL', [1250]],
    ['12,50,000', 'BAD_THOUSANDS_GROUPING', [1250000]],
    ['1 250.00', 'SPACES_IN_NUMBER', [1250]],
    ['50-', 'TRAILING_MINUS', [-50]],
    ['1.2E+05', 'SCIENTIFIC_NOTATION', [120000]],
    ['10 m2', 'UNIT_IN_NUMBER', [10]],
    ['m2', 'UNIT_TEXT_IN_NUMBER_FIELD', []],
    ['nr', 'UNIT_TEXT_IN_NUMBER_FIELD', []],
    ['abc', 'TEXT_IN_NUMBER', []],
    ['approx. 10', 'TEXT_IN_NUMBER', []],
    ['1.250.000', 'TEXT_IN_NUMBER', []],
    ['RM', 'TEXT_IN_NUMBER', []],
    ['12345678901234567', 'NUMBER_TOO_PRECISE', []],
  ])('"%s" → unparseable (%s), possible readings %j', (raw, code, candidates) => {
    const r = parse(raw, 'quantity');
    expect(r.evidence.state).toBe('unparseable');
    expect(r.evidence.parsed).toBeNull();
    expect(r.detail.flags.map((f) => f.code)).toContain(code);
    expect(r.detail.candidates.map((c) => c.value)).toEqual(candidates);
  });

  it('both a minus sign and brackets are ambiguous', () => {
    for (const raw of ['(-50)', '-(50)']) {
      const r = parse(raw);
      expect(r.evidence.state).toBe('unparseable');
      expect(r.detail.flags.map((f) => f.code)).toContain('PARENTHESES_AND_MINUS');
    }
  });

  it('TRUE / FALSE and invalid stored numbers are not figures', () => {
    expect(parse(true).detail.flags.map((f) => f.code)).toEqual(['BOOLEAN_VALUE']);
    expect(parse(Number.NaN).detail.flags.map((f) => f.code)).toEqual(['NOT_A_FINITE_NUMBER']);
  });

  it('puts the explanation into the evidence note, so it travels with the value', () => {
    expect(parse('1,25').evidence.note).toContain('COMMA_DECIMAL');
  });
});

describe('the original value is always preserved exactly', () => {
  const samples: Parameters<typeof parseNumberCell>[0][] = [
    '1,250.00', ' RM 1,250.00 ', '(50.00)', '-50.00', '0.00', '', '   ', null, 'Incl.', 'RATE ONLY',
    'L.S.', '5%', '1,25', 'abc', '-', 'RM -', 1250, -50, 0, 0.05, true,
  ];
  it.each(samples.map((s) => [s]))('%j is kept as the raw value', (raw) => {
    for (const kind of ['quantity', 'money', 'percent'] as const) {
      expect(parseNumberCell(raw, kind, at).evidence.raw).toStrictEqual(raw);
    }
  });
});

describe('sources and method travel with the evidence', () => {
  it('keeps the cell reference and extraction method given', () => {
    const r = parse('1,250.00');
    expect(r.evidence.method).toBe('spreadsheet_cell');
    expect(r.evidence.sources[0]).toMatchObject({ kind: 'worksheet', cellAddress: 'F10' });
  });

  it('works the same for text read by OCR from a PDF', () => {
    const ocr = { sources: [createPdfReference(CLAIM_PDF, { pageNumber: 1, extraction: 'ocr', ocrConfidence: 80 })], method: 'pdf_ocr' as const };
    const r = parseNumberCell('(1,250.00)', 'money', ocr);
    expect(r.evidence.parsed).toBe(-1250);
    expect(r.evidence.method).toBe('pdf_ocr');
  });
});
