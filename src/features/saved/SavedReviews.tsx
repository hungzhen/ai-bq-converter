/**
 * SAVED REVIEWS — reviews kept in this browser: name, last saved, progress and counts, with
 * Reopen (choose the original file again), Export backup, Delete (after confirmation) and
 * Import backup.
 *
 * A stored record that fails its checks is listed as INVALID, with the reasons. It is kept exactly
 * as stored: it can be exported as it is, or deleted after confirmation — never repaired, opened
 * or approved automatically.
 */
import { useRef, useState } from 'react';
import type { SavedReviewEntry } from '../../storage/reviewStore.ts';
import type { DuplicateMatch } from '../../storage/importReview.ts';

export interface SavedReviewsProps {
  readonly entries: readonly SavedReviewEntry[];
  /** A backup that matches a review already saved here, waiting for the person's choice. */
  readonly duplicate: { readonly fileName: string; readonly matches: readonly DuplicateMatch[] } | null;
  readonly onImportCopy: () => void;
  readonly onCancelImport: () => void;
  /** Export an invalid record exactly as stored. */
  readonly onExportStored: (reviewId: string) => void;
  readonly storeKind: 'indexeddb' | 'memory';
  readonly onReopen: (reviewId: string) => void;
  readonly onExport: (reviewId: string) => void;
  readonly onDelete: (reviewId: string) => void;
  readonly onImport: (file: File) => void;
  /** Result of the last import (success message or errors). */
  readonly importMessage: { readonly ok: boolean; readonly lines: readonly string[] } | null;
}

export const formatDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
};

export function SavedReviews({ entries, duplicate, onImportCopy, onCancelImport, onExportStored, storeKind, onReopen, onExport, onDelete, onImport, importMessage }: SavedReviewsProps) {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const invalid = entries.filter((e) => e.status === 'invalid');

  const deleteControl = (id: string, normal: React.ReactNode) =>
    confirmDelete === id ? (
      <span data-testid="delete-confirm">
        Delete this saved review from this browser? This cannot be undone (export it first if unsure).{' '}
        <button type="button" onClick={() => { setConfirmDelete(null); onDelete(id); }} className="rounded bg-red-700 px-2 text-white">
          Delete
        </button>{' '}
        <button type="button" onClick={() => setConfirmDelete(null)} className="rounded border px-2">
          Cancel
        </button>
      </span>
    ) : (
      normal
    );

  return (
    <section aria-label="Saved reviews" className="mx-auto mt-8 max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Saved reviews</h2>
        <span>
          <button type="button" onClick={() => input.current?.click()} className="rounded border border-slate-400 bg-white px-3 py-1 text-sm">
            Import review backup…
          </button>
          <input
            ref={input}
            data-testid="backup-input"
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImport(f);
              e.target.value = '';
            }}
          />
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-600" data-testid="storage-notice">
        {storeKind === 'indexeddb'
          ? 'Reviews are saved in this browser, on this computer only — nothing is sent anywhere. They are lost if the browser’s data is cleared, and they are not available in another browser or on another computer. Export a backup to keep a copy.'
          : 'This browser does not offer local storage: reviews are kept only while this page is open. Export a backup to keep a copy.'}
      </p>

      {importMessage && (
        <div role={importMessage.ok ? 'status' : 'alert'} data-testid="import-message" className={`mt-2 rounded border px-3 py-2 text-xs ${importMessage.ok ? 'border-green-300 bg-green-50 text-green-900' : 'border-red-300 bg-red-50 text-red-900'}`}>
          {importMessage.lines.map((l, n) => (
            <div key={n}>{l}</div>
          ))}
        </div>
      )}

      {duplicate && (
        <div role="alert" data-testid="duplicate-import" className="mt-2 rounded border border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          <strong>“{duplicate.fileName}” matches a review already saved in this browser. Nothing has been imported or changed.</strong>
          <ul className="mt-1 list-disc pl-5">
            {duplicate.matches.map((m) => (
              <li key={`${m.reviewId}-${m.reason}`}>
                {m.reason === 'same_review_id'
                  ? `The saved review of “${m.fileName ?? 'unknown document'}” is this same review${m.unchanged ? ' and is identical to the backup' : ' (it may have newer or different decisions than the backup)'}.`
                  : `This backup was already imported as the saved review of “${m.fileName ?? 'unknown document'}”.`}
              </li>
            ))}
          </ul>
          <p className="mt-1">The existing review will not be overwritten. You can cancel, or deliberately import the backup as a separate copy with a new review id.</p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={onCancelImport} className="rounded border border-slate-400 bg-white px-3 py-1">
              Cancel
            </button>
            <button type="button" onClick={onImportCopy} className="rounded bg-amber-700 px-3 py-1 text-white">
              Import as a separate copy
            </button>
          </div>
        </div>
      )}

      {invalid.length > 0 && (
        <div role="alert" data-testid="invalid-reviews-warning" className="mt-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900">
          <strong>{invalid.length} saved review record(s) did not pass their checks and cannot be opened.</strong> They have been kept exactly as stored — nothing was
          deleted, repaired or approved. To recover: use “Export stored record” to keep a copy of the record as it is; import an earlier review backup of the same
          document if you have one; or start a new review from the original file. Delete a record only when you no longer need it.
        </div>
      )}

      {entries.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No saved reviews in this browser yet.</p>
      ) : (
        <table className="mt-3 w-full border-collapse bg-white text-sm" data-testid="saved-reviews">
          <thead>
            <tr className="bg-slate-100 text-left text-xs text-slate-600">
              <th className="border px-2 py-1">Document</th>
              <th className="border px-2 py-1">Last saved</th>
              <th className="border px-2 py-1">Progress</th>
              <th className="border px-2 py-1">Approved</th>
              <th className="border px-2 py-1">Rejected</th>
              <th className="border px-2 py-1">Unresolved</th>
              <th className="border px-2 py-1">Actions</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              if (e.status === 'invalid') {
                return (
                  <tr key={e.reviewId} data-review-id={e.reviewId} data-invalid="true" className="bg-red-50">
                    <td className="border px-2 py-1" colSpan={6}>
                      <div className="font-medium text-red-900">⚠ {e.fileName ?? 'Unknown document'} — invalid saved record (kept as stored)</div>
                      <div className="text-[11px] text-slate-600">record id {e.reviewId}{e.savedAt ? ` · last saved ${formatDate(e.savedAt)}` : ''}</div>
                      <details className="text-[11px] text-red-900">
                        <summary>Why it cannot be opened ({e.problems.length} problem(s))</summary>
                        <ul className="list-disc pl-5">
                          {e.problems.slice(0, 15).map((p, n) => (
                            <li key={n}>{p}</li>
                          ))}
                          {e.problems.length > 15 && <li>… and {e.problems.length - 15} more.</li>}
                        </ul>
                      </details>
                    </td>
                    <td className="border px-2 py-1 text-xs">
                      {deleteControl(
                        e.reviewId,
                        <span className="flex flex-wrap gap-1">
                          <button type="button" onClick={() => onExportStored(e.reviewId)} className="rounded border px-2 py-0.5">Export stored record</button>
                          <button type="button" onClick={() => setConfirmDelete(e.reviewId)} className="rounded border border-red-400 px-2 py-0.5 text-red-800">Delete…</button>
                        </span>,
                      )}
                    </td>
                  </tr>
                );
              }
              const s = e.summary;
              const done = s.counts.total ? Math.round(((s.counts.approved + s.counts.rejected) / s.counts.total) * 100) : 0;
              return (
                <tr key={s.reviewId} data-review-id={s.reviewId}>
                  <td className="border px-2 py-1">
                    <div className="font-medium">{s.fileName}</div>
                    <div className="text-[11px] text-slate-500">fingerprint {s.sha256.slice(0, 12)}… · reviewer {s.reviewer ?? 'not recorded'} (as typed, not verified)</div>
                  </td>
                  <td className="border px-2 py-1 text-xs">{formatDate(s.savedAt)}</td>
                  <td className="border px-2 py-1 text-xs">
                    <div className="h-2 w-24 rounded bg-slate-200">
                      <div className="h-2 rounded bg-green-600" style={{ width: `${done}%` }} />
                    </div>
                    {done}% decided
                  </td>
                  <td className="border px-2 py-1 text-center">{s.counts.approved}</td>
                  <td className="border px-2 py-1 text-center">{s.counts.rejected}</td>
                  <td className="border px-2 py-1 text-center">{s.counts.unresolved}</td>
                  <td className="border px-2 py-1 text-xs">
                    {deleteControl(
                      s.reviewId,
                      <span className="flex flex-wrap gap-1">
                        <button type="button" onClick={() => onReopen(s.reviewId)} className="rounded bg-sky-700 px-2 py-0.5 text-white">Reopen</button>
                        <button type="button" onClick={() => onExport(s.reviewId)} className="rounded border px-2 py-0.5">Export</button>
                        <button type="button" onClick={() => setConfirmDelete(s.reviewId)} className="rounded border border-red-400 px-2 py-0.5 text-red-800">Delete…</button>
                      </span>,
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
