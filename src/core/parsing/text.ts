/**
 * TEXT PARSING — descriptions, item numbers and units.
 *
 * Text is kept EXACTLY as written: no trimming, re-casing or unit conversion
 * ("m2" stays "m2"; it is not changed to "m²").
 *   - cell not present (undefined)      → state "missing"
 *   - empty cell or spaces only         → state "blank"
 *   - text                              → state "value", parsed = the text exactly
 *   - a stored number (e.g. item 1.1)   → the text the spreadsheet SHOWS when given
 *                                         (so "1.10" is not turned into "1.1"); otherwise the number
 *   - TRUE / FALSE                      → state "unparseable"
 */
import { type FieldEvidence, type RawValue, blankEvidence, missingEvidence, textEvidence, unparseableEvidence } from '../models/evidence.ts';
import { type ParseOptions, type ParseOrigin, normaliseSpacing } from './numbers.ts';
import { isUnitWord } from './vocabulary.ts';

export function parseTextCell(raw: RawValue | undefined, origin: ParseOrigin, options: ParseOptions = {}): FieldEvidence<string> {
  if (raw === undefined) return missingEvidence<string>({ ...origin, note: 'The cell is not present in the extracted data.' });
  if (raw === null || (typeof raw === 'string' && normaliseSpacing(raw) === '')) return blankEvidence<string>(raw as string | null, origin);
  if (typeof raw === 'boolean') {
    return unparseableEvidence<string>(raw, { ...origin, note: `The cell holds ${String(raw).toUpperCase()}, not text.` });
  }
  if (typeof raw === 'number') {
    const shown = options.displayText;
    if (shown !== undefined && normaliseSpacing(shown) !== '') {
      return textEvidence(raw, shown, { ...origin, note: `Stored as the number ${raw}; the text shown in the spreadsheet is used.` });
    }
    return textEvidence(raw, String(raw), { ...origin, note: `Stored as the number ${raw}; shown text not available.` });
  }
  return textEvidence(raw, raw, origin);
}

export interface UnitParseResult {
  readonly evidence: FieldEvidence<string>;
  /** True when the unit is one of the recognised unit words (it is still kept exactly as written). */
  readonly recognised: boolean;
}

/**
 * Parses a cell of the Unit column. The unit is kept exactly as written. A number in the unit
 * column (e.g. "10") is NOT accepted as a unit — it is flagged as unparseable, because it is
 * probably a quantity in the wrong column.
 */
export function parseUnitCell(raw: RawValue | undefined, origin: ParseOrigin): UnitParseResult {
  const looksNumeric =
    typeof raw === 'number' || (typeof raw === 'string' && /^[-+(]?\s*\d[\d,]*(\.\d+)?\s*\)?$/.test(normaliseSpacing(raw)));
  if (looksNumeric) {
    return {
      evidence: unparseableEvidence<string>(raw as RawValue, { ...origin, note: `"${String(raw)}" is a number, not a unit; it may be a quantity in the wrong column.` }),
      recognised: false,
    };
  }
  const evidence = parseTextCell(raw, origin);
  const recognised = evidence.state === 'value' && (isUnitWord(normaliseSpacing(evidence.parsed!)) || ['%', 'ls', 'l.s.', 'lump sum'].includes(normaliseSpacing(evidence.parsed!).toLowerCase()));
  return { evidence, recognised };
}
