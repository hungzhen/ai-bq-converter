/**
 * TABLE REGIONS — where the column headings are, whether they repeat further down (e.g. on
 * every printed page), and where the data starts and ends.
 *
 * A row counts as a heading row when several of its short text cells read like column headings
 * (Description, Unit, Qty, Rate, Amount, Previous, Cumulative …). A row directly above it is
 * added as a GROUP heading row when it holds group words (Contract, Previous Claim, This Claim,
 * Cumulative, Cost, Selling …) or a merged heading spanning several columns.
 *
 * No row is ever discarded: rows outside the data range are still classified (title, header,
 * blank …) by the row classifier.
 */
import type { ExtractedRow, ExtractedTable } from '../../core/models/index.ts';
import type { TableRegionDecision } from '../types.ts';
import { textValue } from './util.ts';
import { BASIC_HEADINGS, CLAIM_STAGES, CONTRACT_GROUP, OTHER_HEADINGS, PERCENT_HEADINGS, REMARKS_HEADINGS, WORKING_HEADINGS, normaliseHeading } from './vocabulary.ts';

/** How many rows from the top are searched for headings. */
export const HEADER_SEARCH_ROWS = 40;
/** A heading cell is short. */
const MAX_HEADING_LENGTH = 40;

/** The heading kinds a cell's text matches (empty when it does not read like a column heading). */
export function headingKinds(text: string): string[] {
  const t = normaliseHeading(text);
  if (t === '' || text.length > MAX_HEADING_LENGTH) return [];
  const kinds = new Set<string>();
  for (const [name, re] of Object.entries(BASIC_HEADINGS)) if (re.test(t)) kinds.add(name);
  for (const [name, re] of Object.entries(WORKING_HEADINGS)) if (re.test(t)) kinds.add(name);
  for (const [name, re] of Object.entries(CLAIM_STAGES)) if (re.test(t)) kinds.add(name);
  if (PERCENT_HEADINGS.test(t)) kinds.add('percent');
  if (OTHER_HEADINGS.test(t)) kinds.add('other');
  if (REMARKS_HEADINGS.test(t)) kinds.add('remarks');
  return [...kinds];
}

const GROUP_WORDS = (t: string) => CONTRACT_GROUP.test(t) || Object.values(CLAIM_STAGES).some((re) => re.test(t)) || /\b(cost|selling|tender)\b/.test(t);

function rowHeadingScore(row: ExtractedRow): { score: number; kinds: Set<string>; hasCore: boolean } {
  const kinds = new Set<string>();
  for (const cell of row.cells) {
    const text = textValue(cell);
    if (text) headingKinds(text).forEach((k) => kinds.add(k));
  }
  const hasCore = kinds.has('description') && (kinds.has('quantity') || kinds.has('amount') || kinds.has('unit') || kinds.has('rate'));
  return { score: kinds.size, kinds, hasCore };
}

const isHeadingRow = (s: { score: number; hasCore: boolean }) => s.score >= 3 || (s.score >= 2 && s.hasCore);

/** Texts of a row's text cells by column, normalised, for comparing heading rows. */
const rowSignature = (row: ExtractedRow): Map<number, string> =>
  new Map(row.cells.filter((c) => textValue(c)).map((c) => [c.columnIndex, normaliseHeading(textValue(c)!)]));

export interface DetectedRegion {
  readonly decision: TableRegionDecision;
  /** Heading kinds found, for the explanation. */
  readonly kinds: readonly string[];
  readonly hasGroupRow: boolean;
}

/** Finds the region of one table; null when the table has no content at all. */
export function detectRegion(table: ExtractedTable): DetectedRegion | null {
  const nonBlank = table.rows.filter((r) => r.cells.some((c) => c.raw !== null && !(typeof c.raw === 'string' && c.raw.trim() === '')));
  if (nonBlank.length === 0) return null;
  const firstContent = nonBlank[0]!.rowIndex;
  const lastContent = nonBlank[nonBlank.length - 1]!.rowIndex;

  let best: { row: ExtractedRow; score: number; kinds: Set<string> } | null = null;
  for (const row of table.rows.slice(0, HEADER_SEARCH_ROWS)) {
    const s = rowHeadingScore(row);
    if (isHeadingRow(s) && (!best || s.score > best.score)) best = { row, score: s.score, kinds: s.kinds };
  }

  if (!best) {
    return {
      decision: { tableId: table.id, headerRowIndexes: [], repeatedHeaderRowIndexes: [], firstDataRowIndex: firstContent, lastDataRowIndex: lastContent, include: false },
      kinds: [],
      hasGroupRow: false,
    };
  }

  const headerIndex = best.row.rowIndex;
  const headerRows = [headerIndex];
  const above = table.rows.find((r) => r.rowIndex === headerIndex - 1);
  let hasGroupRow = false;
  if (above) {
    const groupText = above.cells.some((c) => {
      const t = textValue(c);
      return t !== null && t.length <= MAX_HEADING_LENGTH && GROUP_WORDS(normaliseHeading(t));
    });
    const wideMerge = (table.merges ?? []).some((m) => m.startRowNumber === headerIndex && m.endRowNumber === headerIndex && m.endColumnNumber > m.startColumnNumber);
    if (groupText || wideMerge) {
      headerRows.unshift(headerIndex - 1);
      hasGroupRow = true;
    }
  }

  const signature = rowSignature(best.row);
  const repeated: number[] = [];
  for (const row of table.rows) {
    if (row.rowIndex <= headerIndex) continue;
    const other = rowSignature(row);
    let same = 0;
    for (const [col, text] of signature) if (other.get(col) === text) same++;
    if (signature.size >= 2 && same >= 2 && same / signature.size >= 0.6) repeated.push(row.rowIndex);
  }

  const lastRow = table.rows[table.rows.length - 1]!.rowIndex;
  const first = Math.min(headerIndex + 1, lastRow);
  return {
    decision: {
      tableId: table.id,
      headerRowIndexes: headerRows,
      repeatedHeaderRowIndexes: repeated,
      firstDataRowIndex: first,
      lastDataRowIndex: Math.max(first, lastContent),
      include: true,
    },
    kinds: [...best.kinds],
    hasGroupRow,
  };
}
