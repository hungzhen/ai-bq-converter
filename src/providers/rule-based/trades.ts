/**
 * TRADE / SUB-TRADE SUGGESTIONS (D-008) — from keywords in an item's own description, or else in
 * the nearest heading above it. The Cost Library taxonomy is the reference list of allowed labels.
 *
 * Suggestions are kept apart from the description (which is never changed), stay proposals until a
 * person approves them, and nothing is suggested when no keyword is found. Cost Item and Element
 * are not suggested by these rules (see the stage report).
 */
import { type ExtractedTable } from '../../core/models/index.ts';
import type { BqRowClass } from '../../core/models/index.ts';
import type { AlternativeInterpretation, ClassificationSuggestionDecision, RowClassDecision } from '../types.ts';
import { type Citation, citeCell, nonBlankCells, textValue } from './util.ts';
import { TRADE_KEYWORDS, type TradeKeyword, normaliseHeading } from './vocabulary.ts';

const ITEMS: ReadonlySet<BqRowClass> = new Set(['priced_item', 'description_only_item']);
const HEADINGS: ReadonlySet<BqRowClass> = new Set(['bill_heading', 'section_heading', 'main_heading', 'subheading', 'secondary_subheading']);

export interface SuggestionProposal {
  readonly value: ClassificationSuggestionDecision;
  readonly confidence: number;
  readonly reasoning: string;
  readonly citations: readonly Citation[];
  readonly alternatives: AlternativeInterpretation<'classificationSuggestion'>[];
}

/** The longest text cell of a row (its description), cited. */
function descriptionCell(table: ExtractedTable, rowIndex: number): Citation | null {
  const row = table.rows.find((r) => r.rowIndex === rowIndex);
  if (!row) return null;
  const texts = nonBlankCells(row).filter((c) => textValue(c) !== null);
  if (!texts.length) return null;
  const longest = texts.reduce((a, b) => (textValue(b)!.length > textValue(a)!.length ? b : a));
  return citeCell(table, rowIndex, longest);
}

function matches(text: string): TradeKeyword[] {
  const norm = normaliseHeading(text);
  const found: TradeKeyword[] = [];
  for (const k of TRADE_KEYWORDS) if (k.pattern.test(norm) && !found.some((f) => f.trade === k.trade)) found.push(k);
  return found;
}

export function proposeSuggestions(table: ExtractedTable, rows: readonly RowClassDecision[]): SuggestionProposal[] {
  const ordered = rows.filter((r) => r.tableId === table.id).sort((a, b) => a.rowIndex - b.rowIndex);
  const out: SuggestionProposal[] = [];
  let heading: Citation | null = null;

  for (const r of ordered) {
    if (HEADINGS.has(r.rowClass)) {
      heading = descriptionCell(table, r.rowIndex);
      continue;
    }
    if (!ITEMS.has(r.rowClass)) continue;
    const own = descriptionCell(table, r.rowIndex);
    if (!own) continue;

    let found = matches(own.quote!);
    let citations: Citation[] = [own];
    let source = `its description contains`;
    let confidence = 0.5;
    if (found.length === 0 && heading) {
      found = matches(heading.quote!);
      citations = [own, heading];
      source = `the heading above it ("${heading.quote}") contains`;
      confidence = 0.4;
    }
    if (found.length === 0) continue;

    const [main, ...others] = found;
    const value = (trade: string): ClassificationSuggestionDecision => ({ tableId: table.id, rowIndex: r.rowIndex, field: 'tradeWork', label: trade });
    out.push({
      value: value(main!.trade),
      confidence: others.length ? confidence - 0.1 : confidence,
      reasoning: `Suggested Trade: ${source} "${main!.keyword}". The original description is not changed.`,
      citations,
      alternatives: others.map((o) => ({ value: value(o.trade), confidence: 0.3, reasoning: `Also contains "${o.keyword}".` })),
    });
    // A sub-trade only from the item's own words — never inherited from a heading.
    if (main!.subTrade && others.length === 0 && citations.length === 1) {
      out.push({
        value: { tableId: table.id, rowIndex: r.rowIndex, field: 'subTrade', label: main!.subTrade },
        confidence: confidence - 0.1,
        reasoning: `Suggested Sub-trade: ${source} "${main!.keyword}".`,
        citations,
        alternatives: [],
      });
    }
  }
  return out;
}
