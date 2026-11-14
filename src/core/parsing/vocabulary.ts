/**
 * Words and markers the parser recognises. Kept as plain lists so they are easy to review
 * and extend. Matching ignores capitals and extra spaces; everything else is exact.
 *
 * Nothing here converts a marker into a number. A marker is recorded as what it is.
 */
import type { SpecialValue } from '../models/evidence.ts';

export interface MarkerRule {
  readonly special: SpecialValue;
  readonly pattern: RegExp;
  /** Plain-English examples, shown in documentation and tests. */
  readonly examples: readonly string[];
}

/**
 * Whole-cell markers in figure columns (Qty / Rate / Amount / %).
 * A cell must consist of the marker only; longer text is not guessed at.
 */
export const MARKER_RULES: readonly MarkerRule[] = [
  { special: 'INCLUDED', pattern: /^(incl|inc|incld|included)\.?$/, examples: ['Incl.', 'Included', 'INC'] },
  { special: 'EXCLUDED', pattern: /^(excl|exc|excluded)\.?$/, examples: ['Excl.', 'Excluded'] },
  { special: 'RATE_ONLY', pattern: /^(rate only|r\.\s?o\.?|r\/o)$/, examples: ['Rate Only', 'R.O.', 'R/O'] },
  { special: 'PRIME_COST_SUM', pattern: /^(p\.?\s?c\.?\s?sum|prime cost( sum)?|p\.\s?c\.)$/, examples: ['P.C. Sum', 'PC Sum', 'Prime Cost Sum', 'P.C.'] },
  { special: 'PROVISIONAL_SUM', pattern: /^(prov(isional|\.)?\s?sum|p\.\s?s\.?)$/, examples: ['Provisional Sum', 'Prov. Sum', 'Prov Sum', 'P.S.'] },
  { special: 'LUMP_SUM', pattern: /^(l\.?\s?s\.?|lump\s?sum)$/, examples: ['L.S.', 'LS', 'Lump Sum'] },
  { special: 'NOT_APPLICABLE', pattern: /^(n\/a|n\.\s?a\.?|na|not applicable)$/, examples: ['N/A', 'N.A.', 'NA'] },
  { special: 'NIL', pattern: /^nil\.?$/, examples: ['Nil', 'NIL'] },
  { special: 'BY_OTHERS', pattern: /^by others?$/, examples: ['By others'] },
];

/** A cell that is only dashes, e.g. "-", "–", "—", "--" (common for "nothing" in BQs). */
export const DASH_ONLY = /^[-–—]+$/;

/**
 * Units of measurement. Used ONLY to recognise a unit written in a figure column
 * (e.g. "m2" in the Qty column, or "10 m2"), so it is flagged rather than misread.
 * The unit column itself is always kept exactly as written.
 */
export const UNIT_WORDS: readonly string[] = [
  'm', 'm1', 'lm', 'mtr', 'm2', 'm²', 'sqm', 'sq.m', 'm3', 'm³', 'cum', 'cu.m',
  'mm', 'cm', 'km', 'kg', 't', 'ton', 'tonne', 'tonnes', 'l', 'litre', 'ltr',
  'nr', 'no', 'no.', 'nos', 'nos.', 'item', 'items', 'sum', 'lot', 'set', 'pair', 'pcs', 'pc',
  'day', 'days', 'week', 'weeks', 'wk', 'month', 'months', 'mth', 'hr', 'hrs', 'hour', 'hours',
  'acre', 'ha', 'bag', 'roll', 'length', 'lgth',
];

const UNIT_SET = new Set(UNIT_WORDS);

export const isUnitWord = (text: string): boolean => UNIT_SET.has(text.trim().toLowerCase());

export function matchMarker(normalisedLowerCase: string): MarkerRule | undefined {
  return MARKER_RULES.find((rule) => rule.pattern.test(normalisedLowerCase));
}
