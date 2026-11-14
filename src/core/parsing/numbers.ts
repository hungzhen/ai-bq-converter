/**
 * NUMBER PARSING — turns ONE cell of a figure column into FieldEvidence<number>.
 *
 * Conventions (Malaysian / Cost Library): comma = thousands separator, dot = decimal point,
 * "RM" / "MYR" = Ringgit. Negative figures are written "-50.00" or "(50.00)".
 *
 * What this parser will NOT do:
 *   - calculate anything from other cells (it only ever sees one cell);
 *   - turn a blank, "-", "Nil", "Incl.", "Rate Only", "L.S." … into 0 or 1;
 *   - accept a percentage in a Qty / Rate / Amount column, or money in a Qty / % column;
 *   - pick one meaning when a value could mean two things. Ambiguous text becomes
 *     state "unparseable" (no value), with the possible readings listed as `candidates`
 *     for a person to choose from.
 * The original cell value is always kept exactly as `evidence.raw`.
 *
 * Field kinds:
 *   quantity  Qty columns              plain numbers only
 *   money     Rate / Amount columns    plain numbers, optionally with "RM" / "MYR"
 *   percent   Profit %, % complete …   numbers with or without "%"
 */
import {
  type ExtractionMethod,
  type FieldEvidence,
  type RawValue,
  type VerificationStatus,
  blankEvidence,
  missingEvidence,
  numberEvidence,
  specialEvidence,
  unparseableEvidence,
} from '../models/evidence.ts';
import type { SourceReference } from '../models/source.ts';
import { DASH_ONLY, isUnitWord, matchMarker } from './vocabulary.ts';

export type NumericFieldKind = 'quantity' | 'money' | 'percent';

export interface ParseOrigin {
  readonly sources: readonly SourceReference[];
  readonly method: ExtractionMethod;
  readonly verification?: VerificationStatus;
}

export interface ParseOptions {
  /**
   * The text the spreadsheet shows for the cell (e.g. "5%" or "RM 1,250.00"), when the stored
   * value is a number. Used to recognise Excel percentage formatting; the stored number stays
   * the value.
   */
  readonly displayText?: string;
}

export type ParseFlagCode =
  // information only — the value is still accepted
  | 'LEADING_PLUS'
  | 'LEADING_ZEROS'
  | 'NO_INTEGER_DIGITS'
  // ambiguous or not acceptable — the value is NOT accepted (state "unparseable")
  | 'PARENTHESES_AND_MINUS'
  | 'DOUBLE_SIGN'
  | 'TRAILING_MINUS'
  | 'COMMA_DECIMAL'
  | 'BAD_THOUSANDS_GROUPING'
  | 'SPACES_IN_NUMBER'
  | 'SCIENTIFIC_NOTATION'
  | 'FOREIGN_CURRENCY'
  | 'CURRENCY_IN_NON_MONEY_FIELD'
  | 'PERCENT_IN_NON_PERCENT_FIELD'
  | 'PERCENT_SCALE_UNCONFIRMED'
  | 'UNIT_IN_NUMBER'
  | 'UNIT_TEXT_IN_NUMBER_FIELD'
  | 'TEXT_IN_NUMBER'
  | 'NUMBER_TOO_PRECISE'
  | 'NOT_A_FINITE_NUMBER'
  | 'BOOLEAN_VALUE';

const INFO_ONLY: ReadonlySet<ParseFlagCode> = new Set(['LEADING_PLUS', 'LEADING_ZEROS', 'NO_INTEGER_DIGITS']);

export interface ParseFlag {
  readonly code: ParseFlagCode;
  readonly message: string;
}

/** A possible reading of an ambiguous value, for a person to choose. Never applied automatically. */
export interface Candidate {
  readonly value: number;
  readonly meaning: string;
}

export interface NumberParseDetail {
  readonly kind: NumericFieldKind;
  /** How the value was written. */
  readonly notation: 'stored_number' | 'text' | 'none';
  readonly currency: 'RM' | null;
  readonly negativeStyle: 'minus' | 'parentheses' | null;
  readonly percentSign: boolean;
  readonly thousandsSeparators: boolean;
  /** Decimal places as written (null when not a written number). */
  readonly decimalPlaces: number | null;
  readonly displayText: string | null;
  readonly flags: readonly ParseFlag[];
  readonly candidates: readonly Candidate[];
}

export interface NumberParseResult {
  readonly evidence: FieldEvidence<number>;
  readonly detail: NumberParseDetail;
}

/** Replaces non-breaking / thin spaces and the Unicode minus sign, collapses spaces, trims. */
export function normaliseSpacing(text: string): string {
  return text
    .replace(/[    \t]/g, ' ')
    .replace(/−/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Rounds away floating-point noise from ×100 (e.g. 0.07 × 100 = 7.000000000000001 → 7). */
const times100 = (n: number) => Number((n * 100).toPrecision(15));

/** Up to 15 significant digits can be held exactly. */
const MAX_DIGITS = 15;

interface Accumulator {
  flags: ParseFlag[];
  candidates: Candidate[];
}

const flag = (acc: Accumulator, code: ParseFlagCode, message: string) => acc.flags.push({ code, message });

function finish(
  raw: RawValue,
  origin: ParseOrigin,
  kind: NumericFieldKind,
  acc: Accumulator,
  parts: Partial<Omit<NumberParseDetail, 'flags' | 'candidates' | 'kind'>> & { value: number | null },
): NumberParseResult {
  const detail: NumberParseDetail = {
    kind,
    notation: parts.notation ?? 'none',
    currency: parts.currency ?? null,
    negativeStyle: parts.negativeStyle ?? null,
    percentSign: parts.percentSign ?? false,
    thousandsSeparators: parts.thousandsSeparators ?? false,
    decimalPlaces: parts.decimalPlaces ?? null,
    displayText: parts.displayText ?? null,
    flags: acc.flags,
    candidates: acc.candidates,
  };
  const blocking = acc.flags.filter((f) => !INFO_ONLY.has(f.code));
  const note = acc.flags.length ? acc.flags.map((f) => `${f.code}: ${f.message}`).join(' ') : undefined;
  const o = { ...origin, ...(note !== undefined ? { note } : {}) };

  const evidence =
    blocking.length > 0 || parts.value === null
      ? unparseableEvidence<number>(raw, o)
      : numberEvidence(raw, parts.value, o);
  return { evidence, detail };
}

/** Parses the number part of a cell once currency, signs and "%" are removed. */
function parseBody(body: string, acc: Accumulator): { value: number | null; thousands: boolean; decimals: number | null } {
  const decimalsOf = (s: string) => (s.includes('.') ? s.split('.')[1]!.length : 0);
  const digitCount = (s: string) => s.replace(/\D/g, '').replace(/^0+(?=\d)/, '').length;
  const tooPrecise = (s: string) => {
    if (digitCount(s) > MAX_DIGITS) {
      flag(acc, 'NUMBER_TOO_PRECISE', `"${s}" has more digits than can be held exactly.`);
      return true;
    }
    return false;
  };

  if (/^\d+(\.\d+)?$/.test(body) || /^\.\d+$/.test(body)) {
    if (tooPrecise(body)) return { value: null, thousands: false, decimals: null };
    if (/^0\d/.test(body)) flag(acc, 'LEADING_ZEROS', `"${body}" has leading zeros.`);
    if (body.startsWith('.')) flag(acc, 'NO_INTEGER_DIGITS', `"${body}" has no digit before the decimal point.`);
    return { value: Number(body), thousands: false, decimals: decimalsOf(body) };
  }

  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(body)) {
    if (tooPrecise(body)) return { value: null, thousands: true, decimals: null };
    return { value: Number(body.replace(/,/g, '')), thousands: true, decimals: decimalsOf(body) };
  }

  if (/^\d+,\d{1,2}$/.test(body) || /^\d{1,3}(\.\d{3})+,\d+$/.test(body)) {
    const european = Number(body.replace(/\./g, '').replace(',', '.'));
    flag(acc, 'COMMA_DECIMAL', `"${body}" uses a comma as the decimal point, which is not the Malaysian convention.`);
    acc.candidates.push({ value: european, meaning: 'comma read as the decimal point' });
    return { value: null, thousands: false, decimals: null };
  }

  if (/^\d+(,\d+)+(\.\d+)?$/.test(body)) {
    flag(acc, 'BAD_THOUSANDS_GROUPING', `"${body}" has commas that are not in groups of three digits.`);
    acc.candidates.push({ value: Number(body.replace(/,/g, '')), meaning: 'commas ignored' });
    return { value: null, thousands: false, decimals: null };
  }

  if (/^\d{1,3}( \d{3})+(\.\d+)?$/.test(body)) {
    flag(acc, 'SPACES_IN_NUMBER', `"${body}" contains spaces; it may be one number or several.`);
    acc.candidates.push({ value: Number(body.replace(/ /g, '')), meaning: 'spaces read as thousands separators' });
    return { value: null, thousands: false, decimals: null };
  }

  if (/^\d+(\.\d+)?e[+-]?\d+$/i.test(body)) {
    flag(acc, 'SCIENTIFIC_NOTATION', `"${body}" is in scientific notation; the spreadsheet may be showing a rounded figure.`);
    acc.candidates.push({ value: Number(body), meaning: 'scientific notation as written' });
    return { value: null, thousands: false, decimals: null };
  }

  const withUnit = /^(\d[\d,]*(?:\.\d+)?)\s*([a-z][a-z0-9.²³/]*)$/i.exec(body);
  if (withUnit && isUnitWord(withUnit[2]!)) {
    flag(acc, 'UNIT_IN_NUMBER', `"${body}" contains a unit ("${withUnit[2]}") inside a figure column.`);
    acc.candidates.push({ value: Number(withUnit[1]!.replace(/,/g, '')), meaning: `number with unit "${withUnit[2]}"` });
    return { value: null, thousands: false, decimals: null };
  }

  if (isUnitWord(body)) {
    flag(acc, 'UNIT_TEXT_IN_NUMBER_FIELD', `"${body}" is a unit, not a figure.`);
    return { value: null, thousands: false, decimals: null };
  }

  flag(acc, 'TEXT_IN_NUMBER', `"${body}" is not a number.`);
  return { value: null, thousands: false, decimals: null };
}

/**
 * Parses one cell of a figure column.
 *
 * @param raw     The cell value as stored: a number, text, a boolean, null (empty cell), or
 *                undefined when the cell is not present at all (state "missing").
 * @param kind    What the column holds: quantity, money (rate / amount) or percent.
 * @param origin  Where the cell is (source references) and how it was read.
 */
export function parseNumberCell(
  raw: RawValue | undefined,
  kind: NumericFieldKind,
  origin: ParseOrigin,
  options: ParseOptions = {},
): NumberParseResult {
  const acc: Accumulator = { flags: [], candidates: [] };
  const displayText = options.displayText ?? null;
  const base = { displayText };

  // ---- Not present / empty -------------------------------------------------------------
  if (raw === undefined) {
    return {
      evidence: missingEvidence<number>({ ...origin, note: 'The cell is not present in the extracted data.' }),
      detail: { kind, notation: 'none', currency: null, negativeStyle: null, percentSign: false, thousandsSeparators: false, decimalPlaces: null, displayText, flags: [], candidates: [] },
    };
  }
  if (raw === null || (typeof raw === 'string' && normaliseSpacing(raw) === '')) {
    return {
      evidence: blankEvidence<number>(raw as string | null, origin),
      detail: { kind, notation: 'none', currency: null, negativeStyle: null, percentSign: false, thousandsSeparators: false, decimalPlaces: null, displayText, flags: [], candidates: [] },
    };
  }

  // ---- Booleans --------------------------------------------------------------------------
  if (typeof raw === 'boolean') {
    flag(acc, 'BOOLEAN_VALUE', `The cell holds ${String(raw).toUpperCase()}, not a figure.`);
    return finish(raw, origin, kind, acc, { ...base, value: null });
  }

  // ---- Numbers stored by the spreadsheet ---------------------------------------------------
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) {
      flag(acc, 'NOT_A_FINITE_NUMBER', 'The cell holds an invalid number.');
      return finish(raw, origin, kind, acc, { ...base, value: null, notation: 'stored_number' });
    }
    const shownAsPercent = displayText !== null && /%\s*\)?$/.test(normaliseSpacing(displayText));
    const negativeStyle: NumberParseDetail['negativeStyle'] =
      raw < 0 ? (displayText !== null && /^\s*\(.*\)\s*$/.test(displayText) ? 'parentheses' : 'minus') : null;
    const shownAsMoney = displayText !== null && /^\s*\(?\s*-?\s*(rm|myr)(?![a-z])/i.test(displayText);
    const parts = { ...base, notation: 'stored_number' as const, negativeStyle, percentSign: shownAsPercent, currency: shownAsMoney ? ('RM' as const) : null };

    if (shownAsMoney && kind !== 'money') {
      flag(acc, 'CURRENCY_IN_NON_MONEY_FIELD', `The cell is shown as money ("${displayText}") in a ${kind} column.`);
      acc.candidates.push({ value: raw, meaning: 'money amount' });
      return finish(raw, origin, kind, acc, { ...parts, value: null });
    }
    if (shownAsPercent) {
      if (kind !== 'percent') {
        flag(acc, 'PERCENT_IN_NON_PERCENT_FIELD', `The cell is shown as a percentage ("${displayText}") in a ${kind} column.`);
        acc.candidates.push({ value: times100(raw), meaning: 'percentage as shown' });
        return finish(raw, origin, kind, acc, { ...parts, value: null });
      }
      return finish(raw, origin, kind, acc, { ...parts, value: times100(raw) });
    }
    if (kind === 'percent' && raw !== 0 && Math.abs(raw) < 1) {
      flag(acc, 'PERCENT_SCALE_UNCONFIRMED', `${raw} in a percentage column could mean ${raw}% or ${times100(raw)}%.`);
      acc.candidates.push({ value: raw, meaning: `${raw}% as written` }, { value: times100(raw), meaning: `${times100(raw)}% (stored as a fraction)` });
      return finish(raw, origin, kind, acc, { ...parts, value: null });
    }
    return finish(raw, origin, kind, acc, { ...parts, value: raw });
  }

  // ---- Text ------------------------------------------------------------------------------
  const text = normaliseSpacing(raw);
  const lower = text.toLowerCase();

  const marker = matchMarker(lower);
  if (marker) {
    return {
      evidence: specialEvidence<number>(raw, marker.special, origin),
      detail: { kind, notation: 'text', currency: null, negativeStyle: null, percentSign: false, thousandsSeparators: false, decimalPlaces: null, displayText, flags: [], candidates: [] },
    };
  }

  // Peel off currency and sign in any order: "RM -50", "-RM 50", "RM (50.00)", "(RM 50.00)".
  let t = text;
  let currency: 'RM' | null = null;
  let minus = false;
  let plus = false;
  let parentheses = false;
  let percentSign = false;

  const peel = () => {
    for (let changed = true; changed; ) {
      changed = false;
      let m: RegExpExecArray | null;
      if ((m = /^(rm|myr)\.?\s*/i.exec(t)) && !/^(rm|myr)[a-z]/i.test(t)) {
        currency = 'RM';
        t = t.slice(m[0].length);
        changed = true;
      } else if ((m = /^(us\$|s\$|\$|usd|sgd|eur|€|£|gbp)\s*/i.exec(t))) {
        flag(acc, 'FOREIGN_CURRENCY', `"${m[1]}" is not Ringgit.`);
        t = t.slice(m[0].length);
        changed = true;
      } else if (t.startsWith('-')) {
        if (minus || parentheses) flag(acc, 'DOUBLE_SIGN', `"${text}" has more than one minus sign or bracket.`);
        minus = true;
        t = t.slice(1).trim();
        changed = true;
      } else if (t.startsWith('+')) {
        plus = true;
        t = t.slice(1).trim();
        changed = true;
      }
    }
  };
  const stripPercent = () => {
    if (t.endsWith('%')) {
      percentSign = true;
      t = t.slice(0, -1).trim();
    }
  };

  stripPercent();
  peel();
  if (/^\(.*\)$/.test(t)) {
    parentheses = true;
    t = t.slice(1, -1).trim();
    stripPercent();
    peel();
  }

  // A dash after the currency ("RM -", accounting format for nothing) is a marker, not zero.
  if (DASH_ONLY.test(text) || (t === '' && minus && !parentheses && !percentSign)) {
    return {
      evidence: specialEvidence<number>(raw, 'NIL_DASH', origin),
      detail: { kind, notation: 'text', currency, negativeStyle: null, percentSign: false, thousandsSeparators: false, decimalPlaces: null, displayText, flags: [], candidates: [] },
    };
  }

  let trailingMinus = false;
  if (/\d\s*-$/.test(t)) {
    trailingMinus = true;
    t = t.replace(/\s*-$/, '');
  }

  const body = parseBody(t, acc);
  let value = body.value;
  const magnitude = value;

  if (minus && parentheses) {
    flag(acc, 'PARENTHESES_AND_MINUS', `"${text}" has both a minus sign and brackets.`);
    if (magnitude !== null) acc.candidates.push({ value: -magnitude, meaning: 'read as negative' });
  }
  if (trailingMinus) {
    flag(acc, 'TRAILING_MINUS', `"${text}" has a minus sign after the number.`);
    if (magnitude !== null) acc.candidates.push({ value: -magnitude, meaning: 'trailing minus read as negative' });
  }
  if (plus && magnitude !== null) flag(acc, 'LEADING_PLUS', `"${text}" starts with "+".`);

  const negative = minus || parentheses;
  if (value !== null && negative) value = -value;

  if (currency && kind !== 'money') {
    flag(acc, 'CURRENCY_IN_NON_MONEY_FIELD', `"${text}" is a money amount but this is a ${kind} column.`);
    if (value !== null) acc.candidates.push({ value, meaning: 'money amount' });
  }
  if (percentSign && kind !== 'percent') {
    flag(acc, 'PERCENT_IN_NON_PERCENT_FIELD', `"${text}" is a percentage in a ${kind} column; whether it is a percentage item depends on the row.`);
    if (value !== null) acc.candidates.push({ value, meaning: 'percentage as written' });
  }
  if (!percentSign && kind === 'percent' && value !== null && value !== 0 && Math.abs(value) < 1) {
    flag(acc, 'PERCENT_SCALE_UNCONFIRMED', `"${text}" in a percentage column could mean ${value}% or ${times100(value)}%.`);
    acc.candidates.push({ value, meaning: `${value}% as written` }, { value: times100(value), meaning: `${times100(value)}% (written as a fraction)` });
  }

  return finish(raw, origin, kind, acc, {
    ...base,
    value,
    notation: 'text',
    currency,
    negativeStyle: parentheses ? 'parentheses' : minus ? 'minus' : null,
    percentSign,
    thousandsSeparators: body.thousands,
    decimalPlaces: body.decimals,
  });
}
