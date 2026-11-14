import { APP_INFO } from './appInfo.ts';

/**
 * Placeholder screen for Stage 2A. It only shows that the project runs.
 * The first working screen (upload → extracted table → proposals) arrives in Stage 2H.
 */
export default function App() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 font-sans text-slate-800">
      <h1 className="text-2xl font-semibold">{APP_INFO.name}</h1>
      <p className="mt-1 text-sm text-slate-500">{APP_INFO.stage}</p>

      <p className="mt-6 inline-block rounded border border-amber-300 bg-amber-50 px-3 py-1 text-sm text-amber-900">
        {APP_INFO.processingMode}
      </p>

      <p className="mt-6 text-sm leading-6">
        The project foundation is in place. Document upload and processing are not available yet.
      </p>
    </main>
  );
}
