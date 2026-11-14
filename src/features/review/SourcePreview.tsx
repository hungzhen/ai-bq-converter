/**
 * SOURCE PREVIEW — the complete extracted content of every worksheet, exactly as extracted:
 * every row in its original position (blank rows included), Excel row numbers and column letters,
 * hidden rows / columns / sheets marked. Hover a cell for its stored value, shown text, type,
 * number format and formula.
 *
 * The proposed row type is shown in a separate, dashed column on the right so that source data
 * and proposed interpretation are never mixed. Cells cited by the selected proposal are highlighted.
 */
import { useEffect, useMemo, useState } from 'react';
import { type ExtractedCell, type ExtractedTable, columnLetter } from '../../core/models/index.ts';
import type { WorksheetInfo } from '../../core/extraction/index.ts';
import { ROW_CLASS_LABEL, tableName } from './labels.ts';
import type { BqRowClass } from '../../core/models/index.ts';

export const cellKey = (tableId: string, rowIndex: number, columnIndex?: number) => `${tableId}|${rowIndex}|${columnIndex ?? '*'}`;

/** How many rows are drawn at a time (more can be shown on request). */
export const ROWS_PER_PAGE = 300;

export interface SourcePreviewProps {
  readonly tables: readonly ExtractedTable[];
  readonly sheets: readonly WorksheetInfo[];
  readonly activeTableId: string;
  readonly onSelectTable: (tableId: string) => void;
  /** Keys of highlighted cells / rows (cellKey). */
  readonly highlighted: ReadonlySet<string>;
  /** A cell to scroll into view (changes when a citation is clicked). */
  readonly focus: { tableId: string; rowIndex: number; columnIndex?: number; nonce: number } | null;
  /** Proposed row type per row of the active table (shown apart from the source). */
  readonly proposedRowTypes: ReadonlyMap<number, { rowClass: BqRowClass; state: string }>;
}

function shownText(cell: ExtractedCell): string {
  if (cell.formulaResultMissing) return '';
  if (cell.displayText !== null && cell.displayText !== undefined) return cell.displayText;
  return cell.raw === null ? '' : String(cell.raw);
}

function cellTooltip(cell: ExtractedCell): string {
  const ref = cell.source.kind !== 'pdf' ? cell.source.cellAddress ?? '' : '';
  const parts = [ref, `stored: ${cell.raw === null ? '(empty)' : JSON.stringify(cell.raw)}${cell.cellType ? ` (${cell.cellType})` : ''}`];
  if (cell.displayText !== null && cell.displayText !== undefined && cell.displayText !== String(cell.raw)) parts.push(`shown: ${cell.displayText}`);
  if (cell.numberFormat && cell.numberFormat !== 'General') parts.push(`format: ${cell.numberFormat}`);
  if (cell.formula) parts.push(`formula: =${cell.formula}${cell.formulaResultMissing ? ' (no cached result in the file)' : ''}`);
  if (cell.mergedRange) parts.push(`merged ${cell.mergedRange}${cell.isMergeOrigin ? '' : ' (covered)'}`);
  if (cell.isHidden) parts.push('hidden column');
  return parts.join(' · ');
}

export function SourcePreview({ tables, sheets, activeTableId, onSelectTable, highlighted, focus, proposedRowTypes }: SourcePreviewProps) {
  const table = tables.find((t) => t.id === activeTableId);
  const [limit, setLimit] = useState(ROWS_PER_PAGE);
  useEffect(() => setLimit(ROWS_PER_PAGE), [activeTableId]);

  // Make sure a focused row is drawn, then scroll to it.
  useEffect(() => {
    if (!focus || focus.tableId !== activeTableId) return;
    if (focus.rowIndex >= limit) setLimit(Math.ceil((focus.rowIndex + 1) / ROWS_PER_PAGE) * ROWS_PER_PAGE);
    const id = `cell-${focus.tableId}-${focus.rowIndex}-${focus.columnIndex ?? 'row'}`;
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView?.({ block: 'center', inline: 'nearest' }));
  }, [focus, activeTableId, limit]);

  const columnCount = useMemo(() => (table ? Math.max(0, ...table.rows.flatMap((r) => r.cells.map((c) => c.columnIndex + 1))) : 0), [table]);
  const sheetInfo = (t: ExtractedTable) => (t.origin.kind === 'worksheet' ? sheets.find((s) => s.index === (t.origin as { sheetIndex: number }).sheetIndex) : undefined);
  const hiddenColumns = new Set(table && sheetInfo(table)?.hiddenColumns);

  return (
    <section aria-label="Extracted source" className="flex min-h-0 flex-col overflow-hidden">
      <div role="tablist" aria-label="Worksheets" className="flex flex-wrap gap-1 border-b border-slate-300 pb-1">
        {tables.map((t) => {
          const info = sheetInfo(t);
          const visibility = t.origin.kind === 'worksheet' ? t.origin.visibility : 'visible';
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={t.id === activeTableId}
              onClick={() => onSelectTable(t.id)}
              className={`rounded-t px-2 py-1 text-xs ${t.id === activeTableId ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
            >
              {tableName(t)}
              {visibility !== 'visible' && <span className="ml-1 rounded bg-amber-200 px-1 text-[10px] text-amber-900">{visibility === 'hidden' ? 'hidden' : 'very hidden'}</span>}
              {info?.status === 'empty' && <span className="ml-1 text-[10px] opacity-70">(empty)</span>}
            </button>
          );
        })}
      </div>

      {table && (
        <div className="mt-1 text-xs text-slate-600" data-testid="sheet-summary">
          {tableName(table)} — {table.rows.length} row(s) × {columnCount} column(s)
          {table.origin.kind === 'worksheet' && table.origin.visibility !== 'visible' ? ` · ${table.origin.visibility.replace('_', ' ')} worksheet` : ''}
          {hiddenColumns.size ? ` · hidden column(s): ${[...hiddenColumns].join(', ')}` : ''}
          {table.merges?.length ? ` · merged: ${table.merges.map((m) => m.range).join(', ')}` : ''}
        </div>
      )}

      <div className="mt-1 min-h-0 flex-1 overflow-auto rounded border border-slate-300 bg-white">
        {table && table.rows.length === 0 && <p className="p-4 text-sm text-slate-500">This worksheet is empty.</p>}
        {table && table.rows.length > 0 && (
          <table className="border-collapse text-xs" data-testid="source-grid">
            <thead className="sticky top-0 z-10 bg-slate-100">
              <tr>
                <th className="sticky left-0 z-20 border border-slate-300 bg-slate-100 px-1 text-slate-500">#</th>
                {Array.from({ length: columnCount }, (_, c) => (
                  <th key={c} className={`border border-slate-300 px-2 font-medium ${hiddenColumns.has(columnLetter(c + 1)) ? 'bg-slate-300 text-slate-500' : 'text-slate-600'}`}>
                    {columnLetter(c + 1)}
                    {hiddenColumns.has(columnLetter(c + 1)) ? ' (hidden)' : ''}
                  </th>
                ))}
                <th className="sticky right-0 z-20 min-w-[11rem] whitespace-nowrap border border-dashed border-sky-400 bg-sky-50 px-2 font-medium text-sky-800">Proposed row type</th>
              </tr>
            </thead>
            <tbody>
              {table.rows.slice(0, limit).map((row) => {
                const rowHighlighted = highlighted.has(cellKey(table.id, row.rowIndex));
                const proposed = proposedRowTypes.get(row.rowIndex);
                return (
                  <tr key={row.rowIndex} id={`cell-${table.id}-${row.rowIndex}-row`} className={row.isHidden ? 'bg-slate-100 text-slate-500' : ''} data-row={row.rowIndex + 1}>
                    <td className={`sticky left-0 z-[5] border border-slate-300 px-1 text-right text-slate-500 ${rowHighlighted ? 'bg-yellow-200' : 'bg-slate-50'}`}>
                      {row.rowIndex + 1}
                      {row.isHidden ? ' (hidden)' : ''}
                    </td>
                    {Array.from({ length: columnCount }, (_, c) => {
                      const cell = row.cells.find((x) => x.columnIndex === c);
                      const key = cellKey(table.id, row.rowIndex, c);
                      const isHighlighted = highlighted.has(key) || rowHighlighted;
                      return (
                        <td
                          key={c}
                          id={`cell-${table.id}-${row.rowIndex}-${c}`}
                          data-cell={`${columnLetter(c + 1)}${row.rowIndex + 1}`}
                          data-highlighted={isHighlighted ? 'true' : undefined}
                          title={cell ? cellTooltip(cell) : `${columnLetter(c + 1)}${row.rowIndex + 1} · not present in the file`}
                          className={`max-w-[15rem] truncate border border-slate-200 px-2 py-0.5 align-top ${typeof cell?.raw === 'number' ? 'text-right tabular-nums' : ''} ${isHighlighted ? 'bg-yellow-200 outline outline-2 outline-amber-500' : ''} ${cell?.formulaResultMissing ? 'bg-red-50' : ''} ${cell?.isMerged && !cell.isMergeOrigin ? 'text-slate-400' : ''}`}
                        >
                          {cell ? shownText(cell) : ''}
                          {cell?.formulaResultMissing && <span className="text-red-700">formula, no result</span>}
                        </td>
                      );
                    })}
                    <td className="sticky right-0 z-[5] min-w-[11rem] whitespace-nowrap border border-dashed border-sky-300 bg-sky-50 px-2 text-sky-800">
                      {proposed ? `${ROW_CLASS_LABEL[proposed.rowClass]}${proposed.state === 'approved' ? ' ✓' : proposed.state === 'rejected' ? ' ✗' : ' ?'}` : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {table && table.rows.length > limit && (
          <button type="button" onClick={() => setLimit(limit + ROWS_PER_PAGE)} className="m-2 rounded border px-2 py-1 text-xs">
            Show the next {Math.min(ROWS_PER_PAGE, table.rows.length - limit)} of {table.rows.length - limit} remaining rows
          </button>
        )}
      </div>
    </section>
  );
}
