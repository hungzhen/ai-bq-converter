/**
 * DRAFT ROWS (Stages 2J–2K) — the draft Cost Library rows built from your APPROVED decisions,
 * and your decisions about each draft row.
 *
 * Values cannot be edited here. To change a draft, change the decision behind it in the review.
 * Nothing is exported or uploaded.
 *
 * Stage 2K:
 *   - Resolve a blocking issue individually, with a note (a placeholder: "the document does not
 *     state it — leave blank"; continuation values: "not part of this item"). Values never change.
 *   - Approve (no unresolved blocking issue; warnings acknowledged by the note), mark as needing
 *     changes, or exclude from the upload (with a reason). Excluded rows stay here, unchanged.
 *   - A negative value cannot be resolved; such a row can only be excluded.
 *   - If a review decision changes a row, its approval and resolutions become OUTDATED: shown in
 *     amber with what changed, and must be redone. The history keeps the earlier ones.
 *   - Bulk approval only of rows with no issues at all, after a confirmation.
 *   Reviewer names are typed in, not verified; the history is not tamper-proof.
 */
import { useState } from 'react';
import type { CellRef, FieldEvidence } from '../../core/models/index.ts';
import { hasUsableValue } from '../../core/models/index.ts';
import { type HistoryEvent, type ProjectDetails, ProjectDetailsError, type SavedReview } from '../../core/review/index.ts';
import {
  type DraftResult,
  type RowCategory,
  type RowEffectiveStatus,
  type RowView,
  type TableDrafts,
  type TableReadiness,
  DraftRowDecisionError,
  ROW_CATEGORIES,
  bulkApproveDraftRows,
  bulkRowIneligibility,
  decideDraftRow,
  orphanedRowDecisions,
  reopenDraftRow,
  resolveDraftIssue,
  tableReadiness,
  withdrawDraftResolution,
} from '../../core/staging/index.ts';
import { ROW_CLASS_LABEL } from '../review/labels.ts';
import { type ExportResult, NOT_VALIDATED } from '../../core/export/index.ts';

export const CATEGORY_LABEL: Record<RowCategory, string> = {
  draft_item: 'Draft rows',
  blocked_item: 'Item rows (not drafted: table blocked)',
  continuation: 'Continuation rows (joined)',
  header: 'Column headings',
  heading: 'Headings (context)',
  note: 'Notes / preambles',
  total_or_carried: 'Totals / carried',
  reference_or_title: 'Titles / references',
  blank: 'Blank',
  ignored: 'Ignored',
  unclassified: 'Unclassified (not drafted)',
  outside_table_area: 'Outside table area',
  undecided: 'Undecided',
  table_not_converted: 'Table not converted',
};

const STATUS_TEXT: Record<RowEffectiveStatus, string> = {
  pending: 'Not yet decided',
  approved: '✓ Approved',
  needs_changes: 'Needs changes',
  excluded: 'Excluded from upload',
  outdated: '⚠ Outdated — redo',
};
const STATUS_STYLE_ROW: Record<RowEffectiveStatus, string> = {
  pending: '',
  approved: 'bg-green-50',
  needs_changes: 'bg-sky-50',
  excluded: 'bg-slate-100 text-slate-600',
  outdated: 'bg-amber-50',
};

type Filter = 'all' | 'blocking' | 'undecided' | 'excluded' | 'outdated';
const FILTERS: Record<Filter, { label: string; test: (v: RowView) => boolean }> = {
  all: { label: 'All draft rows', test: () => true },
  blocking: { label: 'With unresolved blocking issues', test: (v) => v.unresolvedBlocking.length > 0 },
  undecided: { label: 'Not yet approved or excluded', test: (v) => v.effective !== 'approved' && v.effective !== 'excluded' },
  excluded: { label: 'Excluded from upload', test: (v) => v.effective === 'excluded' },
  outdated: { label: 'Outdated (must be redone)', test: (v) => v.effective === 'outdated' || v.blocking.some((b) => b.outdated) },
};

export interface DraftRowsProps {
  readonly drafts: DraftResult;
  readonly review: SavedReview;
  readonly reviewer: string | null;
  /** Called with the updated review after every decision; the caller saves it. */
  readonly onReviewChange: (review: SavedReview) => void;
  readonly projectDetails: ProjectDetails;
  /** Saves new project details (recorded in the review history). Throws ProjectDetailsError if invalid. */
  readonly onSaveProjectDetails: (details: ProjectDetails) => void;
  /** Shows the given source cells in the review view. */
  readonly onShowSource: (cells: readonly CellRef[]) => void;
  /** Problems found when the drafts were checked against the source (should always be empty). */
  readonly traceProblems: readonly string[];
  /** Creates the export files (checks, writes, reads back, records, downloads). */
  readonly onCreateExport?: () => Promise<ExportResult>;
}

const now = () => new Date().toISOString();

export function DraftRows({ drafts, review, reviewer, onReviewChange, projectDetails, onSaveProjectDetails, onShowSource, traceProblems, onCreateExport }: DraftRowsProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const [bulk, setBulk] = useState<'idle' | 'confirm'>('idle');
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const ready = drafts.tables.filter((t) => t.status === 'ready');
  const draftCount = ready.reduce((n, t) => n + t.drafts.length, 0);
  const readiness = new Map(drafts.tables.map((t) => [t.tableId, tableReadiness(t, review, drafts.projectIssues)]));
  const allViews = [...readiness.values()].flatMap((r) => r.views);
  const eligible = allViews.filter((v) => bulkRowIneligibility(v) === null);
  const orphans = orphanedRowDecisions(drafts, review);

  const runBulk = () => {
    const result = bulkApproveDraftRows(review, eligible.map((v) => v.draft), now(), reviewer);
    onReviewChange(result.review);
    setBulk('idle');
    setBulkMessage(`Approved ${result.approved.length} draft row(s) with no issues. Every other row stays for individual review.`);
  };

  return (
    <div className="flex flex-col gap-3 text-xs" data-testid="draft-rows">
      <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-950">
        <strong>Draft rows only.</strong> Built from your approved decisions; nothing is exported or uploaded. Values are copied from the cited cells — nothing is
        calculated. To change a draft, change the decision behind it in the review. Reviewer names are typed in, not verified; the history is not tamper-proof.
      </p>
      <ProjectForm details={projectDetails} onSave={onSaveProjectDetails} />
      {onCreateExport && <ExportPanel readiness={[...readiness.entries()].map(([id, r]) => ({ table: drafts.tables.find((t) => t.tableId === id)!, r }))} onCreateExport={onCreateExport} />}

      {(drafts.projectIssues.length > 0 || drafts.documentBlockers.length > 0) && (
        <div role="alert" data-testid="draft-blockers" className="rounded border border-red-300 bg-red-50 px-3 py-2 text-red-900">
          <strong>Blocking:</strong>
          <ul className="list-disc pl-5">
            {drafts.projectIssues.map((i) => (
              <li key={i.code}>{i.message}</li>
            ))}
            {drafts.documentBlockers.map((b, n) => (
              <li key={n}>{b}</li>
            ))}
          </ul>
        </div>
      )}
      {traceProblems.length > 0 && (
        <div role="alert" data-testid="trace-problems" className="rounded border border-red-500 bg-red-100 px-3 py-2 text-red-900">
          <strong>The drafts did not pass the check against their source cells:</strong>
          <ul className="list-disc pl-5">
            {traceProblems.slice(0, 20).map((p, n) => (
              <li key={n}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      {orphans.length > 0 && (
        <div role="alert" data-testid="orphaned-decisions" className="rounded border border-amber-400 bg-amber-50 px-3 py-2 text-amber-950">
          <strong>{orphans.length} earlier row decision(s) belong to rows that are no longer draft rows</strong> (a review decision changed them). They are not
          applied and stay in the history: {orphans.map((o) => o.draftId.split(':').slice(-2).join(' row ')).join('; ')}.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <span data-testid="draft-summary">
          {draftCount} draft row(s) from {ready.length} ready table(s) · {drafts.tables.filter((t) => t.status === 'blocked').length} blocked ·{' '}
          {drafts.tables.filter((t) => t.status === 'not_converted').length} not converted
        </span>
        <label>
          Show{' '}
          <select aria-label="Show draft rows" data-testid="row-filter" value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className="rounded border px-1">
            {(Object.keys(FILTERS) as Filter[]).map((f) => (
              <option key={f} value={f}>
                {FILTERS[f].label}
              </option>
            ))}
          </select>
        </label>
        {bulk === 'idle' ? (
          <button type="button" disabled={eligible.length === 0} onClick={() => setBulk('confirm')} className="rounded border border-green-700 px-2 py-0.5 text-green-800 disabled:opacity-40">
            Approve rows with no issues…
          </button>
        ) : (
          <span className="rounded border border-green-700 bg-green-50 px-2 py-1" data-testid="bulk-rows-confirm">
            Approve {eligible.length} draft row(s) that have no issues at all? Every row with any issue stays for individual review.{' '}
            <button type="button" onClick={runBulk} className="ml-1 rounded bg-green-700 px-2 text-white">
              Confirm
            </button>{' '}
            <button type="button" onClick={() => setBulk('idle')} className="rounded border px-2">
              Cancel
            </button>
          </span>
        )}
        {bulkMessage && <span role="status" className="text-green-900">{bulkMessage}</span>}
      </div>

      {drafts.tables.map((t) => (
        <TableSection
          key={t.tableId}
          table={t}
          readiness={readiness.get(t.tableId)!}
          filter={filter}
          review={review}
          reviewer={reviewer}
          onReviewChange={onReviewChange}
          onShowSource={onShowSource}
        />
      ))}
    </div>
  );
}

function ProjectForm({ details, onSave }: { details: ProjectDetails; onSave: (d: ProjectDetails) => void }) {
  const [form, setForm] = useState({ name: details.name ?? '', year: details.year ?? '', projectRef: details.projectRef ?? '', location: details.location ?? '' });
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const field = (key: keyof typeof form, label: string) => (
    <label className="flex flex-col gap-0.5">
      <span>{label}</span>
      <input aria-label={label} value={form[key]} placeholder="not entered" onChange={(e) => setForm({ ...form, [key]: e.target.value })} className="rounded border px-2 py-1" />
    </label>
  );
  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded border border-slate-300 bg-white px-3 py-2"
      data-testid="project-form"
      onSubmit={(e) => {
        e.preventDefault();
        try {
          onSave({ name: form.name, year: form.year, projectRef: form.projectRef, location: form.location });
          setMessage({ ok: true, text: 'Project details saved (recorded in the review history).' });
        } catch (err) {
          setMessage({ ok: false, text: err instanceof ProjectDetailsError ? err.message : String(err) });
        }
      }}
    >
      <strong className="w-full text-sm">Project details (typed in by you — never taken from the file)</strong>
      {field('name', 'Project name (required)')}
      {field('year', 'Project year (required, e.g. 2024 Q1)')}
      {field('projectRef', 'Project reference (optional)')}
      {field('location', 'Location (optional)')}
      <button type="submit" className="rounded bg-sky-700 px-3 py-1 text-white">
        Save project details
      </button>
      {message && (
        <span role={message.ok ? 'status' : 'alert'} data-testid="project-message" className={message.ok ? 'text-green-800' : 'text-red-800'}>
          {message.text}
        </span>
      )}
    </form>
  );
}

const TABLE_STYLE = {
  ready: 'border-green-300 bg-green-50 text-green-900',
  blocked: 'border-red-300 bg-red-50 text-red-900',
  not_converted: 'border-slate-300 bg-slate-100 text-slate-700',
} as const;
const TABLE_LABEL = { ready: '✓ Ready', blocked: '✗ Blocked', not_converted: '– Not converted' } as const;

interface SectionProps {
  readonly table: TableDrafts;
  readonly readiness: TableReadiness;
  readonly filter: Filter;
  readonly review: SavedReview;
  readonly reviewer: string | null;
  readonly onReviewChange: (r: SavedReview) => void;
  readonly onShowSource: (cells: readonly CellRef[]) => void;
}

function TableSection({ table, readiness, filter, review, reviewer, onReviewChange, onShowSource }: SectionProps) {
  const others = table.accounts.filter((a) => a.category !== 'draft_item');
  const unclassified = table.accounts.filter((a) => a.category === 'unclassified');
  const shown = readiness.views.filter(FILTERS[filter].test);
  const excluded = readiness.views.filter((v) => v.effective === 'excluded');
  const c = readiness.counts;
  return (
    <section className="rounded border border-slate-300 bg-white" data-testid={`draft-table-${table.name}`} data-status={table.status}>
      <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <strong className="text-sm">{table.name}</strong>
        <span className={`rounded border px-2 py-0.5 ${TABLE_STYLE[table.status]}`} data-testid="table-status">
          {TABLE_LABEL[table.status]}
        </span>
        {table.status === 'ready' && (
          <span data-testid="table-readiness">
            {table.drafts.length} draft row(s): approved {c.approved} · excluded {c.excluded} · needs changes {c.needs_changes} · not yet decided {c.pending} ·{' '}
            <span className={c.outdated ? 'font-medium text-amber-800' : ''}>outdated {c.outdated}</span> —{' '}
            <strong className={readiness.readyForExport ? 'text-green-800' : 'text-slate-700'}>
              {readiness.readyForExport ? 'ready for export (nothing is exported yet)' : 'not ready for export'}
            </strong>
          </span>
        )}
      </header>
      {table.reasons.length > 0 && (
        <ul className="list-disc px-3 py-2 pl-8 text-red-900" data-testid="table-reasons">
          {table.reasons.map((r, n) => (
            <li key={n}>{r}</li>
          ))}
        </ul>
      )}
      <p className="px-3 py-1 text-slate-700" data-testid="reconciliation-counts">
        <strong>Source rows: {table.sourceRowCount}</strong> —{' '}
        {ROW_CATEGORIES.filter((k) => table.counts[k] > 0)
          .map((k) => `${CATEGORY_LABEL[k]}: ${table.counts[k]}`)
          .join(' · ')}
      </p>
      {unclassified.length > 0 && (
        <p className="px-3 py-1 text-amber-900" data-testid="unclassified-rows">
          ⚠ {unclassified.length} unclassified row(s) were not drafted (their type is never guessed): {unclassified.map((a) => a.reference).join('; ')}
        </p>
      )}
      {table.statedTotals.length > 0 && (
        <p className="px-3 py-1 text-slate-600">
          Totals stated in the document (information only — not recalculated or compared):{' '}
          {table.statedTotals.map((s) => `${s.reference} “${s.label}” ${s.amountText ?? '(no amount)'}`).join('; ')}
        </p>
      )}
      {excluded.length > 0 && (
        <div className="px-3 py-1" data-testid="excluded-rows">
          <strong>Excluded from the upload ({excluded.length}) — kept here with their original values, sources and reasons:</strong>
          <ul className="list-disc pl-5">
            {excluded.map((v) => (
              <li key={v.draft.row.id}>
                {v.draft.row.item.sourceReference} · {v.summary['Item no.']} · {v.summary['Description']} · Qty {v.summary['Qty']} · Rate {v.summary['Rate']} · Amount{' '}
                {v.summary['Amount']} — reason: “{v.decision!.record.note}” ({v.decision!.record.by ?? 'not recorded'}, {v.decision!.record.at})
              </li>
            ))}
          </ul>
        </div>
      )}
      {others.length > 0 && (
        <details className="px-3 py-1">
          <summary className="cursor-pointer text-sky-800">Every other source row ({others.length}) and what happened to it</summary>
          <table className="mt-1 w-full border-collapse" data-testid="row-accounts">
            <tbody>
              {others.map((a) => (
                <tr key={a.rowIndex} className="border-t">
                  <td className="px-1 py-0.5 whitespace-nowrap">{a.reference}</td>
                  <td className="px-1 py-0.5">{CATEGORY_LABEL[a.category]}</td>
                  <td className="px-1 py-0.5 text-slate-500">{a.rowClass ? ROW_CLASS_LABEL[a.rowClass] : ''}</td>
                  <td className="px-1 py-0.5">{a.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      {shown.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse" data-testid="draft-table">
            <thead>
              <tr className="bg-slate-100 text-left text-slate-600">
                <th className="border px-1">Source</th>
                <th className="border px-1">Item no.</th>
                <th className="border px-1">Description (exact)</th>
                <th className="border px-1">Unit as written</th>
                <th className="border px-1 text-right">Qty</th>
                <th className="border px-1 text-right">Rate</th>
                <th className="border px-1 text-right">Amount</th>
                <th className="border px-1">Headings / trade</th>
                <th className="border px-1">Issues</th>
                <th className="border px-1">Your decision</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((v) => (
                <DraftLine key={v.draft.row.id} view={v} review={review} reviewer={reviewer} onReviewChange={onReviewChange} onShowSource={onShowSource} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {table.drafts.length > 0 && shown.length === 0 && <p className="px-3 py-2 text-slate-500">No draft rows match “{FILTERS[filter].label}”.</p>}
    </section>
  );
}

interface LineProps {
  readonly view: RowView;
  readonly review: SavedReview;
  readonly reviewer: string | null;
  readonly onReviewChange: (r: SavedReview) => void;
  readonly onShowSource: (cells: readonly CellRef[]) => void;
}

function DraftLine({ view, review, reviewer, onReviewChange, onShowSource }: LineProps) {
  const { draft } = view;
  const { row } = draft;
  const show = (field: string) => () => onShowSource(draft.cells[field] ?? []);
  const text = (field: 'itemNo' | 'description') => {
    const e = row.evidence[field] as FieldEvidence<string> | undefined;
    return e && hasUsableValue(e) ? e.parsed : null;
  };
  const resolvedFields = new Set(view.blocking.filter((b) => b.resolution && !b.outdated && b.resolution.kind === 'confirmed_not_stated').map((b) => b.issue.field));
  return (
    <tr className={`border-t align-top ${STATUS_STYLE_ROW[view.effective]}`} data-testid="draft-line" data-draft-id={row.id} data-row-status={view.effective}>
      <td className="border px-1 whitespace-nowrap">
        {row.item.sourceReference}
        {draft.continuationRowIndexes.length > 0 && <div className="text-slate-500">+ {draft.continuationRowIndexes.map((i) => `Row ${i + 1}`).join(', ')}</div>}
      </td>
      <td className="border px-1">
        <button type="button" className="text-left hover:underline" onClick={show('itemNo')}>
          {text('itemNo') ?? <em className="text-slate-500">none</em>}
        </button>
      </td>
      <td className="border px-1">
        <button type="button" className="text-left hover:underline" onClick={show('description')} data-testid="draft-description">
          {text('description') ?? <em className="text-amber-800">not stated</em>}
        </button>
        {draft.descriptionParts.length > 1 && <div className="text-slate-500">joined from {draft.descriptionParts.length} cells (one space between)</div>}
      </td>
      <td className="border px-1" data-testid="draft-unit">
        <button type="button" className="hover:underline" onClick={show('unit')}>
          {draft.unit.asWritten ?? <em className="text-amber-800">not stated</em>}
        </button>
        {draft.unit.differs && <div className="text-slate-500">Cost Library would store “{draft.unit.costLibrarySpelling}” (not applied)</div>}
        {draft.unit.meaning === 'lump_sum' && <div className="text-slate-500">lump sum — quantity never assumed</div>}
      </td>
      {(['quantity', 'rate', 'amount'] as const).map((f) => (
        <NumberCell key={f} view={view} field={f} confirmed={resolvedFields.has(f)} onClick={show(f)} />
      ))}
      <td className="border px-1 text-slate-600">
        {[row.item.billDescription, row.item.sectionDescription, row.item.mainHeading, row.item.subheading, row.item.secondarySubheading].filter(Boolean).join(' › ')}
        <div>{[row.item.tradeWork, row.item.subTrade].filter(Boolean).join(' / ') || <span className="text-slate-400">trade blank</span>}</div>
      </td>
      <td className="border px-1" data-testid="row-issues">
        <IssueList view={view} />
      </td>
      <td className="border px-1" data-testid="row-decision">
        <DecisionCell view={view} review={review} reviewer={reviewer} onReviewChange={onReviewChange} />
      </td>
    </tr>
  );
}

function IssueList({ view }: { view: RowView }) {
  const others = view.draft.row.issues.filter((i) => i.severity !== 'blocking');
  if (view.blocking.length + others.length === 0) return <span className="text-green-800">none</span>;
  return (
    <ul className="flex flex-col gap-1">
      {view.blocking.map((b) => (
        <li key={b.issue.id} data-testid="blocking-issue" className={b.resolution && !b.outdated ? 'text-green-900' : 'text-red-800'}>
          <strong>blocking</strong> {b.issue.message}
          {b.resolution && !b.outdated && (
            <div data-testid="issue-resolution">
              ✓ Resolved —{' '}
              {b.resolution.kind === 'confirmed_not_stated' ? 'confirmed not stated in the document; stays blank in the export (not a zero)' : 'confirmed not part of this item'}{' '}
              ({b.resolution.by ?? 'not recorded'}): “{b.resolution.note}”
            </div>
          )}
          {b.outdated && (
            <div data-testid="issue-outdated" className="rounded bg-amber-100 px-1 text-amber-900">
              ⚠ Resolution outdated — the row changed since it was resolved: {b.changes.join('; ')}. Resolve again.
            </div>
          )}
          {!b.resolvable && <div className="text-slate-600">{b.howToClear}</div>}
        </li>
      ))}
      {others.length > 0 && (
        <li>
          <details>
            <summary className="cursor-pointer text-amber-800">{others.length} warning / information note(s)</summary>
            <ul className="list-disc pl-4">
              {others.map((i) => (
                <li key={i.id} className={i.severity === 'warning' ? 'text-amber-800' : 'text-slate-600'}>
                  <strong>{i.severity}</strong> {i.message}
                </li>
              ))}
            </ul>
          </details>
        </li>
      )}
    </ul>
  );
}

function DecisionCell({ view, review, reviewer, onReviewChange }: { view: RowView; review: SavedReview; reviewer: string | null; onReviewChange: (r: SavedReview) => void }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const ref = view.draft.row.item.sourceReference;
  const act = (f: () => SavedReview) => {
    try {
      onReviewChange(f());
      setNote('');
      setError(null);
    } catch (e) {
      setError(e instanceof DraftRowDecisionError ? e.message : String(e));
    }
  };
  const d = view.decision;
  const current = d && !d.outdated ? d.record : null;
  const history = review.history.filter((e) => e.draftRow?.draftId === view.draft.row.id);
  const toResolve = view.blocking.filter((b) => b.resolvable && (!b.resolution || b.outdated));
  const withdrawable = view.blocking.filter((b) => b.resolution);
  return (
    <div className="flex min-w-56 flex-col gap-1">
      <span data-testid="row-status" className="font-medium">
        {STATUS_TEXT[view.effective]}
      </span>
      {current && (
        <span className="text-slate-600">
          {current.by ?? 'not recorded'} · {current.at}
          {current.note ? ` · “${current.note}”` : ''}
        </span>
      )}
      {d?.outdated && (
        <div data-testid="decision-outdated" className="rounded bg-amber-100 px-1 text-amber-900">
          Earlier decision “{d.record.status.replace('_', ' ')}” ({d.record.by ?? 'not recorded'}) is outdated — what changed: {d.changes.join('; ')}. Decide again.
        </div>
      )}
      <details data-testid="row-actions">
        <summary className="cursor-pointer text-sky-800">Decide / resolve…</summary>
        <div className="mt-1 flex flex-col gap-1">
          <textarea aria-label={`Note for ${ref}`} value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Note (required to resolve, to exclude, and to approve a row with warnings)" className="rounded border px-1" />
          {toResolve.map((b) => (
            <button key={b.issue.id} type="button" className="rounded border border-red-400 bg-white px-1 text-left" onClick={() => act(() => resolveDraftIssue(review, view.draft, b.issue.id, note, now(), reviewer))}>
              {b.resolvable === 'confirmed_not_stated'
                ? `Confirm: ${b.issue.field} is not stated in the document — leave blank`
                : 'Confirm: the continuation-row values are not part of this item'}
            </button>
          ))}
          {!current ? (
            <span className="flex flex-wrap gap-1">
              <button
                type="button"
                className="rounded bg-green-700 px-2 text-white disabled:opacity-40"
                disabled={view.unresolvedBlocking.length > 0}
                title={view.approvalBlockers.join(' ')}
                onClick={() => act(() => decideDraftRow(review, view.draft, 'approved', note, now(), reviewer))}
              >
                Approve row
              </button>
              <button type="button" className="rounded border px-2" onClick={() => act(() => decideDraftRow(review, view.draft, 'needs_changes', note, now(), reviewer))}>
                Needs changes
              </button>
              <button type="button" className="rounded border border-slate-500 px-2" onClick={() => act(() => decideDraftRow(review, view.draft, 'excluded', note, now(), reviewer))}>
                Exclude from upload
              </button>
            </span>
          ) : (
            <button type="button" className="rounded border px-2" onClick={() => act(() => reopenDraftRow(review, view.draft.row.id, now(), reviewer))}>
              Change this decision (the earlier one stays in the history)
            </button>
          )}
          {view.unresolvedBlocking.length > 0 && !current && <span className="text-red-800">Approval needs every blocking issue resolved first.</span>}
          {withdrawable.length > 0 && !(current?.status === 'approved') && (
            <span className="flex flex-wrap gap-1">
              {withdrawable.map((b) => (
                <button key={b.issue.id} type="button" className="rounded border px-1 text-slate-600" onClick={() => act(() => withdrawDraftResolution(review, view.draft, b.issue.id, now(), reviewer))}>
                  Withdraw resolution ({b.issue.field ?? b.issue.code})
                </button>
              ))}
            </span>
          )}
          {error && (
            <span role="alert" data-testid="row-error" className="text-red-800">
              {error}
            </span>
          )}
          {history.length > 0 && <RowHistory events={history} />}
        </div>
      </details>
    </div>
  );
}

function RowHistory({ events }: { events: readonly HistoryEvent[] }) {
  return (
    <details data-testid="row-history">
      <summary className="cursor-pointer">History ({events.length})</summary>
      <ol className="list-decimal pl-5 text-slate-600">
        {events.map((e) => (
          <li key={e.sequence}>
            {e.at} · {e.by ?? 'not recorded'} · {e.summary}
            {e.note ? ` “${e.note}”` : ''}
          </li>
        ))}
      </ol>
    </details>
  );
}

/**
 * A figure. A genuine value (including a stated zero) is shown as the number; a placeholder is
 * shown as "not stated" with the reason — never as 0 — and, once confirmed, as "stays blank".
 */
function NumberCell({ view, field, confirmed, onClick }: { view: RowView; field: 'quantity' | 'rate' | 'amount'; confirmed: boolean; onClick: () => void }) {
  const row = view.draft.row;
  const e = row.evidence[field];
  const placeholder = row.placeholders.some((p) => p.field === field);
  let content;
  if (hasUsableValue(e)) {
    const negative = e.parsed < 0;
    content = (
      <>
        <span className={negative ? 'font-medium text-red-800' : ''} data-value-kind={e.state === 'zero' ? 'stated_zero' : 'value'}>
          {String(e.parsed)}
        </span>
        {e.state === 'zero' && <div className="text-green-800">stated as 0 in the document</div>}
        {negative && <div className="text-red-800">negative — can only be excluded</div>}
      </>
    );
  } else {
    const shown = e.state === 'special' ? `“${String(e.raw)}”` : e.state === 'unparseable' ? `“${String(e.raw)}” (not understood)` : e.state === 'not_stated' ? 'no column' : 'empty';
    content = (
      <span data-value-kind="placeholder" className="text-amber-800">
        not stated: {shown}
        {placeholder && !confirmed && <div className="text-red-800">placeholder only — blocking</div>}
        {confirmed && <div className="text-green-800" data-testid="confirmed-blank">confirmed: stays blank in the export</div>}
      </span>
    );
  }
  return (
    <td className="border px-1 text-right">
      <button type="button" className="text-right hover:underline" onClick={onClick} data-testid={`draft-${field}`}>
        {content}
      </button>
    </td>
  );
}

/**
 * EXPORT (Stage 2L). The upload workbook is NOT YET VALIDATED FOR COST LIBRARY IMPORT: it is
 * never presented as safe to upload until the separate compatibility test is approved.
 */
function ExportPanel({ readiness, onCreateExport }: { readiness: { table: TableDrafts; r: TableReadiness }[]; onCreateExport: () => Promise<ExportResult> }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExportResult | null>(null);
  const ready = readiness.filter((x) => x.r.readyForExport && x.table.drafts.length > 0);
  return (
    <section className="rounded border-2 border-red-400 bg-white px-3 py-2" data-testid="export-panel">
      <h3 className="text-sm font-semibold text-red-900">Export — {NOT_VALIDATED}</h3>
      <p className="mt-1 rounded bg-red-50 px-2 py-1 text-red-900" data-testid="not-validated-warning">
        The upload workbook has <strong>not</strong> been checked against the Cost Library import. The Cost Library importer may apply defaults or calculations
        to blank cells. Do not upload it to the Cost Library until the separate compatibility test has been completed and approved. The files are for checking only.
      </p>
      <ul className="mt-1 list-disc pl-5" data-testid="export-tables">
        {readiness.map(({ table, r }) => (
          <li key={table.tableId} className={r.readyForExport && table.drafts.length ? 'text-green-900' : 'text-slate-600'}>
            <strong>{table.name}</strong>:{' '}
            {r.readyForExport && table.drafts.length
              ? `will be exported — ${r.counts.approved} approved row(s); ${r.counts.excluded} excluded row(s) stay in the reconciliation only.`
              : `not exported — ${[...table.reasons, ...r.notReadyBecause].join(' ') || 'no draft rows.'}`}
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={busy || ready.length === 0}
        onClick={async () => {
          setBusy(true);
          setResult(await onCreateExport());
          setBusy(false);
        }}
        className="mt-2 rounded bg-slate-800 px-3 py-1 text-white disabled:opacity-40"
      >
        {busy ? 'Checking and writing…' : 'Create export files (for checking only)'}
      </button>
      {result && !result.ok && (
        <div role="alert" data-testid="export-errors" className="mt-2 text-red-900">
          <strong>No files were produced:</strong>
          <ul className="list-disc pl-5">
            {result.errors.map((e, n) => (
              <li key={n}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {result && result.ok && (
        <div role="status" data-testid="export-done" className="mt-2 text-slate-800">
          Files created, read back and checked; the export is recorded in the review history:
          <ul className="list-disc pl-5">
            {result.files.map((f) => (
              <li key={f.kind}>
                {f.fileName} — SHA-256 {f.sha256.slice(0, 16)}… ({f.bytes.length.toLocaleString('en-GB')} bytes)
                {f.kind === 'upload' ? ` — ${NOT_VALIDATED}` : ' — reconciliation only, never for upload'}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
