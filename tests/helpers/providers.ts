/**
 * TEST-ONLY providers. SYNTHETIC — NOT REAL COST DATA.
 *
 * SyntheticRuleProvider: a tiny, honest rule-based provider used to exercise the provider
 *   interface and the shared contract tests. It is NOT the real RuleBasedProvider (Stage 2G).
 * MisbehavingProvider: returns the kinds of answers the verifier must reject (as a future
 *   AI provider might): invented figures, fake quotes, missing citations, claimed approval…
 */
import { cellText, findCell, type ExtractedTable } from '../../src/core/models/index.ts';
import {
  type ColumnRole,
  type DocumentContext,
  type Interpretation,
  type InterpretationProvider,
  type ProviderInfo,
  RULE_BASED_LABEL,
  providerStamp,
} from '../../src/providers/types.ts';

const HEADER_ROLES: Record<string, ColumnRole> = {
  'no.': 'itemNo', description: 'description', unit: 'unit', qty: 'quantity', rate: 'rate', amount: 'amount',
};

export const SYNTHETIC_RULE_INFO: ProviderInfo = {
  id: 'synthetic-test-rules',
  version: '0.0.1',
  kind: 'rule-based',
  displayLabel: RULE_BASED_LABEL,
  capabilities: ['classifyDocument', 'detectTableRegions', 'mapColumns', 'classifyRows'],
  requiresNetwork: false,
};

const firstTable = (ctx: DocumentContext): ExtractedTable => ctx.tables.find((t) => t.documentId === ctx.document.id)!;

export function syntheticRuleProvider(): InterpretationProvider {
  const info = SYNTHETIC_RULE_INFO;
  const base = { method: 'rule-based' as const, providerId: providerStamp(info), status: 'proposed' as const };
  return {
    info,
    async classifyDocument(ctx) {
      const t = firstTable(ctx);
      return [{ ...base, decisionKind: 'documentType', value: { documentType: 'standard_bq' }, confidence: 0.6, evidence: [{ tableId: t.id, rowIndex: 0, columnIndex: 3 }], quotedText: ['Qty'], reasoning: 'Header "Qty" found (synthetic test rule).' }];
    },
    async detectTableRegions(ctx) {
      const t = firstTable(ctx);
      const last = t.rows[t.rows.length - 1]!.rowIndex;
      return [{ ...base, decisionKind: 'tableRegion', value: { tableId: t.id, headerRowIndexes: [0], firstDataRowIndex: 1, lastDataRowIndex: last, include: true }, confidence: 0.9, evidence: [{ tableId: t.id, rowIndex: 0 }], reasoning: 'First row holds header words.' }];
    },
    async mapColumns(ctx) {
      const t = firstTable(ctx);
      const header = t.rows[0]!;
      const out: Interpretation<'columnRole'>[] = [];
      for (const cell of header.cells) {
        const role = HEADER_ROLES[cellText(cell).trim().toLowerCase()];
        if (!role) continue;
        out.push({ ...base, decisionKind: 'columnRole', value: { tableId: t.id, columnIndex: cell.columnIndex, role }, confidence: 0.9, evidence: [{ tableId: t.id, rowIndex: 0, columnIndex: cell.columnIndex }], quotedText: [cellText(cell)], reasoning: `Header "${cellText(cell)}".` });
      }
      return out;
    },
    async classifyRows(ctx, columns) {
      const t = firstTable(ctx);
      const qtyCol = columns.find((c) => c.role === 'quantity')?.columnIndex;
      return t.rows.slice(1).map((row) => {
        const hasQtyCell = qtyCol !== undefined && findCell(row, qtyCol)?.raw !== null && findCell(row, qtyCol) !== undefined;
        const rowClass = hasQtyCell ? ('priced_item' as const) : ('main_heading' as const);
        return { ...base, decisionKind: 'rowClass' as const, value: { tableId: t.id, rowIndex: row.rowIndex, rowClass }, confidence: 0.7, evidence: [{ tableId: t.id, rowIndex: row.rowIndex }], reasoning: hasQtyCell ? 'Qty cell filled.' : 'No figures.' };
      });
    },
    async interpretHierarchy() { return []; },
    async suggestClassifications() { return []; },
    async relateDocuments() { return []; },
    async matchClaimLines() { return []; },
  };
}

/** Answers a careless or overreaching interpreter might give. Every one must be rejected. */
export function misbehavingAnswers(tableId: string): Record<string, unknown> {
  const base = { method: 'ai', providerId: 'imaginary-ai@1', status: 'proposed', confidence: 0.9, reasoning: 'Looks right.' };
  return {
    claimsApproval: { ...base, status: 'approved', decisionKind: 'rowClass', value: { tableId, rowIndex: 2, rowClass: 'priced_item' }, evidence: [{ tableId, rowIndex: 2 }] },
    noEvidence: { ...base, decisionKind: 'rowClass', value: { tableId, rowIndex: 2, rowClass: 'priced_item' }, evidence: [] },
    inventsQuantity: { ...base, decisionKind: 'rowClass', value: { tableId, rowIndex: 3, rowClass: 'priced_item', quantity: 1 }, evidence: [{ tableId, rowIndex: 3 }] },
    inventsRateAndAmount: { ...base, decisionKind: 'columnRole', value: { tableId, columnIndex: 4, role: 'rate', rate: 2, amount: 20 }, evidence: [{ tableId, rowIndex: 0, columnIndex: 4 }] },
    inventsUnitAndDescription: { ...base, decisionKind: 'hierarchy', value: { tableId, rowIndex: 2, level: 'item', parentRowIndex: 1, unit: 'm2', description: 'Better wording' }, evidence: [{ tableId, rowIndex: 2 }] },
    fakeQuote: { ...base, decisionKind: 'columnRole', value: { tableId, columnIndex: 3, role: 'quantity' }, evidence: [{ tableId, rowIndex: 0, columnIndex: 3 }], quotedText: ['Quantity (m2)'] },
    citesMissingCell: { ...base, decisionKind: 'columnRole', value: { tableId, columnIndex: 3, role: 'quantity' }, evidence: [{ tableId, rowIndex: 99, columnIndex: 3 }] },
    citesMissingTable: { ...base, decisionKind: 'documentType', value: { documentType: 'standard_bq' }, evidence: [{ tableId: 'no-such-table', rowIndex: 0 }] },
    labelIsAFigure: { ...base, decisionKind: 'classificationSuggestion', value: { tableId, rowIndex: 2, field: 'costItem', label: 'RM 1,250.00' }, evidence: [{ tableId, rowIndex: 2 }] },
    extraTopLevelField: { ...base, decisionKind: 'documentType', value: { documentType: 'standard_bq' }, evidence: [{ tableId, rowIndex: 0 }], correctedValues: { quantity: 1 } },
  };
}
