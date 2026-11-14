/**
 * RULE-BASED PROVIDER — conventional, rule-based interpretation of extracted spreadsheet tables.
 * Labelled "Conventional rule-based processing". No AI, no network, no API key.
 *
 * It PROPOSES (never decides):
 *   - document type (standard BQ / contractor working file / progress claim / unknown);
 *   - table regions (heading rows, repeated headings, data range; sheets without headings);
 *   - column meanings (from heading text AND the content below; conflicts left unknown);
 *   - a row type for EVERY row (nothing is discarded);
 *   - the heading hierarchy (unclear parts left unresolved);
 *   - Trade / Sub-trade suggestions from keywords (Cost Library taxonomy as the reference).
 * Every answer cites the exact cells with their exact text, explains itself, gives a confidence,
 * and lists alternatives where the evidence is ambiguous. It supplies no figures, units or
 * descriptions, calculates nothing and changes nothing. Document relationships and claim-to-BQ
 * matching are not offered by this version.
 */
import type { TableRegionDecision, InterpretationProvider, ProviderInfo } from '../types.ts';
import { RULE_BASED_LABEL } from '../types.ts';
import { proposeColumns } from './columns.ts';
import { proposeDocumentType } from './documentType.ts';
import { proposeHierarchy } from './hierarchy.ts';
import { detectRegion } from './regions.ts';
import { proposeRows, rowAlternatives } from './rows.ts';
import { proposeSuggestions } from './trades.ts';
import { citeCell, documentTables, makeAnswer, nonBlankCells } from './util.ts';

export const RULE_BASED_INFO: ProviderInfo = Object.freeze({
  id: 'rule-based',
  version: '0.1.0',
  kind: 'rule-based',
  displayLabel: RULE_BASED_LABEL,
  capabilities: Object.freeze(['classifyDocument', 'detectTableRegions', 'mapColumns', 'classifyRows', 'interpretHierarchy', 'suggestClassifications'] as const),
  requiresNetwork: false,
}) as ProviderInfo;

export function createRuleBasedProvider(): InterpretationProvider {
  const info = RULE_BASED_INFO;

  const regionsFor = (tables: ReturnType<typeof documentTables>, given?: readonly TableRegionDecision[]) =>
    new Map(tables.map((t) => [t.id, given?.find((r) => r.tableId === t.id) ?? detectRegion(t)?.decision ?? null]));

  return {
    info,

    async classifyDocument(ctx) {
      const p = proposeDocumentType(documentTables(ctx));
      return p ? [makeAnswer(info, 'documentType', p.value, p.citations, p.reasoning, p.confidence, p.alternatives)] : [];
    },

    async detectTableRegions(ctx) {
      return documentTables(ctx).flatMap((table) => {
        const found = detectRegion(table);
        if (!found) return [];
        const d = found.decision;
        const rows = [...d.headerRowIndexes, ...d.repeatedHeaderRowIndexes];
        let citations = rows.flatMap((i) => nonBlankCells(table.rows.find((r) => r.rowIndex === i)!).map((c) => citeCell(table, i, c)));
        if (!d.include) {
          const first = table.rows.find((r) => r.rowIndex === d.firstDataRowIndex)!;
          citations = nonBlankCells(first).slice(0, 3).map((c) => citeCell(table, first.rowIndex, c));
        }
        const where = table.origin.kind === 'worksheet' ? `worksheet "${table.origin.sheetName}"${table.origin.visibility !== 'visible' ? ` (${table.origin.visibility.replace('_', ' ')})` : ''}` : 'the table';
        const reasoning = d.include
          ? `Column headings in ${where} at row(s) ${d.headerRowIndexes.map((i) => i + 1).join(' and ')} (${found.kinds.join(', ')})${found.hasGroupRow ? ', with a group heading row above' : ''}.` +
            (d.repeatedHeaderRowIndexes.length ? ` Repeated at row(s) ${d.repeatedHeaderRowIndexes.map((i) => i + 1).join(', ')}.` : '') +
            ` Data from row ${d.firstDataRowIndex + 1} to ${d.lastDataRowIndex + 1}; rows outside it are kept and classified.`
          : `No row of column headings found in ${where} (e.g. a cover, summary or notes sheet). Proposed as not part of the BQ table; its rows are still kept and classified.`;
        return [makeAnswer(info, 'tableRegion', d, citations, reasoning, d.include ? (found.hasGroupRow ? 0.7 : 0.8) : 0.4)];
      });
    },

    async mapColumns(ctx, regions) {
      const tables = documentTables(ctx);
      const regionMap = regionsFor(tables, regions.length ? regions : undefined);
      return tables.flatMap((table) => {
        const region = regionMap.get(table.id);
        if (!region) return [];
        return proposeColumns(table, region).map((p) => makeAnswer(info, 'columnRole', p.value, p.citations, p.reasoning, p.confidence, p.alternatives));
      });
    },

    async classifyRows(ctx, columns, regions) {
      const tables = documentTables(ctx);
      const regionMap = regionsFor(tables, regions);
      return tables.flatMap((table) => {
        const tableColumns = columns.filter((c) => c.tableId === table.id);
        return proposeRows(table, regionMap.get(table.id) ?? null, tableColumns).map((p) =>
          makeAnswer(info, 'rowClass', { tableId: table.id, rowIndex: p.rowIndex, rowClass: p.rowClass }, p.citations, p.reasoning, p.confidence, rowAlternatives(table, p)),
        );
      });
    },

    async interpretHierarchy(ctx, rows) {
      return documentTables(ctx).flatMap((table) =>
        proposeHierarchy(table, rows).map((p) => makeAnswer(info, 'hierarchy', p.value, p.citations, p.reasoning, p.confidence)),
      );
    },

    async suggestClassifications(ctx, rows) {
      return documentTables(ctx).flatMap((table) =>
        proposeSuggestions(table, rows).map((p) => makeAnswer(info, 'classificationSuggestion', p.value, p.citations, p.reasoning, p.confidence, p.alternatives)),
      );
    },

    async relateDocuments() {
      return [];
    },

    async matchClaimLines() {
      return [];
    },
  };
}
