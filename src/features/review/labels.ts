/**
 * Plain-English names for everything shown on screen, and short titles for proposals.
 * Interface text only — no logic.
 */
import type { Proposal, ReviewState } from '../../core/evidence/index.ts';
import { columnLetter, type BqRowClass, type ExtractedTable, type SourceDocumentType } from '../../core/models/index.ts';
import type { ColumnRole, DecisionKind, HierarchyLevel } from '../../providers/types.ts';
import { UNIFIED_TRADE_PACKAGES } from '../../vendor/cost-library/taxonomy.ts';

export const KIND_LABEL: Record<DecisionKind, string> = {
  documentType: 'Document type',
  tableRegion: 'Table region',
  columnRole: 'Column meaning',
  rowClass: 'Row type',
  hierarchy: 'Hierarchy',
  classificationSuggestion: 'Trade suggestion',
  relationship: 'Document relationship',
  claimMatch: 'Claim match',
};

export const DOCUMENT_TYPE_LABEL: Record<SourceDocumentType, string> = {
  standard_bq: 'Standard BQ',
  contractor_working_file: 'Contractor working file',
  progress_claim: 'Progress claim',
  summary_only: 'Summary only',
  unknown: 'Unknown / cannot determine',
};

export const COLUMN_ROLE_LABEL: Record<ColumnRole, string> = {
  itemNo: 'Item number', description: 'Description', unit: 'Unit', quantity: 'Quantity', rate: 'Rate', amount: 'Amount',
  baseRate: 'Cost / base rate', baseAmount: 'Cost / base amount', tenderRate: 'Selling / tender rate', tenderAmount: 'Selling / tender amount',
  profitPercent: 'Markup / profit %', rateAfterDiscount: 'Rate after discount',
  billNo: 'Bill number', billTitle: 'Bill title', section: 'Section', element: 'Element',
  mainHeading: 'Main heading', subheading: 'Subheading', secondarySubheading: 'Secondary subheading',
  trade: 'Trade', costItem: 'Cost item', remarks: 'Remarks',
  additionalQuantity: 'Alternative / additional quantity', additionalAmount: 'Alternative / additional amount',
  claimPreviousQuantity: 'Previous quantity', claimCurrentQuantity: 'Current quantity', claimCumulativeQuantity: 'Cumulative quantity',
  claimPreviousAmount: 'Previous amount', claimCurrentAmount: 'Current amount', claimCumulativeAmount: 'Cumulative amount',
  claimPercentComplete: 'Percentage complete', certifiedAmount: 'Certified amount',
  percentage: 'Percentage', other: 'Other (no BQ field)', unknown: 'Unknown', ignore: 'Ignore',
};

export const ROW_CLASS_LABEL: Record<BqRowClass, string> = {
  title: 'Title / preamble', column_header: 'Column headings', bill_heading: 'Bill heading', section_heading: 'Section heading',
  main_heading: 'Main heading', subheading: 'Subheading', secondary_subheading: 'Secondary subheading',
  priced_item: 'Priced item', description_only_item: 'Description-only item', provisional_sum: 'Provisional Sum',
  prime_cost_sum: 'Prime Cost Sum', percentage_item: 'Percentage item', continuation: 'Continuation',
  note: 'Note / specification text', note_label: 'Note label', subtotal: 'Sub-total', total: 'Total',
  brought_forward: 'Brought forward', carried_forward: 'Carried forward / to collection', collection: 'Collection',
  summary: 'Summary', reference: 'Page / continuation marker', blank: 'Blank / spacer', unknown: 'Unknown', ignore: 'Ignore',
};

export const LEVEL_LABEL: Record<HierarchyLevel, string> = {
  bill: 'Bill', section: 'Section', main_heading: 'Main heading', subheading: 'Subheading',
  secondary_subheading: 'Secondary subheading', item: 'Item', continuation: 'Continuation',
};

export const STATE_LABEL: Record<ReviewState, string> = {
  verified: 'Verified — awaiting review',
  failed_verification: 'Failed verification',
  approved: 'Approved',
  rejected: 'Rejected',
};

export const tradeLabel = (id: string) => UNIFIED_TRADE_PACKAGES.find((t) => t.id === id)?.label ?? id;

export function tableName(table: ExtractedTable | undefined): string {
  if (!table) return '(unknown table)';
  return table.origin.kind === 'worksheet' ? table.origin.sheetName : table.origin.kind === 'csv' ? 'CSV' : `Page ${table.origin.pageNumber}`;
}

/** "Bill 2!D6", or "Bill 2 row 6" for a whole row. */
export function cellLabel(table: ExtractedTable | undefined, rowIndex: number, columnIndex?: number): string {
  const name = tableName(table);
  return columnIndex === undefined ? `${name} row ${rowIndex + 1}` : `${name}!${columnLetter(columnIndex + 1)}${rowIndex + 1}`;
}

/** The value of a decision in words (for the main answer, an alternative or a correction). */
export function describeValue(kind: DecisionKind, value: unknown, tables: readonly ExtractedTable[]): string {
  const v = value as Record<string, unknown>;
  const table = tables.find((t) => t.id === v['tableId']);
  switch (kind) {
    case 'documentType':
      return DOCUMENT_TYPE_LABEL[v['documentType'] as SourceDocumentType] ?? String(v['documentType']);
    case 'tableRegion': {
      const headers = (v['headerRowIndexes'] as number[]).map((i) => i + 1);
      const repeated = (v['repeatedHeaderRowIndexes'] as number[]).map((i) => i + 1);
      if (!v['include']) return `${tableName(table)}: not part of the BQ table (no column headings found)`;
      return `${tableName(table)}: headings row ${headers.join(' & ')}${repeated.length ? `, repeated at row ${repeated.join(', ')}` : ''}; data rows ${(v['firstDataRowIndex'] as number) + 1}–${(v['lastDataRowIndex'] as number) + 1}`;
    }
    case 'columnRole':
      return `${tableName(table)} column ${columnLetter((v['columnIndex'] as number) + 1)} → ${COLUMN_ROLE_LABEL[v['role'] as ColumnRole] ?? String(v['role'])}`;
    case 'rowClass':
      return `${tableName(table)} row ${(v['rowIndex'] as number) + 1} → ${ROW_CLASS_LABEL[v['rowClass'] as BqRowClass] ?? String(v['rowClass'])}`;
    case 'hierarchy': {
      const parent = v['parentRowIndex'];
      return `${tableName(table)} row ${(v['rowIndex'] as number) + 1} → ${LEVEL_LABEL[v['level'] as HierarchyLevel]}${parent === null ? ' (top level)' : ` under row ${(parent as number) + 1}`}`;
    }
    case 'classificationSuggestion':
      return `${tableName(table)} row ${(v['rowIndex'] as number) + 1} → ${v['field'] === 'tradeWork' ? 'Trade' : v['field'] === 'subTrade' ? 'Sub-trade' : String(v['field'])}: ${v['field'] === 'tradeWork' ? tradeLabel(String(v['label'])) : String(v['label'])}`;
    default:
      return JSON.stringify(value);
  }
}

export const proposalTitle = (p: Proposal, tables: readonly ExtractedTable[]) => describeValue(p.interpretation.decisionKind, p.interpretation.value, tables);

export const percent = (n: number) => `${Math.round(n * 100)}%`;
