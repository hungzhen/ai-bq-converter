import { useCallback, useEffect, useRef, useState } from 'react';
import { APP_INFO } from './appInfo.ts';
import type { ExtractionOptions } from './core/extraction/index.ts';
import { sha256Hex } from './core/extraction/hash.ts';
import { type PipelineFailure, type PipelineSuccess, STAGES, runPipeline } from './core/pipeline/runPipeline.ts';
import {
  type SavedReview,
  backupFileName,
  createBackup,
  createReview,
  recordEvent,
  restoreReview,
  sameFingerprint,
} from './core/review/index.ts';
import { readFileBytes } from './lib/readFile.ts';
import { createRuleBasedProvider } from './providers/rule-based/index.ts';
import type { InterpretationProvider } from './providers/types.ts';
import { type ReviewStore, type ReviewSummary, type SavedReviewEntry, createDefaultReviewStore } from './storage/reviewStore.ts';
import { type DuplicateMatch, importReviewBackup } from './storage/importReview.ts';
import { UploadPanel } from './features/upload/UploadPanel.tsx';
import { Workspace } from './features/review/Workspace.tsx';
import { SavedReviews, formatDate } from './features/saved/SavedReviews.tsx';

type Phase =
  | { name: 'select' }
  | { name: 'running' }
  | { name: 'failed'; failure: PipelineFailure }
  /** The chosen file already has saved review(s) with the same fingerprint. */
  | { name: 'existing'; result: PipelineSuccess; options: ExtractionOptions; bytes: Uint8Array; fileName: string; matches: ReviewSummary[] }
  /** Reopening a saved review: waiting for the original file. */
  | { name: 'reopen'; review: SavedReview }
  /** The file chosen to reopen a review is a different document. */
  | { name: 'mismatch'; review: SavedReview; fileName: string; sha256: string; bytes: Uint8Array }
  | { name: 'restore_failed'; message: string; details: readonly string[]; invalidRecord?: boolean }
  | { name: 'review'; result: PipelineSuccess; review: SavedReview };

export interface AppProps {
  /** The interpretation provider (the rule-based provider unless a test supplies another). */
  readonly provider?: InterpretationProvider;
  /** Where reviews are saved (this browser's IndexedDB unless a test supplies another). */
  readonly store?: ReviewStore;
  /** How a backup file is handed to the user (a browser download unless a test supplies another). */
  readonly download?: (fileName: string, text: string) => void;
}

const defaultProvider = createRuleBasedProvider();

function browserDownload(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const newId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `review-${Date.now()}`);
const now = () => new Date().toISOString();
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-GB');

/**
 * The application: choose a spreadsheet (or reopen a saved review) → pipeline → review.
 * Everything runs and is saved in this browser; nothing is uploaded.
 */
export default function App({ provider = defaultProvider, store: givenStore, download = browserDownload }: AppProps) {
  const store = useRef<ReviewStore>(givenStore ?? createDefaultReviewStore()).current;
  const [phase, setPhase] = useState<Phase>({ name: 'select' });
  const [reviewer, setReviewer] = useState('');
  const [entries, setEntries] = useState<SavedReviewEntry[]>([]);
  /** A backup that matches a review already saved here: waiting for "Cancel" or "Import as a separate copy". */
  const [duplicate, setDuplicate] = useState<{ fileName: string; bytes: Uint8Array; matches: readonly DuplicateMatch[] } | null>(null);
  const [saveStatus, setSaveStatus] = useState({ ok: true, message: '' });
  const [importMessage, setImportMessage] = useState<{ ok: boolean; lines: string[] } | null>(null);
  const [runKey, setRunKey] = useState(0);
  const reviewerName = reviewer.trim() === '' ? null : reviewer.trim();

  const refresh = useCallback(async () => {
    try {
      setEntries(await store.list());
    } catch (e) {
      setImportMessage({ ok: false, lines: [`Saved reviews could not be read from this browser: ${e instanceof Error ? e.message : String(e)}`] });
    }
  }, [store]);
  useEffect(() => void refresh(), [refresh]);

  const save = async (review: SavedReview, isNew = false) => {
    try {
      if (isNew && !(await store.add(review))) throw new Error('a saved review with the same id already exists, so nothing was overwritten');
      if (!isNew) await store.put(review);
      setSaveStatus({ ok: true, message: `Saved in this browser at ${time(review.savedAt)}` });
    } catch (e) {
      setSaveStatus({ ok: false, message: `NOT saved: ${e instanceof Error ? e.message : String(e)}. Export a backup now.` });
    }
    void refresh();
  };

  const openReview = async (result: PipelineSuccess, review: SavedReview, isNew = false) => {
    await save(review, isNew);
    setRunKey((k) => k + 1);
    setPhase({ name: 'review', result, review });
  };

  const beginNewReview = (result: PipelineSuccess, options: ExtractionOptions) =>
    openReview(result, createReview(result, { reviewId: newId(), at: now(), reviewer: reviewerName, extractionOptions: options, provider: provider.info }), true);

  /** Restores a saved review onto the given bytes — only when the fingerprint matches. */
  const restoreFromBytes = async (review: SavedReview, bytes: Uint8Array, chosenName: string) => {
    const sha = await sha256Hex(bytes);
    if (!sameFingerprint(review, sha)) {
      setPhase({ name: 'mismatch', review, fileName: chosenName, sha256: sha, bytes });
      return;
    }
    setPhase({ name: 'running' });
    const reread = await runPipeline(
      { bytes, fileName: review.document.fileName, documentId: review.document.id, uploadedAt: review.document.uploadedAt },
      provider,
      review.extractionOptions,
      'extract_only',
    );
    if (!reread.ok) {
      setPhase({ name: 'restore_failed', message: `The original file could not be read again: ${reread.message}`, details: [] });
      return;
    }
    const restored = restoreReview(review, reread);
    if (!restored.ok) {
      setPhase({ name: 'restore_failed', message: restored.message, details: restored.details, invalidRecord: restored.reason === 'invalid_record' || restored.reason === 'invalid_decisions' });
      return;
    }
    await openReview(reread, recordEvent(review, 'review_restored', now(), reviewerName, `Reopened with "${chosenName}" (fingerprint matched; every proposal re-verified).`));
  };

  const startWithFile = async (file: File, options: ExtractionOptions) => {
    setPhase({ name: 'running' });
    try {
      const bytes = await readFileBytes(file);
      const result = await runPipeline({ bytes, fileName: file.name }, provider, options);
      if (!result.ok) return setPhase({ name: 'failed', failure: result });
      const matches = (await store.list()).flatMap((e) => (e.status === 'valid' && e.summary.sha256 === result.extraction.document.sha256 ? [e.summary] : []));
      if (matches.length) return setPhase({ name: 'existing', result, options, bytes, fileName: file.name, matches });
      await beginNewReview(result, options);
    } catch (e) {
      setPhase({ name: 'failed', failure: { ok: false, stages: [], failedStage: 'file_selection', message: `The file could not be read: ${e instanceof Error ? e.message : String(e)}` } });
    }
  };

  const exportReview = async (review: SavedReview) => download(backupFileName(review), await createBackup(review, now()));

  /** Loads a saved review, checking it first. An invalid record is reported and left exactly as stored. */
  const loadChecked = async (id: string): Promise<SavedReview | null> => {
    const loaded = await store.load(id);
    if (!loaded) {
      setImportMessage({ ok: false, lines: ['That saved review is no longer in this browser.'] });
      await refresh();
      return null;
    }
    if (!loaded.ok) {
      setPhase({
        name: 'restore_failed',
        message: 'This saved review did not pass its checks, so it was not opened. It has been kept exactly as stored.',
        details: loaded.problems,
        invalidRecord: true,
      });
      return null;
    }
    return loaded.review;
  };

  const exportStoredRecord = async (id: string) => {
    const raw = await store.getRaw(id);
    if (raw !== undefined) download(`${id.replace(/[^\w.-]+/g, '_')}.stored-record.json`, JSON.stringify(raw, null, 2));
  };

  const runImport = async (fileName: string, bytes: Uint8Array, asCopy: boolean) => {
    setDuplicate(null);
    const outcome = await importReviewBackup(store, bytes, { fileName, at: now(), by: reviewerName, newId, asCopy });
    await refresh();
    if (outcome.status === 'refused') return setImportMessage({ ok: false, lines: [`"${fileName}" was not imported.`, ...outcome.errors] });
    if (outcome.status === 'duplicate') {
      setImportMessage(null);
      return setDuplicate({ fileName, bytes, matches: outcome.matches });
    }
    setImportMessage({
      ok: true,
      lines: [`Imported the review of "${outcome.review.document.fileName}"${outcome.asCopy ? ' as a separate copy (new review id; the existing review was not changed)' : ''}. Reopen it with the original file.`],
    });
  };

  const importBackup = async (file: File) => runImport(file.name, await readFileBytes(file), false);

  const showStart = phase.name === 'select' || phase.name === 'running' || phase.name === 'failed';

  return (
    <div className="flex h-screen flex-col bg-slate-50 font-sans text-slate-800">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-300 bg-white px-4 py-2">
        <div>
          <h1 className="text-lg font-semibold">{APP_INFO.name}</h1>
          <p className="text-xs text-slate-500">
            {APP_INFO.stage} · <span className="rounded border border-amber-300 bg-amber-50 px-1 text-amber-900">{APP_INFO.processingMode}</span> · files and reviews stay in this browser
          </p>
        </div>
        <label className="text-xs">
          Reviewer name (optional, recorded with decisions){' '}
          <input aria-label="Reviewer name" value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="not recorded" className="rounded border px-2 py-1" />
        </label>
      </header>

      <main className={`min-h-0 flex-1 p-3 ${phase.name === 'review' ? 'overflow-hidden' : 'overflow-auto'}`}>
        {showStart && (
          <>
            <UploadPanel busy={phase.name === 'running'} onStart={startWithFile} suggestCsvOptions={phase.name === 'failed' && /^CSV_/.test(phase.failure.code ?? '')} />
            {phase.name === 'running' && <p className="mx-auto mt-4 max-w-2xl text-sm" role="status">Processing… reading, interpreting and verifying.</p>}
            {phase.name === 'failed' && (
              <div className="mx-auto mt-4 max-w-2xl rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900" role="alert" data-testid="pipeline-error">
                <strong>Processing stopped at “{STAGES.find((s) => s.name === phase.failure.failedStage)?.label}”.</strong>
                <p className="mt-1">{phase.failure.message}</p>
                {phase.failure.stages.length > 0 && (
                  <ul className="mt-2 text-xs">
                    {phase.failure.stages.map((s) => (
                      <li key={s.stage}>
                        {s.status === 'done' ? '✓' : s.status === 'failed' ? '✗' : '–'} {STAGES.find((x) => x.name === s.stage)?.label}: {s.message}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-2 text-xs">Nothing was extracted or proposed from this file. Fix the file (or choose CSV settings) and try again.</p>
              </div>
            )}
            <SavedReviews
              entries={entries}
              duplicate={duplicate}
              onImportCopy={() => duplicate && void runImport(duplicate.fileName, duplicate.bytes, true)}
              onCancelImport={() => {
                setDuplicate(null);
                setImportMessage({ ok: true, lines: ['Import cancelled. Nothing was imported or changed.'] });
              }}
              onExportStored={(id) => void exportStoredRecord(id)}
              storeKind={store.kind}
              importMessage={importMessage}
              onImport={(f) => void importBackup(f)}
              onDelete={async (id) => {
                await store.delete(id);
                await refresh();
              }}
              onExport={async (id) => {
                const r = await loadChecked(id);
                if (r) await exportReview(r);
              }}
              onReopen={async (id) => {
                const r = await loadChecked(id);
                if (r) setPhase({ name: 'reopen', review: r });
              }}
            />
          </>
        )}

        {phase.name === 'existing' && (
          <section className="mx-auto max-w-2xl rounded border border-sky-300 bg-sky-50 p-4 text-sm" data-testid="existing-reviews">
            <h2 className="font-semibold">You already have a saved review of this exact file</h2>
            <p className="mt-1 text-xs">“{phase.fileName}” has the same fingerprint ({phase.result.extraction.document.sha256.slice(0, 12)}…) as:</p>
            <ul className="mt-2 space-y-1">
              {phase.matches.map((m) => (
                <li key={m.reviewId} className="flex items-center justify-between rounded bg-white px-2 py-1 text-xs">
                  <span>
                    {m.fileName} · saved {formatDate(m.savedAt)} · {m.counts.approved} approved, {m.counts.rejected} rejected, {m.counts.unresolved} unresolved
                  </span>
                  <button
                    type="button"
                    className="rounded bg-sky-700 px-2 py-0.5 text-white"
                    onClick={async () => {
                      const r = await loadChecked(m.reviewId);
                      if (r) await restoreFromBytes(r, phase.bytes, phase.fileName);
                    }}
                  >
                    Continue this review
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" className="mt-3 rounded border px-3 py-1 text-xs" onClick={() => void beginNewReview(phase.result, phase.options)}>
              Start a new, separate review instead
            </button>
          </section>
        )}

        {phase.name === 'reopen' && (
          <section className="mx-auto max-w-2xl rounded border border-slate-300 bg-white p-4 text-sm" data-testid="reopen-panel">
            <h2 className="font-semibold">Reopen the review of “{phase.review.document.fileName}”</h2>
            <p className="mt-1 text-xs text-slate-600">
              Choose the ORIGINAL file. It must be exactly the same document: its fingerprint must be {phase.review.document.sha256.slice(0, 12)}…. A matching file name is not enough.
              Nothing is restored onto a different file.
            </p>
            <input
              data-testid="reopen-file-input"
              type="file"
              accept=".xlsx,.xls,.csv"
              className="mt-3 text-xs"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) await restoreFromBytes(phase.review, await readFileBytes(f), f.name);
              }}
            />
            <div>
              <button type="button" className="mt-3 rounded border px-3 py-1 text-xs" onClick={() => setPhase({ name: 'select' })}>
                Back
              </button>
            </div>
          </section>
        )}

        {phase.name === 'mismatch' && (
          <section className="mx-auto max-w-2xl rounded border border-red-300 bg-red-50 p-4 text-sm text-red-900" role="alert" data-testid="fingerprint-mismatch">
            <h2 className="font-semibold">This is not the same document — nothing was restored</h2>
            <p className="mt-1 text-xs">
              “{phase.fileName}” has the fingerprint {phase.sha256.slice(0, 12)}…, but the saved review of “{phase.review.document.fileName}” is for {phase.review.document.sha256.slice(0, 12)}….
              The saved decisions were NOT applied to this file, and no cells were matched. The saved review is kept unchanged.
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <button type="button" className="rounded border border-red-400 bg-white px-3 py-1" onClick={() => setPhase({ name: 'reopen', review: phase.review })}>
                Choose a different file
              </button>
              <button
                type="button"
                className="rounded border bg-white px-3 py-1"
                onClick={async () => {
                  setPhase({ name: 'running' });
                  const result = await runPipeline({ bytes: phase.bytes, fileName: phase.fileName }, provider);
                  if (!result.ok) return setPhase({ name: 'failed', failure: result });
                  await beginNewReview(result, {});
                }}
              >
                Review “{phase.fileName}” as a new, separate review
              </button>
              <button type="button" className="rounded border bg-white px-3 py-1" onClick={() => setPhase({ name: 'select' })}>
                Back to saved reviews
              </button>
            </div>
          </section>
        )}

        {phase.name === 'restore_failed' && (
          <section className="mx-auto max-w-2xl rounded border border-red-300 bg-red-50 p-4 text-sm text-red-900" role="alert" data-testid="restore-failed">
            <h2 className="font-semibold">The review could not be restored</h2>
            <p className="mt-1">{phase.message}</p>
            {phase.details.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-xs">
                {phase.details.slice(0, 20).map((d, n) => (
                  <li key={n}>{d}</li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs">The saved review is kept unchanged.</p>
            {phase.invalidRecord && (
              <p className="mt-1 text-xs" data-testid="invalid-record-help">
                Nothing was deleted, repaired or approved. To recover: export the stored record as it is (Saved reviews → “Export stored record”) to keep a copy;
                import an earlier review backup of this document if you have one; or start a new review from the original file.
              </p>
            )}
            <button type="button" className="mt-3 rounded border bg-white px-3 py-1 text-xs" onClick={() => setPhase({ name: 'select' })}>
              Back to saved reviews
            </button>
          </section>
        )}

        {phase.name === 'review' && (
          <Workspace
            key={runKey}
            result={phase.result}
            review={phase.review}
            saveStatus={saveStatus}
            onReviewChange={(review) => {
              setPhase({ name: 'review', result: phase.result, review });
              void save(review);
            }}
            onExport={() => void exportReview(phase.review)}
            reviewer={reviewerName}
            provider={provider.info}
            onStartAgain={() => {
              setPhase({ name: 'select' });
              void refresh();
            }}
          />
        )}
      </main>
    </div>
  );
}
