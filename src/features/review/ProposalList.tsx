/**
 * PROPOSAL LIST — the provider's proposals by kind (Document, Tables, Columns, Rows, Hierarchy,
 * Trades), with each one's review state, confidence and any alternatives or problems.
 * Filters: all / unresolved / needs attention; optionally only the worksheet being viewed.
 */
import { useState } from 'react';
import { type Proposal, reviewState } from '../../core/evidence/index.ts';
import type { ExtractedTable } from '../../core/models/index.ts';
import type { DecisionKind } from '../../providers/types.ts';
import { STATE_LABEL, percent, proposalTitle } from './labels.ts';

export const CATEGORIES: readonly { id: string; label: string; kinds: readonly DecisionKind[] }[] = [
  { id: 'document', label: 'Document', kinds: ['documentType'] },
  { id: 'tables', label: 'Tables', kinds: ['tableRegion'] },
  { id: 'columns', label: 'Columns', kinds: ['columnRole'] },
  { id: 'rows', label: 'Rows', kinds: ['rowClass'] },
  { id: 'hierarchy', label: 'Hierarchy', kinds: ['hierarchy'] },
  { id: 'trades', label: 'Trades', kinds: ['classificationSuggestion'] },
];

export type Filter = 'all' | 'unresolved' | 'attention';

const stateStyle: Record<string, string> = {
  verified: 'bg-sky-100 text-sky-900',
  failed_verification: 'bg-red-100 text-red-900',
  approved: 'bg-green-100 text-green-900',
  rejected: 'bg-slate-200 text-slate-700',
};

export const needsAttention = (p: Proposal) =>
  !p.verification.ok || p.verification.findings.some((f) => f.severity === 'warning') || (p.interpretation.alternatives?.length ?? 0) > 0;

export function StateChip({ p }: { p: Proposal }) {
  const s = reviewState(p);
  return <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium ${stateStyle[s]}`}>{STATE_LABEL[s]}</span>;
}

export interface ProposalListProps {
  readonly proposals: readonly Proposal[];
  readonly tables: readonly ExtractedTable[];
  readonly activeTableId: string;
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
}

export function ProposalList({ proposals, tables, activeTableId, selectedId, onSelect }: ProposalListProps) {
  const [category, setCategory] = useState('document');
  const [filter, setFilter] = useState<Filter>('all');
  const [thisSheetOnly, setThisSheetOnly] = useState(true);
  const cat = CATEGORIES.find((c) => c.id === category)!;

  const inCategory = proposals.filter((p) => cat.kinds.includes(p.interpretation.decisionKind));
  const shown = inCategory.filter((p) => {
    const tableId = (p.interpretation.value as { tableId?: string }).tableId;
    if (thisSheetOnly && tableId !== undefined && tableId !== activeTableId) return false;
    if (filter === 'unresolved') return p.status === 'proposed';
    if (filter === 'attention') return p.status === 'proposed' && needsAttention(p);
    return true;
  });

  return (
    <section aria-label="Proposals" className="flex min-h-0 flex-col">
      <div role="tablist" aria-label="Proposal kinds" className="flex flex-wrap gap-1">
        {CATEGORIES.map((c) => {
          const n = proposals.filter((p) => c.kinds.includes(p.interpretation.decisionKind));
          const open = n.filter((p) => p.status === 'proposed').length;
          return (
            <button key={c.id} role="tab" aria-selected={c.id === category} onClick={() => setCategory(c.id)} className={`rounded px-2 py-1 text-xs ${c.id === category ? 'bg-slate-800 text-white' : 'bg-slate-100 hover:bg-slate-200'}`}>
              {c.label} <span className="opacity-70">({open}/{n.length} open)</span>
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
        <label>
          Show{' '}
          <select aria-label="Filter proposals" value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className="rounded border px-1">
            <option value="all">All</option>
            <option value="unresolved">Unresolved only</option>
            <option value="attention">Needing attention</option>
          </select>
        </label>
        {cat.id !== 'document' && (
          <label>
            <input type="checkbox" checked={thisSheetOnly} onChange={(e) => setThisSheetOnly(e.target.checked)} /> Only the worksheet shown
          </label>
        )}
      </div>
      <ul className="mt-2 min-h-0 flex-1 divide-y overflow-auto rounded border border-slate-300 bg-white" data-testid="proposal-list">
        {shown.length === 0 && <li className="p-3 text-xs text-slate-500">No proposals match.</li>}
        {shown.map((p) => {
          const warnings = p.verification.findings.filter((f) => f.severity === 'warning').length;
          const blocking = p.verification.findings.filter((f) => f.severity === 'blocking').length;
          const alternatives = p.interpretation.alternatives?.length ?? 0;
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onSelect(p.id)}
                aria-current={p.id === selectedId}
                data-proposal-id={p.id}
                className={`w-full px-3 py-2 text-left text-xs hover:bg-slate-50 ${p.id === selectedId ? 'bg-sky-50 ring-1 ring-inset ring-sky-400' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium">{proposalTitle(p, tables)}</span>
                  <StateChip p={p} />
                </div>
                <div className="mt-0.5 text-slate-500">
                  Confidence {percent(p.interpretation.confidence)} · {p.interpretation.evidence.length} cited cell(s)
                  {alternatives ? ` · ${alternatives} alternative(s)` : ''}
                  {warnings ? <span className="text-amber-700"> · {warnings} warning(s)</span> : null}
                  {blocking ? <span className="text-red-700"> · {blocking} blocking</span> : null}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
