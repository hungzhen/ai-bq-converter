/**
 * FIELD EVIDENCE — where one value came from and what state it is in.
 *
 * Every value the converter uses is stored with its evidence:
 *   - the raw value exactly as it was in the document;
 *   - the parsed value (a number or text), only when there really is one;
 *   - the source reference(s);
 *   - how it was obtained (the extraction method);
 *   - whether a person has checked it (verification status).
 *
 * The STATE says exactly what was found. These are deliberately different:
 *   value        a real value was read (negative values included, kept with their sign)
 *   zero         the document explicitly shows zero (e.g. "0" or "0.00")
 *   blank        the place for the value exists (e.g. the Qty cell) but is empty
 *   not_stated   the document has no place for this value at all (e.g. no Rate column)
 *   missing      the place should exist but could not be read (cell absent, page unreadable, OCR failed)
 *   unparseable  text is present but cannot be understood as the expected kind of value
 *   special      a recognised marker instead of a figure, e.g. "Incl." or "Rate Only"
 *
 * Only `value` and `zero` have a parsed value. All other states have parsed = null — the
 * converter never turns "nothing" into 0 or into text.
 */
import { frozenCopy } from '../../lib/immutable.ts';
import type { SourceReference } from './source.ts';

export type RawValue = string | number | boolean | null;

export type ValueState = 'value' | 'zero' | 'blank' | 'not_stated' | 'missing' | 'unparseable' | 'special';

export const VALUE_STATES: readonly ValueState[] = ['value', 'zero', 'blank', 'not_stated', 'missing', 'unparseable', 'special'];

export type SpecialValue =
  | 'INCLUDED'
  | 'EXCLUDED'
  | 'RATE_ONLY'
  | 'PROVISIONAL_SUM'
  | 'PRIME_COST_SUM'
  | 'NOT_APPLICABLE'
  | 'BY_OTHERS'
  | 'LUMP_SUM' // "L.S." / "Lump sum" in a figure column — NOT a quantity of 1
  | 'NIL' // the word "Nil" — NOT zero
  | 'NIL_DASH'; // a dash "-" in a figure column — NOT zero

export type ExtractionMethod =
  | 'spreadsheet_cell' // read from an Excel cell
  | 'csv_cell' // read from a CSV field
  | 'pdf_text_layer' // read from a digital PDF's own text
  | 'pdf_ocr' // read by OCR from a scanned PDF
  | 'user_entered' // typed in by a person (e.g. the project year) — never presented as document data
  | 'derived_by_rule' // worked out by a stated rule from other evidence (e.g. sum of quantity columns)
  | 'system_generated' // ids and dates created by the converter
  | 'none'; // nothing was read (state not_stated)

export type VerificationStatus =
  | 'unverified' // not checked yet
  | 'auto_checked' // passed the converter's automatic checks
  | 'user_confirmed' // a person confirmed it
  | 'user_corrected' // a person corrected the interpretation (the raw value is unchanged)
  | 'rejected'; // a person rejected it

export interface Derivation {
  readonly rule: string;
  readonly fromFields: readonly string[];
  readonly explanation: string;
}

export type EvidenceValue = string | number;

export interface FieldEvidence<T extends EvidenceValue = EvidenceValue> {
  readonly state: ValueState;
  /** Exactly what was in the document (null when there was nothing to read). Never changed. */
  readonly raw: RawValue;
  /** The value, only for states `value` and `zero`; otherwise null. */
  readonly parsed: T | null;
  readonly special?: SpecialValue;
  readonly sources: readonly SourceReference[];
  readonly method: ExtractionMethod;
  readonly verification: VerificationStatus;
  readonly derivation?: Derivation;
  readonly note?: string;
}

export class EvidenceError extends Error {
  override name = 'EvidenceError';
}

const SOURCE_METHODS: Partial<Record<ExtractionMethod, (ref: SourceReference) => boolean>> = {
  spreadsheet_cell: (r) => r.kind === 'worksheet',
  csv_cell: (r) => r.kind === 'csv',
  pdf_text_layer: (r) => r.kind === 'pdf' && r.extraction === 'text_layer',
  pdf_ocr: (r) => r.kind === 'pdf' && r.extraction === 'ocr',
};

const isBlankRaw = (raw: RawValue): boolean => raw === null || (typeof raw === 'string' && raw.trim() === '');

/** Lists everything wrong with a piece of evidence. An empty list means it is consistent. */
export function validateFieldEvidence(e: FieldEvidence): string[] {
  const problems: string[] = [];
  const hasParsed = e.parsed !== null;

  if (!VALUE_STATES.includes(e.state)) problems.push(`Unknown state "${e.state}".`);

  switch (e.state) {
    case 'value':
      if (!hasParsed) problems.push('State "value" needs a parsed value.');
      if (typeof e.parsed === 'number' && !Number.isFinite(e.parsed)) problems.push('A parsed number must be finite.');
      if (e.parsed === 0) problems.push('A parsed value of 0 must use state "zero", not "value".');
      if (e.parsed === '') problems.push('Empty text is not a value; use state "blank".');
      break;
    case 'zero':
      if (e.parsed !== 0) problems.push('State "zero" needs the parsed value 0.');
      break;
    default:
      if (hasParsed) problems.push(`State "${e.state}" must not have a parsed value.`);
  }

  if (e.state === 'special' && !e.special) problems.push('State "special" needs the special value (e.g. INCLUDED).');
  if (e.state !== 'special' && e.special) problems.push('Only state "special" may name a special value.');
  if (e.state === 'blank' && !isBlankRaw(e.raw)) problems.push('State "blank" means the raw cell is empty.');
  if (e.state === 'unparseable' && isBlankRaw(e.raw)) problems.push('State "unparseable" needs the raw text that could not be read.');
  if (e.state === 'not_stated') {
    if (e.raw !== null) problems.push('State "not_stated" cannot have a raw value.');
    if (e.sources.length > 0) problems.push('State "not_stated" has no source location.');
    if (e.method !== 'none') problems.push('State "not_stated" uses method "none".');
  }
  if (e.method === 'none' && e.state !== 'not_stated') problems.push('Method "none" is only for state "not_stated".');

  const matchesMethod = SOURCE_METHODS[e.method];
  if (matchesMethod) {
    if (e.sources.length === 0) problems.push(`Method "${e.method}" needs at least one source reference.`);
    if (!e.sources.every(matchesMethod)) problems.push(`Every source must match method "${e.method}".`);
  }
  if (e.method === 'derived_by_rule' && !e.derivation) problems.push('A derived value must say how it was derived.');
  if (e.method !== 'derived_by_rule' && e.derivation) problems.push('Only derived values carry a derivation.');
  if (e.method === 'user_entered' && e.verification !== 'user_confirmed' && e.verification !== 'user_corrected') {
    problems.push('A value entered by a person counts as confirmed by that person.');
  }
  return problems;
}

function make<T extends EvidenceValue>(e: FieldEvidence<T>): FieldEvidence<T> {
  const problems = validateFieldEvidence(e);
  if (problems.length > 0) throw new EvidenceError(problems.join(' '));
  return frozenCopy(e);
}

type Origin = { sources: readonly SourceReference[]; method: ExtractionMethod; verification?: VerificationStatus; note?: string };

const originOf = (o: Origin) => ({
  sources: o.sources,
  method: o.method,
  verification: o.verification ?? 'unverified',
  ...(o.note !== undefined ? { note: o.note } : {}),
});

/** A number read from the document. 0 becomes state "zero"; negative numbers keep their sign. */
export function numberEvidence(raw: RawValue, parsed: number, origin: Origin): FieldEvidence<number> {
  const isZero = parsed === 0; // also true for -0
  return make<number>({ state: isZero ? 'zero' : 'value', raw, parsed: isZero ? 0 : parsed, ...originOf(origin) });
}

/** Text read from the document, kept exactly as given (not trimmed or re-cased). */
export function textEvidence(raw: RawValue, text: string, origin: Origin): FieldEvidence<string> {
  return make<string>({ state: 'value', raw, parsed: text, ...originOf(origin) });
}

/** The place for the value exists but is empty. */
export function blankEvidence<T extends EvidenceValue>(raw: '' | null | string, origin: Origin): FieldEvidence<T> {
  return make<T>({ state: 'blank', raw, parsed: null, ...originOf(origin) });
}

/** The document has no place for this value at all. */
export function notStatedEvidence<T extends EvidenceValue>(note?: string): FieldEvidence<T> {
  return make<T>({ state: 'not_stated', raw: null, parsed: null, sources: [], method: 'none', verification: 'unverified', ...(note !== undefined ? { note } : {}) });
}

/** The place should exist but could not be read. `origin.sources` = where it should have been. */
export function missingEvidence<T extends EvidenceValue>(origin: Origin & { note: string }): FieldEvidence<T> {
  return make<T>({ state: 'missing', raw: null, parsed: null, ...originOf(origin) });
}

/** Text is present but cannot be read as the expected kind of value. The text is kept. */
export function unparseableEvidence<T extends EvidenceValue>(raw: RawValue, origin: Origin): FieldEvidence<T> {
  return make<T>({ state: 'unparseable', raw, parsed: null, ...originOf(origin) });
}

/** A recognised marker such as "Incl." or "Rate Only" instead of a figure. */
export function specialEvidence<T extends EvidenceValue>(raw: RawValue, special: SpecialValue, origin: Origin): FieldEvidence<T> {
  return make<T>({ state: 'special', raw, parsed: null, special, ...originOf(origin) });
}

/** A value typed in by a person (e.g. the project year). Recorded as the person's input, not document data. */
export function userEnteredEvidence<T extends EvidenceValue>(value: T, note?: string): FieldEvidence<T> {
  return make<T>({
    state: value === 0 ? 'zero' : 'value',
    raw: value,
    parsed: value,
    sources: [],
    method: 'user_entered',
    verification: 'user_confirmed',
    ...(note !== undefined ? { note } : {}),
  });
}

/** A value worked out by a stated rule from other evidence. Always shown as derived, never as read. */
export function derivedEvidence(parsed: number, derivation: Derivation, sources: readonly SourceReference[]): FieldEvidence<number> {
  return make<number>({
    state: parsed === 0 ? 'zero' : 'value',
    raw: null,
    parsed: parsed === 0 ? 0 : parsed,
    sources,
    method: 'derived_by_rule',
    verification: 'unverified',
    derivation,
  });
}

/** True for states that carry a usable value (`value` or `zero`). */
export function hasUsableValue<T extends EvidenceValue>(e: FieldEvidence<T>): e is FieldEvidence<T> & { parsed: T } {
  return (e.state === 'value' || e.state === 'zero') && e.parsed !== null;
}

export function isNegative(e: FieldEvidence): boolean {
  return typeof e.parsed === 'number' && e.parsed < 0;
}

export function describeState(state: ValueState): string {
  const text: Record<ValueState, string> = {
    value: 'Value read from the document',
    zero: 'Zero shown in the document',
    blank: 'Left blank in the document',
    not_stated: 'Not stated in the document',
    missing: 'Could not be read from the document',
    unparseable: 'Text in the document could not be understood',
    special: 'Marker in the document (no figure)',
  };
  return text[state];
}
