/** Runs the rule-based provider over a loaded synthetic layout. SYNTHETIC — NOT REAL COST DATA. */
import type { ExtractedTable } from '../../src/core/models/index.ts';
import { createRuleBasedProvider } from '../../src/providers/rule-based/index.ts';
import type { Interpretation } from '../../src/providers/types.ts';
import type { Loaded } from './synthetic/bqLayouts.ts';

export async function runAll(loaded: Loaded) {
  const provider = createRuleBasedProvider();
  const ctx = loaded.ctx;
  const documentType = await provider.classifyDocument(ctx);
  const regions = await provider.detectTableRegions(ctx);
  const columns = await provider.mapColumns(ctx, regions.map((r) => r.value));
  const rows = await provider.classifyRows(ctx, columns.map((c) => c.value), regions.map((r) => r.value));
  const hierarchy = await provider.interpretHierarchy(ctx, rows.map((r) => r.value));
  const suggestions = await provider.suggestClassifications(ctx, rows.map((r) => r.value));
  const all: Interpretation[] = [...documentType, ...regions, ...columns, ...rows, ...hierarchy, ...suggestions];
  return { provider, documentType, regions, columns, rows, hierarchy, suggestions, all };
}

/** The table of a worksheet, by name. */
export const tableNamed = (loaded: Loaded, name: string): ExtractedTable =>
  loaded.extraction.tables.find((t) => t.origin.kind === 'worksheet' && t.origin.sheetName === name)!;

/** Row-class proposals of one table, keyed by Excel row number. */
export function rowClassesByExcelRow(rows: readonly Interpretation<'rowClass'>[], tableId: string): Record<number, string> {
  return Object.fromEntries(rows.filter((r) => r.value.tableId === tableId).map((r) => [r.value.rowIndex + 1, r.value.rowClass]));
}

/** Column-role proposals of one table, keyed by column letter. */
export function rolesByColumn(columns: readonly Interpretation<'columnRole'>[], tableId: string): Record<string, string> {
  return Object.fromEntries(columns.filter((c) => c.value.tableId === tableId).map((c) => [String.fromCharCode(65 + c.value.columnIndex), c.value.role]));
}
