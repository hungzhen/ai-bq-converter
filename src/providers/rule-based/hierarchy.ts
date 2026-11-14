/**
 * HIERARCHY — which heading each row sits under, from the (proposed or approved) row types.
 *
 *   bill  >  section  >  main heading  >  sub-heading  >  secondary sub-heading  >  item
 *   (a continuation line belongs to the item above it — it is NOT joined to it)
 *
 * Only headings that are really in the document are used; no level is invented. An item with no
 * heading above it in its own table is left unresolved (no proposal). Trades, sub-trades and
 * elements are not hierarchy levels here: they are classification suggestions (trades.ts).
 */
import { type ExtractedTable } from '../../core/models/index.ts';
import type { BqRowClass } from '../../core/models/index.ts';
import type { HierarchyDecision, HierarchyLevel, RowClassDecision } from '../types.ts';
import { type Citation, citeCell, nonBlankCells, textValue } from './util.ts';

const HEADING_LEVEL: Partial<Record<BqRowClass, { level: HierarchyLevel; rank: number }>> = {
  bill_heading: { level: 'bill', rank: 0 },
  section_heading: { level: 'section', rank: 1 },
  main_heading: { level: 'main_heading', rank: 2 },
  subheading: { level: 'subheading', rank: 3 },
  secondary_subheading: { level: 'secondary_subheading', rank: 4 },
};
const ITEMS: ReadonlySet<BqRowClass> = new Set(['priced_item', 'description_only_item', 'provisional_sum', 'prime_cost_sum', 'percentage_item']);

export interface HierarchyProposal {
  readonly value: HierarchyDecision;
  readonly confidence: number;
  readonly reasoning: string;
  readonly citations: readonly Citation[];
}

/** The text cells of a row, cited (the row's own words). */
function rowCitations(table: ExtractedTable, rowIndex: number): Citation[] {
  const row = table.rows.find((r) => r.rowIndex === rowIndex);
  if (!row) return [];
  const cells = nonBlankCells(row);
  const texts = cells.filter((c) => textValue(c) !== null);
  return (texts.length ? texts : cells).map((c) => citeCell(table, rowIndex, c));
}

const firstText = (c: readonly Citation[]) => c.find((x) => x.quote)?.quote ?? '';

export function proposeHierarchy(table: ExtractedTable, rows: readonly RowClassDecision[]): HierarchyProposal[] {
  const ordered = rows.filter((r) => r.tableId === table.id).sort((a, b) => a.rowIndex - b.rowIndex);
  const stack: { rowIndex: number; rank: number }[] = [];
  let lastItem: number | null = null;
  const out: HierarchyProposal[] = [];

  for (const r of ordered) {
    const heading = HEADING_LEVEL[r.rowClass];
    const own = rowCitations(table, r.rowIndex);
    if (own.length === 0) continue;

    if (heading) {
      while (stack.length && stack[stack.length - 1]!.rank >= heading.rank) stack.pop();
      const parent = stack[stack.length - 1];
      const parentCites = parent ? rowCitations(table, parent.rowIndex) : [];
      out.push({
        value: { tableId: table.id, rowIndex: r.rowIndex, level: heading.level, parentRowIndex: parent ? parent.rowIndex : null },
        confidence: 0.5,
        reasoning: parent
          ? `Heading "${firstText(own)}" follows "${firstText(parentCites)}" (a higher heading level).`
          : `Heading "${firstText(own)}" has no higher heading above it in this table.`,
        citations: [...own, ...parentCites],
      });
      stack.push({ rowIndex: r.rowIndex, rank: heading.rank });
      lastItem = null;
      continue;
    }

    if (ITEMS.has(r.rowClass)) {
      lastItem = r.rowIndex;
      const parent = stack[stack.length - 1];
      if (!parent) continue; // no heading above: left unresolved
      const parentCites = rowCitations(table, parent.rowIndex);
      out.push({
        value: { tableId: table.id, rowIndex: r.rowIndex, level: 'item', parentRowIndex: parent.rowIndex },
        confidence: 0.6,
        reasoning: `Item under the nearest heading above it, "${firstText(parentCites)}".`,
        citations: [...own, ...parentCites],
      });
      continue;
    }

    if (r.rowClass === 'continuation' && lastItem !== null) {
      const parentCites = rowCitations(table, lastItem);
      out.push({
        value: { tableId: table.id, rowIndex: r.rowIndex, level: 'continuation', parentRowIndex: lastItem },
        confidence: 0.5,
        reasoning: `Probably continues the description of the item above ("${firstText(parentCites)}"). The texts are not joined.`,
        citations: [...own, ...parentCites],
      });
    }
  }
  return out;
}
