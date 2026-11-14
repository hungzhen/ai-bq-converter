/**
 * ROW TYPES — every row of every table gets exactly one proposed row type, so every source row is
 * accounted for (title, column header, heading, item, note, total, blank, unknown …).
 *
 * Conservative rules:
 *   - a number alone does not make a priced item (it needs a description and a unit, or a figure
 *     next to a description);
 *   - text alone does not make a heading (long text is a note; text starting in lower case after
 *     an item may be its continuation; unclear text stays a low-confidence proposal with alternatives);
 *   - a percentage is a percentage item only when the row shows it (unit "%" and words such as
 *     "profit" or "attendance"); otherwise the row is left unknown with both readings;
 *   - nothing is calculated, combined, removed or changed.
 */
import { type ExtractedCell, type ExtractedRow, type ExtractedTable, findCell } from '../../core/models/index.ts';
import { parseNumberCell, parseUnitCell, type NumericFieldKind } from '../../core/parsing/index.ts';
import type { BqRowClass } from '../../core/models/index.ts';
import type { AlternativeInterpretation, ColumnRole, ColumnRoleDecision, TableRegionDecision } from '../types.ts';
import { type Citation, citeCell, citeRow, isBlankCell, nonBlankCells, textValue } from './util.ts';
import { ROW_PATTERNS, normaliseHeading } from './vocabulary.ts';

const ORIGIN = { sources: [], method: 'user_entered' as const, verification: 'user_confirmed' as const };

const QTY_ROLES: ReadonlySet<ColumnRole> = new Set(['quantity', 'additionalQuantity', 'claimPreviousQuantity', 'claimCurrentQuantity', 'claimCumulativeQuantity']);
const RATE_ROLES: ReadonlySet<ColumnRole> = new Set(['rate', 'baseRate', 'tenderRate', 'rateAfterDiscount']);
const AMOUNT_ROLES: ReadonlySet<ColumnRole> = new Set(['amount', 'additionalAmount', 'baseAmount', 'tenderAmount', 'claimPreviousAmount', 'claimCurrentAmount', 'claimCumulativeAmount', 'certifiedAmount']);

export interface RowProposal {
  readonly rowIndex: number;
  readonly rowClass: BqRowClass;
  readonly confidence: number;
  readonly reasoning: string;
  readonly citations: readonly Citation[];
  readonly alternatives: readonly { rowClass: BqRowClass; confidence: number; reasoning: string }[];
}

interface RowFacts {
  description: string | null;
  itemNo: boolean;
  unit: { present: boolean; percent: boolean; lumpSum: boolean };
  figures: { numeric: boolean; marker: boolean; percentInFigure: boolean; specials: Set<string> };
  anyText: string | null;
}

function factsOf(row: ExtractedRow, columns: readonly ColumnRoleDecision[]): RowFacts {
  const cellFor = (role: ColumnRole) => columns.filter((c) => c.role === role).map((c) => findCell(row, c.columnIndex)).filter((c): c is ExtractedCell => !!c && !isBlankCell(c));
  const desc = cellFor('description').map(textValue).find((t) => t !== null) ?? null;
  const unitCell = cellFor('unit')[0];
  const unit = unitCell ? parseUnitCell(unitCell.raw, ORIGIN) : null;
  const figures = { numeric: false, marker: false, percentInFigure: false, specials: new Set<string>() };
  for (const col of columns) {
    const kind: NumericFieldKind | null = QTY_ROLES.has(col.role) ? 'quantity' : RATE_ROLES.has(col.role) || AMOUNT_ROLES.has(col.role) ? 'money' : null;
    if (!kind) continue;
    const cell = findCell(row, col.columnIndex);
    if (!cell || isBlankCell(cell)) continue;
    const r = parseNumberCell(cell.raw, kind, ORIGIN, cell.displayText !== null ? { displayText: cell.displayText } : {});
    if (r.evidence.state === 'value' || r.evidence.state === 'zero') figures.numeric = true;
    if (r.evidence.state === 'special') {
      figures.marker = true;
      figures.specials.add(r.evidence.special!);
    }
    if (r.detail.flags.some((f) => f.code === 'PERCENT_IN_NON_PERCENT_FIELD')) figures.percentInFigure = true;
  }
  // A percentage figure (e.g. "5%") in any cell that is not a text, unit or percentage column — even
  // in a column whose meaning is not settled — is noticed, so it is never read as an ordinary figure.
  const textRoles = new Set<ColumnRole>(['description', 'itemNo', 'unit', 'remarks', 'percentage', 'profitPercent', 'claimPercentComplete']);
  for (const cell of nonBlankCells(row)) {
    const role = columns.find((c) => c.columnIndex === cell.columnIndex)?.role;
    const shown = (cell.displayText ?? (typeof cell.raw === 'string' ? cell.raw : '')).trim();
    if ((!role || !textRoles.has(role)) && /\d\s*%\s*\)?$/.test(shown)) figures.percentInFigure = true;
  }
  const anyText = nonBlankCells(row).map(textValue).find((t) => t !== null && !/^[\d\s.,()%-]+$/.test(t)) ?? null;
  return {
    description: desc,
    itemNo: cellFor('itemNo').length > 0,
    unit: { present: unit?.evidence.state === 'value', percent: unit?.meaning === 'percentage', lumpSum: unit?.meaning === 'lump_sum' },
    figures,
    anyText,
  };
}

const isUpperCase = (t: string) => /[A-Z]{3}/.test(t) && t === t.toUpperCase();

function classify(f: RowFacts, previous: BqRowClass | null): Omit<RowProposal, 'rowIndex' | 'citations'> {
  const text = f.description ?? f.anyText;
  const norm = text ? normaliseHeading(text) : '';
  const hasFigure = f.figures.numeric || f.figures.marker;
  const one = (rowClass: BqRowClass, confidence: number, reasoning: string, alternatives: RowProposal['alternatives'] = []) => ({ rowClass, confidence, reasoning, alternatives });

  if (text) {
    if (ROW_PATTERNS.carriedForward.test(norm)) return one('carried_forward', 0.8, `"${text}" carries a total forward.`);
    if (ROW_PATTERNS.broughtForward.test(norm)) return one('brought_forward', 0.8, `"${text}" brings a total forward.`);
    if (ROW_PATTERNS.subtotal.test(norm)) return one('subtotal', 0.8, `"${text}" is a sub-total or page total.`);
    if (ROW_PATTERNS.total.test(norm)) return one('total', 0.75, `"${text}" is a total.`);
    if (ROW_PATTERNS.collection.test(norm)) return one('collection', 0.7, `"${text}" starts a collection.`);
    if (ROW_PATTERNS.summary.test(norm)) return one('summary', 0.7, `"${text}" starts a summary.`);
    if (ROW_PATTERNS.pageMarker.test(norm) && !hasFigure) return one('reference', 0.7, `"${text}" is a page or continuation marker.`);
  }

  const itemLike = f.description !== null && (f.itemNo || f.unit.present || hasFigure);
  if (f.figures.specials.has('PROVISIONAL_SUM') || (itemLike && ROW_PATTERNS.provisionalSum.test(norm))) {
    return one('provisional_sum', 0.7, `Provisional Sum: ${f.figures.specials.has('PROVISIONAL_SUM') ? 'marked in a figure column' : `"${text}"`}.`);
  }
  if (f.figures.specials.has('PRIME_COST_SUM') || (itemLike && ROW_PATTERNS.primeCostSum.test(norm))) {
    return one('prime_cost_sum', 0.7, `Prime Cost Sum: ${f.figures.specials.has('PRIME_COST_SUM') ? 'marked in a figure column' : `"${text}"`}.`);
  }

  if (f.unit.percent || f.figures.percentInFigure) {
    if (f.description && ROW_PATTERNS.percentageWords.test(norm) && f.unit.percent) {
      return one('percentage_item', 0.7, `Unit "%" and "${f.description}" describe a percentage item.`);
    }
    return one('unknown', 0.3, 'The row shows a percentage, but nothing else in it confirms a percentage item.', [
      { rowClass: 'percentage_item', confidence: 0.3, reasoning: 'Could be a percentage item (e.g. profit or attendance on a sum).' },
      { rowClass: 'priced_item', confidence: 0.2, reasoning: 'Could be an ordinary item with a percentage written in it.' },
    ]);
  }

  if (f.description && f.unit.present && hasFigure) {
    return one('priced_item', 0.85, `Description, unit${f.unit.lumpSum ? ' (lump sum)' : ''} and figure(s) are present.`);
  }
  if (f.description && hasFigure) {
    return one('priced_item', 0.55, 'Description and figure(s) but no unit.', [
      { rowClass: 'subtotal', confidence: 0.3, reasoning: 'Could be a total line written as a description.' },
    ]);
  }
  if (f.description && f.unit.present) {
    return one('description_only_item', 0.5, 'Description and unit, but no figures (an item not priced in this document).', [
      { rowClass: 'priced_item', confidence: 0.4, reasoning: 'Could be a BQ item whose figures were left blank.' },
    ]);
  }
  if (hasFigure && !f.description) {
    return one('unknown', 0.3, 'Figures without a description.', [
      { rowClass: 'subtotal', confidence: 0.3, reasoning: 'Could be a total without a label.' },
    ]);
  }
  if (f.description && f.itemNo) {
    return one('description_only_item', 0.5, 'Item number and description, but no unit or figures.', [
      { rowClass: 'main_heading', confidence: 0.3, reasoning: 'Could be a numbered heading.' },
      { rowClass: 'subheading', confidence: 0.3, reasoning: 'Could be a numbered sub-heading.' },
    ]);
  }

  if (!text) return one('unknown', 0.2, 'The row has content that is neither text nor a figure in a known column.');

  if (ROW_PATTERNS.noteLabel.test(norm) || (text.trim().endsWith(':') && text.length <= 40)) return one('note_label', 0.7, `"${text}" labels the notes that follow.`);
  if (text.length >= 120 || (text.match(/[.;]\s+[A-Z]/g) ?? []).length >= 1) return one('note', 0.65, 'Long descriptive text with no figures: a note or specification.');
  if (/^[a-z]/.test(text.trim()) && previous && ['priced_item', 'description_only_item', 'continuation'].includes(previous)) {
    return one('continuation', 0.55, 'Starts in lower case right after an item: probably continues its description (not joined).', [
      { rowClass: 'note', confidence: 0.3, reasoning: 'Could be a separate note.' },
    ]);
  }
  if (ROW_PATTERNS.billHeading.test(norm)) return one('bill_heading', 0.8, `"${text}" names a bill.`);
  if (ROW_PATTERNS.sectionHeading.test(norm)) return one('section_heading', 0.7, `"${text}" names a section / element.`);
  if (text.length <= 100 && isUpperCase(text)) {
    return one('main_heading', 0.6, `"${text}" is short, in capitals, with no figures.`, [{ rowClass: 'subheading', confidence: 0.3, reasoning: 'Could be a sub-heading.' }]);
  }
  if (text.length <= 100) {
    return one('subheading', 0.45, `"${text}" is short text with no figures; its heading level is not certain.`, [
      { rowClass: 'secondary_subheading', confidence: 0.3, reasoning: 'Could be a third-level heading.' },
      { rowClass: 'note', confidence: 0.3, reasoning: 'Could be a short note.' },
    ]);
  }
  return one('unknown', 0.2, 'Cannot be determined from the row.');
}

const ITEM_CLASSES: ReadonlySet<BqRowClass> = new Set(['priced_item', 'description_only_item', 'provisional_sum', 'prime_cost_sum', 'percentage_item', 'continuation']);

/** One proposal for every row of the table. */
export function proposeRows(table: ExtractedTable, region: TableRegionDecision | null, columns: readonly ColumnRoleDecision[]): RowProposal[] {
  const headerSet = new Set(region?.headerRowIndexes ?? []);
  const repeatedSet = new Set(region?.repeatedHeaderRowIndexes ?? []);
  const firstHeader = region && region.headerRowIndexes.length ? Math.min(...region.headerRowIndexes) : -1;
  const out: RowProposal[] = [];
  let previous: BqRowClass | null = null;

  for (const row of table.rows) {
    const cells = nonBlankCells(row);
    const citations: Citation[] = cells.length ? cells.map((c) => citeCell(table, row.rowIndex, c)) : [citeRow(table, row.rowIndex)];
    const push = (p: Omit<RowProposal, 'rowIndex' | 'citations'>) => {
      out.push({ rowIndex: row.rowIndex, citations, ...p });
      if (p.rowClass !== 'blank') previous = ITEM_CLASSES.has(p.rowClass) ? p.rowClass : p.rowClass === 'column_header' ? previous : p.rowClass;
    };

    if (cells.length === 0) {
      push({ rowClass: 'blank', confidence: 0.95, reasoning: 'The row has no content.', alternatives: [] });
      continue;
    }
    if (!region || !region.include) {
      push({ rowClass: 'unknown', confidence: 0.3, reasoning: 'Not in a detected BQ table (no column headings found on this sheet).', alternatives: [] });
      continue;
    }
    if (headerSet.has(row.rowIndex)) {
      push({ rowClass: 'column_header', confidence: 0.85, reasoning: 'Column-heading row of the table.', alternatives: [] });
      continue;
    }
    if (repeatedSet.has(row.rowIndex)) {
      push({ rowClass: 'column_header', confidence: 0.8, reasoning: 'Repeats the column headings (e.g. at the top of a printed page).', alternatives: [] });
      continue;
    }
    if (row.rowIndex < firstHeader) {
      push({ rowClass: 'title', confidence: 0.6, reasoning: 'Above the column headings: title or preamble.', alternatives: [{ rowClass: 'note', confidence: 0.3, reasoning: 'Could be a preamble note.' }] });
      continue;
    }
    push(classify(factsOf(row, columns), previous));
  }
  return out;
}

export function rowAlternatives(table: ExtractedTable, p: RowProposal): AlternativeInterpretation<'rowClass'>[] {
  return p.alternatives.map((a) => ({ value: { tableId: table.id, rowIndex: p.rowIndex, rowClass: a.rowClass }, confidence: a.confidence, reasoning: a.reasoning }));
}
