/**
 * COLUMN MEANINGS — proposed from TWO kinds of evidence:
 *   1. the heading text (and, for two-row headings, the group heading above it, e.g. "Previous Claim");
 *   2. what the cells below actually contain (numbers, units, item numbers, long text, percentages).
 *
 * When the two agree, the role is proposed with good confidence. When the heading says one thing
 * and the content another (a misleading heading), the column is proposed as UNKNOWN with both
 * readings offered as alternatives for a person. Numeric columns with no recognisable heading are
 * also UNKNOWN, with the likely readings as alternatives. Nothing is decided by position alone.
 */
import { type ExtractedCell, type ExtractedRow, type ExtractedTable, findCell } from '../../core/models/index.ts';
import { parseNumberCell, parseUnitCell } from '../../core/parsing/index.ts';
import type { AlternativeInterpretation, ColumnRole, ColumnRoleDecision, TableRegionDecision } from '../types.ts';
import { type Citation, citeCell, isBlankCell, textValue } from './util.ts';
import {
  BASIC_HEADINGS,
  CLAIM_STAGES,
  CONTRACT_GROUP,
  OTHER_HEADINGS,
  PERCENT_HEADINGS,
  PROGRESS_PERCENT,
  REMARKS_HEADINGS,
  WORKING_HEADINGS,
  normaliseHeading,
} from './vocabulary.ts';

const ORIGIN = { sources: [], method: 'user_entered' as const, verification: 'user_confirmed' as const };

// ---------------------------------------------------------------------------------------------
// What the cells contain
// ---------------------------------------------------------------------------------------------

export type ContentKind = 'empty' | 'numeric' | 'percent' | 'unit' | 'itemNo' | 'longText' | 'text' | 'mixed';

export interface ContentProfile {
  readonly kind: ContentKind;
  readonly count: number;
  readonly samples: readonly { rowIndex: number; cell: ExtractedCell }[];
}

const ITEM_NO = /^(\(?[a-z]{1,2}\)?|\d{1,3}(\.\d{1,3}){0,3}[a-z]?|[a-z]{1,2}\.?\d{1,3}(\.\d{1,3}){0,2}|[ivx]{1,5})$/i;

export function profileColumn(rows: readonly ExtractedRow[], columnIndex: number): ContentProfile {
  const cells = rows.map((r) => ({ rowIndex: r.rowIndex, cell: findCell(r, columnIndex) })).filter((x): x is { rowIndex: number; cell: ExtractedCell } => !!x.cell && !isBlankCell(x.cell));
  const n = cells.length;
  if (n === 0) return { kind: 'empty', count: 0, samples: [] };
  let numeric = 0, percent = 0, unit = 0, itemNo = 0, longText = 0, text = 0;
  for (const { cell } of cells) {
    const shown = cell.displayText ?? (typeof cell.raw === 'string' ? cell.raw : '');
    if (/\d\s*%\s*\)?$/.test(shown.trim())) percent++; // a figure with "%" (a lone "%" is a unit)
    const parsed = parseNumberCell(cell.raw, 'money', ORIGIN);
    if (parsed.evidence.state === 'value' || parsed.evidence.state === 'zero' || parsed.evidence.state === 'special' || typeof cell.raw === 'number') numeric++;
    const t = textValue(cell);
    if (t !== null && !(parsed.evidence.state === 'value' || parsed.evidence.state === 'zero')) {
      text++;
      if (t.trim().length >= 15) longText++;
      if (parseUnitCell(t, ORIGIN).recognised) unit++;
      if (ITEM_NO.test(t.trim())) itemNo++;
    }
  }
  const r = (x: number) => x / n;
  const kind: ContentKind =
    r(percent) >= 0.6 ? 'percent'
    : r(unit) >= 0.6 ? 'unit'
    : r(itemNo) >= 0.6 && r(longText) < 0.2 ? 'itemNo'
    : r(numeric) >= 0.7 ? 'numeric'
    : r(longText) >= 0.4 && r(text) >= 0.6 ? 'longText'
    : r(text) >= 0.7 ? 'text'
    : 'mixed';
  return { kind, count: n, samples: cells.slice(0, 3) };
}

const NUMERIC_ROLES: ReadonlySet<ColumnRole> = new Set([
  'quantity', 'rate', 'amount', 'baseRate', 'baseAmount', 'tenderRate', 'tenderAmount', 'rateAfterDiscount',
  'additionalQuantity', 'additionalAmount', 'claimPreviousQuantity', 'claimCurrentQuantity', 'claimCumulativeQuantity',
  'claimPreviousAmount', 'claimCurrentAmount', 'claimCumulativeAmount', 'certifiedAmount',
]);
const PERCENT_ROLES: ReadonlySet<ColumnRole> = new Set(['percentage', 'profitPercent', 'claimPercentComplete']);

/** Does the content contradict the role? (An empty column contradicts nothing.) */
export function contentFits(role: ColumnRole, kind: ContentKind): boolean {
  if (kind === 'empty' || role === 'other' || role === 'remarks' || role === 'unknown' || role === 'ignore') return true;
  if (NUMERIC_ROLES.has(role)) return kind === 'numeric';
  if (PERCENT_ROLES.has(role)) return kind === 'percent' || kind === 'numeric';
  if (role === 'description') return kind === 'longText' || kind === 'text';
  if (role === 'unit') return kind === 'unit';
  if (role === 'itemNo') return kind === 'itemNo' || kind === 'numeric';
  return kind !== 'numeric';
}

/** What the content alone suggests (null when it suggests nothing definite). */
function contentGuess(kind: ContentKind): ColumnRole | null {
  return kind === 'longText' ? 'description' : kind === 'unit' ? 'unit' : kind === 'itemNo' ? 'itemNo' : kind === 'percent' ? 'percentage' : null;
}

// ---------------------------------------------------------------------------------------------
// What the heading says
// ---------------------------------------------------------------------------------------------

export interface HeadingReading {
  /** Roles the heading supports, best first. Empty when the heading says nothing usable. */
  readonly roles: ColumnRole[];
  readonly words: string;
}

export function readHeading(own: string, group: string): HeadingReading {
  const h = normaliseHeading(own);
  const g = normaliseHeading(group);
  const both = `${g} ${h}`.trim();
  const words = [group, own].filter((x) => x.trim() !== '').join(' / ');
  if (both === '') return { roles: [], words };

  for (const [role, re] of Object.entries(WORKING_HEADINGS)) if (re.test(h) || (h === '' && re.test(g))) return { roles: [role as ColumnRole], words };

  const stage = (Object.keys(CLAIM_STAGES) as (keyof typeof CLAIM_STAGES)[]).find((s) => CLAIM_STAGES[s].test(both));
  const isQty = BASIC_HEADINGS.quantity.test(h);
  // "Total Qty" is a quantity: the word "total" only means amount when the heading is not a quantity.
  const isAmt = BASIC_HEADINGS.amount.test(isQty ? h.replace(/\btotal\b/g, '') : h);
  const isPct = PERCENT_HEADINGS.test(h) || PROGRESS_PERCENT.test(h);
  if (stage) {
    if (stage === 'certified') return { roles: isQty ? ['unknown'] : ['certifiedAmount'], words };
    if (isPct) return { roles: ['claimPercentComplete'], words };
    const map = {
      previous: ['claimPreviousQuantity', 'claimPreviousAmount'],
      current: ['claimCurrentQuantity', 'claimCurrentAmount'],
      cumulative: ['claimCumulativeQuantity', 'claimCumulativeAmount'],
    } as const;
    const [q, a] = map[stage];
    if (isQty && !isAmt) return { roles: [q], words };
    if (isAmt && !isQty) return { roles: [a], words };
    return { roles: [q, a], words }; // stage known, measure not: both readings
  }
  if (isPct) return { roles: [PROGRESS_PERCENT.test(h) ? 'claimPercentComplete' : 'percentage'], words };
  if (OTHER_HEADINGS.test(h)) return { roles: ['other'], words };
  if (REMARKS_HEADINGS.test(h)) return { roles: ['remarks'], words };

  const roles: ColumnRole[] = [];
  if (BASIC_HEADINGS.description.test(h)) roles.push('description');
  if (BASIC_HEADINGS.unit.test(h)) roles.push('unit');
  if (BASIC_HEADINGS.itemNo.test(h)) roles.push('itemNo');
  if (isQty) roles.push('quantity');
  if (BASIC_HEADINGS.rate.test(h)) roles.push('rate');
  if (isAmt) roles.push('amount');
  if (roles.length === 0 && h === '' && CONTRACT_GROUP.test(g)) return { roles: [], words };
  return { roles, words };
}

// ---------------------------------------------------------------------------------------------
// Proposals for one table
// ---------------------------------------------------------------------------------------------

export interface ColumnProposal {
  readonly value: ColumnRoleDecision;
  readonly confidence: number;
  readonly reasoning: string;
  readonly citations: readonly Citation[];
  readonly alternatives: AlternativeInterpretation<'columnRole'>[];
}

const label: Record<string, string> = {
  itemNo: 'item number', description: 'description', unit: 'unit', quantity: 'quantity', rate: 'rate', amount: 'amount',
  additionalQuantity: 'additional quantity', additionalAmount: 'additional amount', percentage: 'percentage', other: 'other (no BQ field)', unknown: 'unknown',
  baseRate: 'cost / base rate', baseAmount: 'cost / base amount', tenderRate: 'selling / tender rate', tenderAmount: 'selling / tender amount',
  profitPercent: 'markup / profit %', rateAfterDiscount: 'rate after discount', remarks: 'remarks',
  claimPreviousQuantity: 'previous claimed quantity', claimCurrentQuantity: 'current (this claim) quantity', claimCumulativeQuantity: 'cumulative quantity',
  claimPreviousAmount: 'previous claimed amount', claimCurrentAmount: 'current (this claim) amount', claimCumulativeAmount: 'cumulative amount',
  claimPercentComplete: '% complete', certifiedAmount: 'certified amount',
};
const nameOf = (role: ColumnRole) => label[role] ?? role;

export function proposeColumns(table: ExtractedTable, region: TableRegionDecision): ColumnProposal[] {
  if (!region.include) return [];
  const headerRows = region.headerRowIndexes.map((i) => table.rows.find((r) => r.rowIndex === i)!).filter(Boolean);
  const excluded = new Set([...region.headerRowIndexes, ...region.repeatedHeaderRowIndexes]);
  const dataRows = table.rows.filter((r) => r.rowIndex >= region.firstDataRowIndex && r.rowIndex <= region.lastDataRowIndex && !excluded.has(r.rowIndex));
  const ownRow = headerRows[headerRows.length - 1];
  const groupRow = headerRows.length > 1 ? headerRows[0] : undefined;

  const columns = new Set<number>();
  for (const r of [...headerRows, ...dataRows]) for (const c of r.cells) if (!isBlankCell(c)) columns.add(c.columnIndex);

  const proposals: ColumnProposal[] = [];
  for (const col of [...columns].sort((a, b) => a - b)) {
    const citations: Citation[] = [];
    const ownCell = ownRow ? findCell(ownRow, col) : undefined;
    const ownText = ownCell ? textValue(ownCell) ?? '' : '';
    if (ownCell && !isBlankCell(ownCell)) citations.push(citeCell(table, ownRow!.rowIndex, ownCell));

    // Group heading: the cell above, or the merged cell covering it.
    let groupText = '';
    if (groupRow) {
      let gCell = findCell(groupRow, col);
      if (!gCell || isBlankCell(gCell)) {
        const merge = (table.merges ?? []).find((m) => m.startRowNumber === groupRow.rowIndex + 1 && col + 1 >= m.startColumnNumber && col + 1 <= m.endColumnNumber);
        gCell = merge ? findCell(groupRow, merge.startColumnNumber - 1) : undefined;
      }
      if (gCell && !isBlankCell(gCell)) {
        groupText = textValue(gCell) ?? '';
        citations.push(citeCell(table, groupRow.rowIndex, gCell));
      }
    }

    const profile = profileColumn(dataRows, col);
    for (const s of profile.samples) citations.push(citeCell(table, s.rowIndex, s.cell));
    if (citations.length === 0) continue;

    const heading = readHeading(ownText, groupText);
    const guess = contentGuess(profile.kind);
    const contentWords = profile.kind === 'empty' ? 'no data below the heading' : `the cells below are mostly ${profile.kind === 'longText' ? 'long text' : profile.kind === 'itemNo' ? 'item numbers' : profile.kind}`;
    const value = (role: ColumnRole): ColumnRoleDecision => ({ tableId: table.id, columnIndex: col, role });
    const alt = (role: ColumnRole, confidence: number, reasoning: string): AlternativeInterpretation<'columnRole'> => ({ value: value(role), confidence, reasoning });

    const fitting = heading.roles.filter((r) => contentFits(r, profile.kind));
    if (heading.roles.length > 0 && fitting.length > 0) {
      const [main, ...others] = fitting;
      proposals.push({
        value: value(main!),
        confidence: profile.kind === 'empty' ? 0.6 : others.length ? 0.5 : 0.9,
        reasoning: `Heading "${heading.words}" reads as ${nameOf(main!)}; ${contentWords}.${others.length ? ' The heading could also mean ' + others.map(nameOf).join(' or ') + '.' : ''}`,
        citations,
        alternatives: others.map((r) => alt(r, 0.4, `Heading "${heading.words}" could also mean ${nameOf(r)}.`)),
      });
    } else if (heading.roles.length > 0) {
      // The heading and the content disagree: do not trust the heading.
      const alternatives = heading.roles.map((r) => alt(r, 0.3, `The heading "${heading.words}" says ${nameOf(r)}, but ${contentWords}.`));
      if (guess && !heading.roles.includes(guess)) alternatives.push(alt(guess, 0.3, `The content suggests ${nameOf(guess)}.`));
      proposals.push({
        value: value('unknown'),
        confidence: 0.2,
        reasoning: `The heading "${heading.words}" does not match the content (${contentWords}). Needs a person to decide.`,
        citations,
        alternatives,
      });
    } else if (guess && profile.count >= 2) {
      proposals.push({
        value: value(guess),
        confidence: 0.5,
        reasoning: `No recognisable heading${heading.words ? ` ("${heading.words}")` : ''}; ${contentWords}.`,
        citations,
        alternatives: [],
      });
    } else {
      const numeric = profile.kind === 'numeric';
      proposals.push({
        value: value('unknown'),
        confidence: 0.2,
        reasoning: `No recognisable heading${heading.words ? ` ("${heading.words}")` : ''}; ${contentWords}. Its meaning cannot be determined from the document.`,
        citations,
        alternatives: numeric ? (['quantity', 'rate', 'amount'] as const).map((r) => alt(r, 0.2, `Numeric column; could be ${nameOf(r)}.`)) : [],
      });
    }
  }
  return resolveDuplicates(proposals);
}

/** When several columns claim the same single-use role, keep the alternatives open rather than guess. */
function resolveDuplicates(proposals: ColumnProposal[]): ColumnProposal[] {
  const out = [...proposals];
  const headingOf = (p: ColumnProposal) => p.citations[0]?.quote ?? '';
  for (const role of ['quantity', 'amount'] as const) {
    const extra = role === 'quantity' ? 'additionalQuantity' : 'additionalAmount';
    const idx = out.map((p, i) => (p.value.role === role ? i : -1)).filter((i) => i >= 0);
    if (idx.length < 2) continue;
    const totalIdx = idx.find((i) => /\btotal\b/.test(normaliseHeading(headingOf(out[i]!))));
    idx.forEach((i, n) => {
      const p = out[i]!;
      const isMain = totalIdx !== undefined ? i === totalIdx : n === 0;
      if (isMain) {
        out[i] = { ...p, confidence: totalIdx !== undefined ? 0.7 : 0.5, reasoning: `${p.reasoning} One of ${idx.length} ${role} columns${totalIdx !== undefined ? ' (marked "total")' : ''}.`, alternatives: totalIdx !== undefined ? p.alternatives : [...p.alternatives, { value: { ...p.value, role: extra }, confidence: 0.4, reasoning: `Could be one of several ${role} columns rather than the main one.` }] };
      } else {
        out[i] = { ...p, value: { ...p.value, role: extra }, confidence: 0.6, reasoning: `${p.reasoning} Another ${role} column, proposed as an additional ${role} column.`, alternatives: [{ value: { ...p.value, role }, confidence: 0.3, reasoning: `Could be the main ${role} column.` }] };
      }
    });
  }
  for (const role of ['description', 'unit', 'itemNo', 'rate'] as const) {
    const idx = out.map((p, i) => (p.value.role === role ? i : -1)).filter((i) => i >= 0);
    idx.slice(1).forEach((i) => {
      const p = out[i]!;
      const firstCol = out[idx[0]!]!.value.columnIndex + 1;
      out[i] = { ...p, value: { ...p.value, role: 'unknown' }, confidence: 0.2, reasoning: `${p.reasoning} Column ${firstCol} already reads as ${nameOf(role)}; two ${nameOf(role)} columns need a person to decide.`, alternatives: [{ value: { ...p.value, role }, confidence: 0.3, reasoning: `Could be the ${nameOf(role)} column.` }] };
    });
  }
  return out;
}
