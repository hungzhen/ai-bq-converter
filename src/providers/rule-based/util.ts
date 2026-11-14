/**
 * Small helpers shared by the rule-based provider: finding cells, citing them with their exact
 * text, and building answers in the provider contract's shape.
 */
import { type CellRef, type ExtractedCell, type ExtractedRow, type ExtractedTable, cellText } from '../../core/models/index.ts';
import type { AlternativeInterpretation, DecisionKind, DecisionTypes, DocumentContext, Interpretation, ProviderInfo } from '../types.ts';
import { providerStamp } from '../types.ts';

export const isBlankCell = (c: ExtractedCell): boolean => c.raw === null || (typeof c.raw === 'string' && c.raw.trim() === '');
export const nonBlankCells = (row: ExtractedRow): ExtractedCell[] => row.cells.filter((c) => !isBlankCell(c));
export const isBlankRow = (row: ExtractedRow): boolean => nonBlankCells(row).length === 0;
export const documentTables = (ctx: DocumentContext): ExtractedTable[] => ctx.tables.filter((t) => t.documentId === ctx.document.id);

/** Text cells are strings that are not just numbers; used for headings and descriptions. */
export const textValue = (c: ExtractedCell): string | null => (typeof c.raw === 'string' && c.raw.trim() !== '' ? c.raw : null);

export interface Citation {
  readonly ref: CellRef;
  /** Exact text of the cell (null for a whole-row citation). */
  readonly quote: string | null;
}

export const citeCell = (table: ExtractedTable, rowIndex: number, cell: ExtractedCell): Citation => ({
  ref: { tableId: table.id, rowIndex, columnIndex: cell.columnIndex },
  quote: cellText(cell),
});

export const citeRow = (table: ExtractedTable, rowIndex: number): Citation => ({ ref: { tableId: table.id, rowIndex }, quote: null });

/** Removes repeated citations, keeping the first. */
export function uniqueCitations(citations: readonly Citation[]): Citation[] {
  const seen = new Set<string>();
  return citations.filter((c) => {
    const key = `${c.ref.tableId}|${c.ref.rowIndex}|${c.ref.columnIndex ?? '*'}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Builds one answer. Cell citations carry their exact quoted text; whole-row citations (used only
 * for rows with no content) cannot be quoted, so an answer is either all-cells (quoted) or rows only.
 */
export function makeAnswer<K extends DecisionKind>(
  info: ProviderInfo,
  decisionKind: K,
  value: DecisionTypes[K],
  citations: readonly Citation[],
  reasoning: string,
  confidence: number,
  alternatives: readonly AlternativeInterpretation<K>[] = [],
): Interpretation<K> {
  const cited = uniqueCitations(citations);
  const quoted = cited.every((c) => c.quote !== null);
  return {
    decisionKind,
    value,
    confidence: Math.round(confidence * 100) / 100,
    evidence: cited.map((c) => c.ref),
    ...(quoted && cited.length > 0 ? { quotedText: cited.map((c) => c.quote!) } : {}),
    reasoning,
    ...(alternatives.length > 0 ? { alternatives } : {}),
    method: 'rule-based',
    providerId: providerStamp(info),
    status: 'proposed',
  };
}
