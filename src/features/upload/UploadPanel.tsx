/**
 * FIRST SCREEN — choose (or drag in) one .xlsx, .xls or .csv file, check its name and size,
 * remove it if wrong, and start processing. The file stays on this computer.
 */
import { useRef, useState, type DragEvent } from 'react';
import type { CsvDelimiter, CsvEncoding, ExtractionOptions } from '../../core/extraction/index.ts';
import { formatSize } from '../../lib/readFile.ts';

export interface UploadPanelProps {
  readonly busy: boolean;
  readonly onStart: (file: File, options: ExtractionOptions) => void;
  /** Shown after a failed attempt, e.g. to choose the CSV delimiter. */
  readonly suggestCsvOptions?: boolean;
}

const ACCEPT = '.xlsx,.xls,.csv';

export function UploadPanel({ busy, onStart, suggestCsvOptions = false }: UploadPanelProps) {
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [delimiter, setDelimiter] = useState<CsvDelimiter | ''>('');
  const [encoding, setEncoding] = useState<CsvEncoding | ''>('');
  const input = useRef<HTMLInputElement>(null);
  const isCsv = !!file && /\.csv$/i.test(file.name);

  const choose = (f: File | undefined) => {
    if (f) setFile(f);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    choose(e.dataTransfer.files[0]);
  };
  const start = () => {
    if (!file) return;
    const csv = { ...(delimiter ? { delimiter } : {}), ...(encoding ? { encoding } : {}) };
    onStart(file, isCsv && Object.keys(csv).length ? { csv } : {});
  };

  return (
    <section aria-label="Choose a spreadsheet" className="mx-auto max-w-2xl">
      <h2 className="text-lg font-semibold">1. Choose a spreadsheet</h2>
      <p className="mt-1 text-sm text-slate-600">
        A BQ, contractor working file or progress claim as <strong>.xlsx</strong>, <strong>.xls</strong> or <strong>.csv</strong>.
        It is read on this computer only — it is not uploaded anywhere, and it is never changed.
      </p>

      <div
        data-testid="drop-zone"
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`mt-4 rounded-lg border-2 border-dashed p-8 text-center ${dragging ? 'border-sky-500 bg-sky-50' : 'border-slate-300 bg-white'}`}
      >
        <p className="text-sm text-slate-700">Drag a file here, or</p>
        <button type="button" onClick={() => input.current?.click()} className="mt-2 rounded border border-slate-400 bg-white px-3 py-1.5 text-sm hover:bg-slate-50">
          Choose a file…
        </button>
        <input
          ref={input}
          data-testid="file-input"
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            choose(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>

      {file && (
        <div className="mt-4 flex items-center justify-between rounded border border-slate-200 bg-white px-4 py-3" data-testid="selected-file">
          <div>
            <div className="font-medium">{file.name}</div>
            <div className="text-xs text-slate-500">{formatSize(file.size)}</div>
          </div>
          <button type="button" onClick={() => setFile(null)} disabled={busy} className="text-sm text-red-700 underline disabled:opacity-50">
            Remove
          </button>
        </div>
      )}

      {file && isCsv && (
        <fieldset className={`mt-3 rounded border px-4 py-3 text-sm ${suggestCsvOptions ? 'border-amber-400 bg-amber-50' : 'border-slate-200 bg-white'}`}>
          <legend className="px-1 text-xs font-medium text-slate-600">CSV settings (leave on "Detect" unless the file could not be read)</legend>
          <label className="mr-4">
            Delimiter{' '}
            <select aria-label="CSV delimiter" value={delimiter} onChange={(e) => setDelimiter(e.target.value as CsvDelimiter | '')} className="rounded border px-1">
              <option value="">Detect</option>
              <option value=",">Comma ,</option>
              <option value=";">Semicolon ;</option>
              <option value={'\t'}>Tab</option>
              <option value="|">Vertical bar |</option>
            </select>
          </label>
          <label>
            Encoding{' '}
            <select aria-label="CSV encoding" value={encoding} onChange={(e) => setEncoding(e.target.value as CsvEncoding | '')} className="rounded border px-1">
              <option value="">Detect (UTF-8)</option>
              <option value="windows-1252">Windows-1252</option>
              <option value="utf-16le">UTF-16 LE</option>
              <option value="utf-16be">UTF-16 BE</option>
            </select>
          </label>
        </fieldset>
      )}

      <button type="button" onClick={start} disabled={!file || busy} className="mt-4 rounded bg-sky-700 px-4 py-2 text-sm font-medium text-white disabled:bg-slate-300">
        {busy ? 'Processing…' : 'Start extraction'}
      </button>
    </section>
  );
}
