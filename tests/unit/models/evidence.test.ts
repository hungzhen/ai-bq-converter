/** Stage 2C — FieldEvidence: value states, zero vs missing, negatives. SYNTHETIC — NOT REAL COST DATA. */
import { describe, expect, it } from 'vitest';
import {
  type FieldEvidence,
  EvidenceError,
  blankEvidence,
  createPdfReference,
  derivedEvidence,
  describeState,
  hasUsableValue,
  isNegative,
  missingEvidence,
  notStatedEvidence,
  numberEvidence,
  specialEvidence,
  textEvidence,
  unparseableEvidence,
  userEnteredEvidence,
  validateFieldEvidence,
} from '../../../src/core/models/index.ts';
import { CLAIM_PDF, COL, bqCell, fromBq } from '../../helpers/synthetic/models.ts';

const qtyCell = fromBq(10, COL.quantity);

describe('the seven value states are kept apart', () => {
  const zero = numberEvidence('0.00', 0, qtyCell);
  const blank = blankEvidence<number>('', qtyCell);
  const notStated = notStatedEvidence<number>('This document has no Rate column.');
  const missing = missingEvidence<number>({ ...qtyCell, note: 'Cell not present in the extracted sheet.' });
  const unparseable = unparseableEvidence<number>('ten', qtyCell);
  const special = specialEvidence<number>('Incl.', 'INCLUDED', qtyCell);
  const value = numberEvidence('12.5', 12.5, qtyCell);

  it('gives each one its own state', () => {
    expect([value, zero, blank, notStated, missing, unparseable, special].map((e) => e.state)).toEqual([
      'value', 'zero', 'blank', 'not_stated', 'missing', 'unparseable', 'special',
    ]);
  });

  it('zero has the value 0; blank, not stated, missing, unparseable and special have NO value (not 0)', () => {
    expect(zero.parsed).toBe(0);
    for (const e of [blank, notStated, missing, unparseable, special]) expect(e.parsed).toBeNull();
  });

  it('only "value" and "zero" count as usable values', () => {
    expect(hasUsableValue(value)).toBe(true);
    expect(hasUsableValue(zero)).toBe(true);
    for (const e of [blank, notStated, missing, unparseable, special]) expect(hasUsableValue(e)).toBe(false);
  });

  it('"not stated" has no source; "blank" and "missing" point to where the value should be', () => {
    expect(notStated.sources).toEqual([]);
    expect(notStated.method).toBe('none');
    expect(blank.sources).toHaveLength(1);
    expect(missing.sources).toHaveLength(1);
  });

  it('keeps the raw text of unparseable and special values', () => {
    expect(unparseable.raw).toBe('ten');
    expect(special.raw).toBe('Incl.');
    expect(special.special).toBe('INCLUDED');
  });

  it('has a plain-English description of every state', () => {
    expect(describeState('not_stated')).toBe('Not stated in the document');
    expect(describeState('blank')).toBe('Left blank in the document');
  });
});

describe('zero versus missing', () => {
  it('a number 0 always becomes state "zero" (also minus zero)', () => {
    expect(numberEvidence(0, 0, qtyCell).state).toBe('zero');
    expect(numberEvidence('-0', -0, qtyCell).parsed).toBe(0);
    expect(Object.is(numberEvidence('-0', -0, qtyCell).parsed, 0)).toBe(true);
  });

  it('refuses a "value" of 0, and a "blank" that secretly holds 0', () => {
    const fakeValue: FieldEvidence = { state: 'value', raw: 0, parsed: 0, sources: qtyCell.sources, method: 'spreadsheet_cell', verification: 'unverified' };
    const fakeBlank: FieldEvidence = { state: 'blank', raw: '', parsed: 0, sources: qtyCell.sources, method: 'spreadsheet_cell', verification: 'unverified' };
    expect(validateFieldEvidence(fakeValue)).toContain('A parsed value of 0 must use state "zero", not "value".');
    expect(validateFieldEvidence(fakeBlank)).toContain('State "blank" must not have a parsed value.');
  });

  it('refuses "blank" when the cell actually contains something', () => {
    expect(() => blankEvidence('12', qtyCell)).toThrow(EvidenceError);
  });

  it('refuses "unparseable" without the text that could not be read', () => {
    expect(() => unparseableEvidence('', qtyCell)).toThrow(EvidenceError);
  });
});

describe('negative values', () => {
  it('keep their sign and their raw text', () => {
    const e = numberEvidence('(1,250.00)', -1250, fromBq(10, COL.amount));
    expect(e.parsed).toBe(-1250);
    expect(e.raw).toBe('(1,250.00)');
    expect(isNegative(e)).toBe(true);
  });

  it('positive values and non-values are not negative', () => {
    expect(isNegative(numberEvidence(5, 5, qtyCell))).toBe(false);
    expect(isNegative(blankEvidence('', qtyCell))).toBe(false);
  });
});

describe('extraction method and source must agree', () => {
  it('a spreadsheet cell value needs a worksheet reference', () => {
    expect(() => numberEvidence(1, 1, { sources: [], method: 'spreadsheet_cell' })).toThrow(EvidenceError);
  });

  it('an OCR value needs an OCR reference, not PDF text', () => {
    const textRef = createPdfReference(CLAIM_PDF, { pageNumber: 1, extraction: 'text_layer' });
    const ocrRef = createPdfReference(CLAIM_PDF, { pageNumber: 1, extraction: 'ocr', ocrConfidence: 70 });
    expect(() => numberEvidence('5', 5, { sources: [textRef], method: 'pdf_ocr' })).toThrow(EvidenceError);
    expect(numberEvidence('5', 5, { sources: [ocrRef], method: 'pdf_ocr' }).sources[0]).toMatchObject({ ocrConfidence: 70 });
  });

  it('a derived value must say how it was derived, and is never presented as read', () => {
    const d = derivedEvidence(30, { rule: 'sum_of_quantity_columns', fromFields: ['Tower A Qty', 'Tower B Qty'], explanation: '10 + 20' }, [bqCell(5, 4)]);
    expect(d.method).toBe('derived_by_rule');
    expect(d.raw).toBeNull();
    expect(d.derivation?.rule).toBe('sum_of_quantity_columns');
  });

  it('a value entered by a person is recorded as theirs, with no document source', () => {
    const e = userEnteredEvidence('2000 Q1');
    expect(e).toMatchObject({ state: 'value', method: 'user_entered', verification: 'user_confirmed', sources: [] });
  });

  it('text is kept exactly, including spaces and capitals', () => {
    const e = textEvidence('  Supply AND fix  ', '  Supply AND fix  ', fromBq(10, COL.description));
    expect(e.parsed).toBe('  Supply AND fix  ');
  });

  it('empty text is not accepted as a value', () => {
    expect(() => textEvidence('', '', fromBq(10, COL.description))).toThrow(EvidenceError);
  });

  it('evidence is frozen', () => {
    const e = numberEvidence(1, 1, qtyCell);
    expect(() => {
      (e as { parsed: number }).parsed = 2;
    }).toThrow(TypeError);
  });
});
