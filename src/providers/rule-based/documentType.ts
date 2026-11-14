/**
 * DOCUMENT TYPE — standard BQ, contractor working file, progress claim, or UNKNOWN.
 *
 * Looks for signal words in short cells (headings and labels) of every worksheet:
 *   claim:        previous, this claim, cumulative / to date, % complete, certified, valuation …
 *   working file: cost / net rate, selling rate, markup / profit, material, labour, plant, supplier …
 *   BQ:           description, unit, qty, rate, amount, bill no., collection, summary
 * A type is proposed only with at least two distinct signals (three for a plain BQ). Otherwise the
 * answer is UNKNOWN, citing the cells that were examined. Close calls carry alternatives.
 */
import type { ExtractedTable, SourceDocumentType } from '../../core/models/index.ts';
import type { AlternativeInterpretation, DocumentTypeDecision } from '../types.ts';
import { type Citation, citeCell, nonBlankCells, textValue } from './util.ts';
import { BQ_SIGNALS, CLAIM_SIGNALS, WORKING_SIGNALS, normaliseHeading } from './vocabulary.ts';

const MAX_SIGNAL_CELL = 40;
const SEARCH_ROWS = 40;

export interface DocumentTypeProposal {
  readonly value: DocumentTypeDecision;
  readonly confidence: number;
  readonly reasoning: string;
  readonly citations: readonly Citation[];
  readonly alternatives: AlternativeInterpretation<'documentType'>[];
}

interface Found {
  names: Set<string>;
  citations: Citation[];
}

export function proposeDocumentType(tables: readonly ExtractedTable[]): DocumentTypeProposal | null {
  const found = { claim: { names: new Set(), citations: [] } as Found, working: { names: new Set(), citations: [] } as Found, bq: { names: new Set(), citations: [] } as Found };
  const examined: Citation[] = [];

  for (const table of tables) {
    for (const row of table.rows.slice(0, SEARCH_ROWS)) {
      for (const cell of nonBlankCells(row)) {
        if (examined.length < 5) examined.push(citeCell(table, row.rowIndex, cell));
        const text = textValue(cell);
        if (!text || text.length > MAX_SIGNAL_CELL) continue;
        const norm = normaliseHeading(text);
        for (const [group, signals] of [['claim', CLAIM_SIGNALS], ['working', WORKING_SIGNALS], ['bq', BQ_SIGNALS]] as const) {
          for (const [name, re] of signals) {
            if (re.test(norm)) {
              found[group].names.add(name);
              if (found[group].citations.length < 6) found[group].citations.push(citeCell(table, row.rowIndex, cell));
            }
          }
        }
      }
    }
  }
  if (examined.length === 0) return null; // nothing in the document to cite

  const claim = found.claim.names.size;
  const working = found.working.names.size;
  const bq = found.bq.names.size;
  const list = (f: Found) => [...f.names].map((n) => `"${n}"`).join(', ');
  const value = (documentType: SourceDocumentType): DocumentTypeDecision => ({ documentType });
  const alt = (documentType: SourceDocumentType, f: Found, confidence: number): AlternativeInterpretation<'documentType'> => ({
    value: value(documentType), confidence, reasoning: `Also found ${list(f)}.`,
  });

  if (claim >= 2) {
    return {
      value: value('progress_claim'),
      confidence: Math.min(0.85, 0.5 + 0.1 * claim),
      reasoning: `Claim headings found: ${list(found.claim)}.`,
      citations: [...found.claim.citations, ...found.bq.citations.slice(0, 2)],
      alternatives: working >= 2 ? [alt('contractor_working_file', found.working, 0.3)] : [],
    };
  }
  if (working >= 2) {
    return {
      value: value('contractor_working_file'),
      confidence: Math.min(0.8, 0.45 + 0.1 * working),
      reasoning: `Contractor working-file headings found: ${list(found.working)}.`,
      citations: [...found.working.citations, ...found.bq.citations.slice(0, 2)],
      alternatives: bq >= 3 ? [{ value: value('standard_bq'), confidence: 0.3, reasoning: `It also has the columns of a BQ (${list(found.bq)}); a working file is often a priced copy of the BQ.` }] : [],
    };
  }
  if (bq >= 3) {
    const alternatives: AlternativeInterpretation<'documentType'>[] = [];
    if (working === 1) alternatives.push(alt('contractor_working_file', found.working, 0.2));
    if (claim === 1) alternatives.push(alt('progress_claim', found.claim, 0.2));
    return {
      value: value('standard_bq'),
      confidence: alternatives.length ? 0.55 : 0.7,
      reasoning: `BQ headings found: ${list(found.bq)}; no claim or working-file headings${alternatives.length ? ' apart from a single one' : ''}.`,
      citations: [...found.bq.citations, ...found.working.citations, ...found.claim.citations],
      alternatives,
    };
  }

  const partial: AlternativeInterpretation<'documentType'>[] = [];
  if (bq > 0) partial.push(alt('standard_bq', found.bq, 0.2));
  if (working > 0) partial.push(alt('contractor_working_file', found.working, 0.15));
  if (claim > 0) partial.push(alt('progress_claim', found.claim, 0.15));
  const signalCites = [...found.bq.citations, ...found.working.citations, ...found.claim.citations];
  return {
    value: value('unknown'),
    confidence: 0.2,
    reasoning: signalCites.length
      ? `Not enough evidence to decide (only ${[list(found.bq), list(found.working), list(found.claim)].filter(Boolean).join(', ')}). Left unknown.`
      : 'No BQ, working-file or claim headings were found. Left unknown.',
    citations: signalCites.length ? signalCites : examined,
    alternatives: partial,
  };
}
