import { useState } from 'react';
import { APP_INFO } from './appInfo.ts';
import type { ExtractionOptions } from './core/extraction/index.ts';
import { type PipelineFailure, type PipelineSuccess, STAGES, runPipeline } from './core/pipeline/runPipeline.ts';
import { readFileBytes } from './lib/readFile.ts';
import { createRuleBasedProvider } from './providers/rule-based/index.ts';
import type { InterpretationProvider } from './providers/types.ts';
import { UploadPanel } from './features/upload/UploadPanel.tsx';
import { Workspace } from './features/review/Workspace.tsx';

type Phase = { name: 'select' } | { name: 'running' } | { name: 'failed'; failure: PipelineFailure } | { name: 'review'; result: PipelineSuccess };

export interface AppProps {
  /** The interpretation provider (the rule-based provider unless a test supplies another). */
  readonly provider?: InterpretationProvider;
}

const defaultProvider = createRuleBasedProvider();

/**
 * The first interface: choose a spreadsheet → see every stage of the pipeline → inspect the full
 * extracted source and review the proposals. Everything runs in this browser; nothing is uploaded.
 */
export default function App({ provider = defaultProvider }: AppProps) {
  const [phase, setPhase] = useState<Phase>({ name: 'select' });
  const [reviewer, setReviewer] = useState('');
  const [runKey, setRunKey] = useState(0);

  const start = async (file: File, options: ExtractionOptions) => {
    setPhase({ name: 'running' });
    try {
      const bytes = await readFileBytes(file);
      const result = await runPipeline({ bytes, fileName: file.name }, provider, options);
      setPhase(result.ok ? { name: 'review', result } : { name: 'failed', failure: result });
      setRunKey((k) => k + 1);
    } catch (e) {
      setPhase({
        name: 'failed',
        failure: { ok: false, stages: [], failedStage: 'file_selection', message: `The file could not be read: ${e instanceof Error ? e.message : String(e)}` },
      });
    }
  };

  const reviewerName = reviewer.trim() === '' ? null : reviewer.trim();

  return (
    <div className="flex h-screen flex-col bg-slate-50 font-sans text-slate-800">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-300 bg-white px-4 py-2">
        <div>
          <h1 className="text-lg font-semibold">{APP_INFO.name}</h1>
          <p className="text-xs text-slate-500">
            {APP_INFO.stage} · <span className="rounded border border-amber-300 bg-amber-50 px-1 text-amber-900">{APP_INFO.processingMode}</span> · files stay on this computer
          </p>
        </div>
        <label className="text-xs">
          Reviewer name (optional, recorded with decisions){' '}
          <input aria-label="Reviewer name" value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="not recorded" className="rounded border px-2 py-1" />
        </label>
      </header>

      <main className={`min-h-0 flex-1 p-3 ${phase.name === 'review' ? 'overflow-hidden' : 'overflow-auto'}`}>
        {(phase.name === 'select' || phase.name === 'running' || phase.name === 'failed') && (
          <>
            <UploadPanel busy={phase.name === 'running'} onStart={start} suggestCsvOptions={phase.name === 'failed' && /^CSV_/.test(phase.failure.code ?? '')} />
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
          </>
        )}
        {phase.name === 'review' && (
          <Workspace key={runKey} result={phase.result} reviewer={reviewerName} provider={provider.info} onStartAgain={() => setPhase({ name: 'select' })} />
        )}
      </main>
    </div>
  );
}
