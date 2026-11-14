/**
 * REVIEW WORKSPACE — after a successful pipeline run.
 *
 * Left: the complete extracted source (all worksheets). Right: the proposals and the evidence /
 * decision panel. Above: the pipeline stages, a count of review states (so unresolved items stay
 * visible), the extraction issues, and the restricted bulk approval.
 *
 * Every decision is recorded in the saved review (with history) and saved in this browser straight
 * away. The extracted source is never changed.
 */
import { useMemo, useState } from 'react';
import { type Proposal, bulkApprove, bulkIneligibility, reopenProposal, reviewState } from '../../core/evidence/index.ts';
import { NO_PROJECT_DETAILS, type SavedReview, historyOf, recordChanges, setProjectDetails } from '../../core/review/index.ts';
import { buildDrafts, verifyDrafts } from '../../core/staging/index.ts';
import { DraftRows } from '../drafts/DraftRows.tsx';
import type { PipelineSuccess } from '../../core/pipeline/runPipeline.ts';
import { STAGES } from '../../core/pipeline/runPipeline.ts';
import type { BqRowClass, ExtractedTable } from '../../core/models/index.ts';
import type { ProviderInfo } from '../../providers/types.ts';
import { EvidencePanel } from './EvidencePanel.tsx';
import { ProposalList } from './ProposalList.tsx';
import { SourcePreview, cellKey } from './SourcePreview.tsx';
import { STATE_LABEL, tableName } from './labels.ts';

export interface WorkspaceProps {
  readonly result: PipelineSuccess;
  /** The saved review being worked on (its proposals are the ones shown). */
  readonly review: SavedReview;
  /** Called with the updated review after every decision; the caller saves it. */
  readonly onReviewChange: (review: SavedReview) => void;
  /** e.g. "Saved in this browser at 10:42:05", or a storage problem. */
  readonly saveStatus: { readonly ok: boolean; readonly message: string };
  readonly onExport: () => void;
  readonly reviewer: string | null;
  readonly provider: ProviderInfo;
  readonly onStartAgain: () => void;
}

function firstTableWithContent(tables: readonly ExtractedTable[]): string {
  return (tables.find((t) => t.rows.length > 0) ?? tables[0])?.id ?? '';
}

export function Workspace({ result, review, onReviewChange, saveStatus, onExport, reviewer, provider, onStartAgain }: WorkspaceProps) {
  const { extraction, project } = result;
  const tables = extraction.tables;
  const proposals = review.proposals;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTableId, setActiveTableId] = useState(firstTableWithContent(tables));
  const [highlighted, setHighlighted] = useState<ReadonlySet<string>>(new Set());
  const [focus, setFocus] = useState<{ tableId: string; rowIndex: number; columnIndex?: number; nonce: number } | null>(null);
  const [bulkStep, setBulkStep] = useState<'idle' | 'confirm'>('idle');
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [showIssues, setShowIssues] = useState(false);
  const [view, setView] = useState<'review' | 'drafts'>('review');

  const verificationContext = { project, tables, documentId: extraction.document.id, provider };
  const selected = proposals.find((p) => p.id === selectedId) ?? null;

  const counts = useMemo(() => {
    const c = { verified: 0, failed_verification: 0, approved: 0, rejected: 0 };
    for (const p of proposals) c[reviewState(p)]++;
    return c;
  }, [proposals]);
  const unresolved = counts.verified + counts.failed_verification;
  const eligible = proposals.filter((p) => bulkIneligibility(p) === null);

  const proposedRowTypes = useMemo(() => {
    const map = new Map<number, { rowClass: BqRowClass; state: string }>();
    for (const p of proposals) {
      if (p.interpretation.decisionKind !== 'rowClass') continue;
      const v = p.interpretation.value as { tableId: string; rowIndex: number; rowClass: BqRowClass };
      if (v.tableId === activeTableId) map.set(v.rowIndex, { rowClass: v.rowClass, state: reviewState(p) });
    }
    return map;
  }, [proposals, activeTableId]);

  // Draft rows are rebuilt from the saved decisions every time — never stored separately.
  const drafts = useMemo(
    () =>
      view === 'drafts'
        ? buildDrafts({ proposals, tables, documentId: extraction.document.id, projectDetails: review.projectDetails ?? NO_PROJECT_DETAILS, today: new Date().toISOString().slice(0, 10) })
        : null,
    [view, proposals, tables, extraction.document.id, review.projectDetails],
  );
  const traceProblems = useMemo(() => (drafts ? verifyDrafts(drafts, tables) : []), [drafts, tables]);

  const showCells = (refs: readonly { tableId: string; rowIndex: number; columnIndex?: number }[]) => {
    setHighlighted(new Set(refs.map((r) => cellKey(r.tableId, r.rowIndex, r.columnIndex))));
    const first = refs[0];
    if (first) {
      setActiveTableId(first.tableId);
      setFocus({ ...first, nonce: Date.now() });
    }
  };

  const select = (id: string) => {
    setSelectedId(id);
    const p = proposals.find((x) => x.id === id);
    if (p) showCells(p.interpretation.evidence);
  };

  const now = () => new Date().toISOString();
  const decide = (updated: Proposal) => {
    const before = proposals.find((p) => p.id === updated.id)!;
    onReviewChange(recordChanges(review, [{ before, after: updated }], now(), reviewer));
  };
  const reopen = (p: Proposal) => onReviewChange(recordChanges(review, [{ before: p, after: reopenProposal(p) }], now(), reviewer));

  const runBulk = () => {
    const at = now();
    const { approved, skipped } = bulkApprove(proposals, { by: reviewer, at, note: 'Bulk approval of straightforward proposals.' });
    const before = new Map(proposals.map((p) => [p.id, p]));
    onReviewChange(recordChanges(review, approved.map((after) => ({ before: before.get(after.id)!, after })), at, reviewer));
    setBulkStep('idle');
    setBulkMessage(`Approved ${approved.length} straightforward proposal(s). ${skipped.filter((s) => s.proposal.status === 'proposed').length} other(s) stay for individual review.`);
  };

  const issueCell = (sheetName?: string, address?: string) => {
    if (!sheetName) return null;
    const table = tables.find((t) => t.origin.kind === 'worksheet' && t.origin.sheetName === sheetName);
    if (!table) return null;
    if (!address) return { tableId: table.id, rowIndex: 0 };
    const m = /^([A-Z]+)(\d+)$/.exec(address);
    if (!m) return null;
    const col = m[1]!.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    return { tableId: table.id, rowIndex: Number(m[2]) - 1, columnIndex: col };
  };

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-300 bg-white px-3 py-2 text-xs">
        <div>
          <strong className="text-sm">{extraction.document.fileName}</strong> · {extraction.format.toUpperCase()} · {tables.length} worksheet(s){extraction.csv ? ` · CSV ${extraction.csv.encoding}, ${JSON.stringify(extraction.csv.delimiter)} delimiter` : ''} · fingerprint {extraction.document.sha256.slice(0, 12)}…
        </div>
        <span className="flex items-center gap-2">
          <span data-testid="save-status" className={saveStatus.ok ? 'text-green-800' : 'font-medium text-red-800'}>{saveStatus.message}</span>
          <button type="button" onClick={onExport} className="rounded border px-2 py-1">
            Export review backup
          </button>
          <button type="button" onClick={onStartAgain} className="rounded border px-2 py-1">
            Back to start (this review stays saved)
          </button>
        </span>
      </div>

      <div className="flex flex-wrap gap-2 text-xs" data-testid="pipeline-stages">
        {result.stages.map((s) => (
          <span
            key={s.stage}
            title={s.message}
            className={`rounded px-2 py-0.5 ${s.status === 'done' ? 'bg-green-50 text-green-900' : s.status === 'failed' ? 'bg-red-50 text-red-900' : 'bg-slate-100 text-slate-700'}`}
          >
            {s.status === 'done' ? '✓' : s.status === 'failed' ? '✗' : '↺'} {STAGES.find((x) => x.name === s.stage)?.label}
            {s.status === 'not_run' ? ' (restored)' : ''}
          </span>
        ))}
        <span className="rounded bg-sky-50 px-2 py-0.5 text-sky-900">8. Your review</span>
        <span className="ml-auto flex gap-1" role="tablist" aria-label="View">
          <button type="button" role="tab" aria-selected={view === 'review'} onClick={() => setView('review')} className={`rounded border px-2 py-0.5 ${view === 'review' ? 'bg-slate-800 text-white' : 'bg-white'}`}>
            Review proposals
          </button>
          <button type="button" role="tab" aria-selected={view === 'drafts'} onClick={() => setView('drafts')} className={`rounded border px-2 py-0.5 ${view === 'drafts' ? 'bg-slate-800 text-white' : 'bg-white'}`}>
            Draft rows
          </button>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded border border-slate-300 bg-white px-3 py-2 text-xs" data-testid="review-summary">
        <span>
          <strong>{unresolved}</strong> unresolved
        </span>
        <span>{STATE_LABEL.verified}: {counts.verified}</span>
        <span className={counts.failed_verification ? 'font-medium text-red-800' : ''}>{STATE_LABEL.failed_verification}: {counts.failed_verification}</span>
        <span className="text-green-800">{STATE_LABEL.approved}: {counts.approved}</span>
        <span>{STATE_LABEL.rejected}: {counts.rejected}</span>
        <span className="text-slate-500">Reviewer: {reviewer ?? 'not recorded'}</span>
        <button type="button" onClick={() => setShowIssues(!showIssues)} className="ml-auto rounded border px-2 py-0.5">
          Extraction issues ({extraction.issues.length}) {showIssues ? '▲' : '▼'}
        </button>
        {bulkStep === 'idle' ? (
          <button type="button" disabled={eligible.length === 0} onClick={() => setBulkStep('confirm')} className="rounded border border-green-700 px-2 py-0.5 text-green-800 disabled:opacity-40">
            Approve straightforward proposals…
          </button>
        ) : (
          <span className="rounded border border-green-700 bg-green-50 px-2 py-1" data-testid="bulk-confirm">
            Approve {eligible.length} table, column and row proposal(s) with no alternatives and no warnings? Everything else stays for individual review.{' '}
            <button type="button" onClick={runBulk} className="ml-1 rounded bg-green-700 px-2 text-white">
              Confirm
            </button>{' '}
            <button type="button" onClick={() => setBulkStep('idle')} className="rounded border px-2">
              Cancel
            </button>
          </span>
        )}
      </div>
      {bulkMessage && <p className="text-xs text-green-900" role="status">{bulkMessage}</p>}

      {showIssues && (
        <ul className="max-h-40 overflow-auto rounded border border-slate-300 bg-white text-xs" data-testid="extraction-issues">
          {extraction.issues.map((issue, n) => {
            const cell = issueCell(issue.sheetName, issue.cellAddress);
            return (
              <li key={n} className={`border-b px-2 py-1 ${issue.severity === 'error' ? 'text-red-800' : issue.severity === 'warning' ? 'text-amber-800' : 'text-slate-600'}`}>
                <strong className="uppercase">{issue.severity}</strong> {issue.code}: {issue.message}{' '}
                {cell && (
                  <button type="button" className="text-sky-700 underline" onClick={() => showCells([cell])}>
                    show {issue.sheetName}
                    {issue.cellAddress ? `!${issue.cellAddress}` : ''}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {view === 'drafts' && drafts && (
        <div className="min-h-0 flex-1 overflow-auto">
          <DraftRows
            drafts={drafts}
            projectDetails={review.projectDetails ?? NO_PROJECT_DETAILS}
            traceProblems={traceProblems}
            onSaveProjectDetails={(d) => onReviewChange(setProjectDetails(review, d, now(), reviewer))}
            onShowSource={(cells) => {
              setView('review');
              if (cells.length) showCells(cells);
            }}
          />
        </div>
      )}

      <div className={`min-h-0 flex-1 grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-3 overflow-hidden ${view === 'review' ? 'grid' : 'hidden'}`}>
        <SourcePreview
          tables={tables}
          sheets={extraction.sheets}
          activeTableId={activeTableId}
          onSelectTable={setActiveTableId}
          highlighted={highlighted}
          focus={focus}
          proposedRowTypes={proposedRowTypes}
        />
        <div className="grid min-h-0 grid-rows-[minmax(0,2fr)_minmax(0,3fr)] gap-3 overflow-hidden">
          <div className="flex min-h-0 flex-col overflow-hidden">
            <ProposalList proposals={proposals} tables={tables} activeTableId={activeTableId} selectedId={selectedId} onSelect={select} />
          </div>
          <div className="min-h-0 overflow-auto rounded border border-slate-300 bg-white p-3">
            {selected ? (
              <EvidencePanel
                proposal={selected}
                tables={tables}
                reviewer={reviewer}
                verificationContext={verificationContext}
                history={historyOf(review, selected.id)}
                onReopen={() => reopen(selected)}
                onDecision={decide}
                onCitationClick={(tableId, rowIndex, columnIndex) => showCells([{ tableId, rowIndex, ...(columnIndex !== undefined ? { columnIndex } : {}) }])}
              />
            ) : (
              <p className="text-xs text-slate-500">Select a proposal to see its evidence, findings and decision options. Showing {tableName(tables.find((t) => t.id === activeTableId))}.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
