/**
 * DRAFT ROWS (Stage 2J) — the draft Cost Library rows built from your APPROVED decisions.
 *
 * Read-only: values cannot be edited here. To change a draft, change the decision behind it in
 * the review (every change stays in the history). Nothing is exported or uploaded.
 *
 * On screen:
 *   - project details you type in (name and year are required; never filled in for you);
 *   - per table: ready / blocked / not converted, with the reasons;
 *   - every source row accounted for (drafted, joined, heading, note, total, unclassified …);
 *   - the draft rows, with each value's source cell one click away.
 * A genuine zero from the document and a placeholder 0 (no figure in the document) are shown
 * differently everywhere. Units are shown exactly as written, with the Cost Library's spelling
 * beside them.
 */
import { useState } from 'react';
import type { CellRef, FieldEvidence, StagedBQRow } from '../../core/models/index.ts';
import { hasUsableValue } from '../../core/models/index.ts';
import { type ProjectDetails, ProjectDetailsError } from '../../core/review/index.ts';
import type { DraftResult, DraftRow, RowCategory, TableDrafts } from '../../core/staging/index.ts';
import { ROW_CATEGORIES } from '../../core/staging/index.ts';
import { ROW_CLASS_LABEL } from '../review/labels.ts';

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

export interface DraftRowsProps {
  readonly drafts: DraftResult;
  readonly projectDetails: ProjectDetails;
  /** Saves new project details (recorded in the review history). Throws ProjectDetailsError if invalid. */
  readonly onSaveProjectDetails: (details: ProjectDetails) => void;
  /** Shows the given source cells in the review view. */
  readonly onShowSource: (cells: readonly CellRef[]) => void;
  /** Problems found when the drafts were checked against the source (should always be empty). */
  readonly traceProblems: readonly string[];
}

export function DraftRows({ drafts, projectDetails, onSaveProjectDetails, onShowSource, traceProblems }: DraftRowsProps) {
  const ready = drafts.tables.filter((t) => t.status === 'ready');
  const draftCount = ready.reduce((n, t) => n + t.drafts.length, 0);
  return (
    <div className="flex flex-col gap-3 text-xs" data-testid="draft-rows">
      <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-950">
        <strong>Draft rows only.</strong> Built from your approved decisions; nothing is exported or uploaded. Values are copied from the cited cells — nothing is
        calculated. To change a draft, change the decision behind it in the review.
      </p>
      <ProjectForm details={projectDetails} onSave={onSaveProjectDetails} />

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

      <p data-testid="draft-summary">
        {draftCount} draft row(s) from {ready.length} ready table(s) · {drafts.tables.filter((t) => t.status === 'blocked').length} blocked ·{' '}
        {drafts.tables.filter((t) => t.status === 'not_converted').length} not converted
      </p>

      {drafts.tables.map((t) => (
        <TableSection key={t.tableId} table={t} onShowSource={onShowSource} />
      ))}
    </div>
  );
}

function ProjectForm({ details, onSave }: { details: ProjectDetails; onSave: (d: ProjectDetails) => void }) {
  const [form, setForm] = useState({ name: details.name ?? '', year: details.year ?? '', projectRef: details.projectRef ?? '', location: details.location ?? '' });
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const field = (key: keyof typeof form, label: string, placeholder: string) => (
    <label className="flex flex-col gap-0.5">
      <span>{label}</span>
      <input aria-label={label} value={form[key]} placeholder={placeholder} onChange={(e) => setForm({ ...form, [key]: e.target.value })} className="rounded border px-2 py-1" />
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
      {field('name', 'Project name (required)', 'not entered')}
      {field('year', 'Project year (required, e.g. 2024 Q1)', 'not entered')}
      {field('projectRef', 'Project reference (optional)', 'not entered')}
      {field('location', 'Location (optional)', 'not entered')}
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

const STATUS_STYLE = {
  ready: 'border-green-300 bg-green-50 text-green-900',
  blocked: 'border-red-300 bg-red-50 text-red-900',
  not_converted: 'border-slate-300 bg-slate-100 text-slate-700',
} as const;
const STATUS_LABEL = { ready: '✓ Ready', blocked: '✗ Blocked', not_converted: '– Not converted' } as const;

function TableSection({ table, onShowSource }: { table: TableDrafts; onShowSource: (cells: readonly CellRef[]) => void }) {
  const blockingRows = table.drafts.filter((d) => d.row.issues.some((i) => i.severity === 'blocking' && !i.resolution)).length;
  const others = table.accounts.filter((a) => a.category !== 'draft_item');
  const unclassified = table.accounts.filter((a) => a.category === 'unclassified');
  return (
    <section className="rounded border border-slate-300 bg-white" data-testid={`draft-table-${table.name}`} data-status={table.status}>
      <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <strong className="text-sm">{table.name}</strong>
        <span className={`rounded border px-2 py-0.5 ${STATUS_STYLE[table.status]}`} data-testid="table-status">
          {STATUS_LABEL[table.status]}
        </span>
        {table.status === 'ready' && (
          <span>
            {table.drafts.length} draft row(s) · <span className={blockingRows ? 'font-medium text-red-800' : ''}>{blockingRows} with blocking issues</span>
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
        {ROW_CATEGORIES.filter((c) => table.counts[c] > 0)
          .map((c) => `${CATEGORY_LABEL[c]}: ${table.counts[c]}`)
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
      {table.drafts.length > 0 && (
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
                <th className="border px-1">Headings</th>
                <th className="border px-1">Trade (approved only)</th>
                <th className="border px-1">Issues</th>
              </tr>
            </thead>
            <tbody>
              {table.drafts.map((d) => (
                <DraftLine key={d.row.id} draft={d} onShowSource={onShowSource} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function DraftLine({ draft, onShowSource }: { draft: DraftRow; onShowSource: (cells: readonly CellRef[]) => void }) {
  const { row } = draft;
  const show = (field: string) => () => onShowSource(draft.cells[field] ?? []);
  const blocking = row.issues.filter((i) => i.severity === 'blocking' && !i.resolution);
  const other = row.issues.filter((i) => i.severity !== 'blocking');
  const text = (field: 'itemNo' | 'description') => {
    const e = row.evidence[field] as FieldEvidence<string> | undefined;
    return e && hasUsableValue(e) ? e.parsed : null;
  };
  return (
    <tr className="border-t align-top" data-testid="draft-line" data-draft-id={row.id}>
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
      <NumberCell row={row} field="quantity" onClick={show('quantity')} />
      <NumberCell row={row} field="rate" onClick={show('rate')} />
      <NumberCell row={row} field="amount" onClick={show('amount')} />
      <td className="border px-1 text-slate-600">
        {[row.item.billDescription, row.item.sectionDescription, row.item.mainHeading, row.item.subheading, row.item.secondarySubheading].filter(Boolean).join(' › ')}
      </td>
      <td className="border px-1">{[row.item.tradeWork, row.item.subTrade].filter(Boolean).join(' / ') || <span className="text-slate-400">blank</span>}</td>
      <td className="border px-1">
        {blocking.length + other.length === 0 ? (
          <span className="text-green-800">none</span>
        ) : (
          <details>
            <summary className={blocking.length ? 'cursor-pointer font-medium text-red-800' : 'cursor-pointer text-amber-800'}>
              {blocking.length} blocking, {other.length} other
            </summary>
            <ul className="list-disc pl-4">
              {[...blocking, ...other].map((i) => (
                <li key={i.id} className={i.severity === 'blocking' ? 'text-red-800' : i.severity === 'warning' ? 'text-amber-800' : 'text-slate-600'}>
                  <strong>{i.severity}</strong> {i.message}
                </li>
              ))}
            </ul>
          </details>
        )}
      </td>
    </tr>
  );
}

/**
 * A figure. A genuine value (including a stated zero) is shown as the number; a placeholder is
 * shown as "not stated" with the reason — never as 0.
 */
function NumberCell({ row, field, onClick }: { row: StagedBQRow; field: 'quantity' | 'rate' | 'amount'; onClick: () => void }) {
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
        {negative && <div className="text-red-800">negative — blocking</div>}
      </>
    );
  } else {
    const shown = e.state === 'special' ? `“${String(e.raw)}”` : e.state === 'unparseable' ? `“${String(e.raw)}” (not understood)` : e.state === 'not_stated' ? 'no column' : 'empty';
    content = (
      <span data-value-kind="placeholder" className="text-amber-800">
        not stated: {shown}
        {placeholder && <div className="text-red-800">placeholder only — blocking</div>}
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
