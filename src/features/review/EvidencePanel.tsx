/**
 * EVIDENCE PANEL — everything behind one proposal, and the decision controls.
 *
 * Shows: the proposed interpretation, its confidence TOGETHER WITH the cited cells (exact
 * worksheet / cell reference and the exact quoted text — click one to see it in the source),
 * the explanation, the alternatives, and every verification finding.
 *
 * Decisions (recorded separately; the source data is never changed):
 *   - Approve (the proposed reading, or a chosen alternative). Not possible with a blocking
 *     finding; with warnings, a note acknowledging them is required.
 *   - Reject, with an optional note.
 *   - Reject and record a correction (your own value for the same cells), with a note.
 *   - Or leave it unresolved.
 */
import { useEffect, useState } from 'react';
import {
  BQ_ROW_CLASSES_FOR_CHECKS,
  type InterpretationContext,
  type Proposal,
  ProposalError,
  approveProposal,
  correctProposal,
  rejectProposal,
} from '../../core/evidence/index.ts';
import { type ExtractedTable, SOURCE_DOCUMENT_TYPES } from '../../core/models/index.ts';
import { COLUMN_ROLES, RULE_BASED_LABEL, AI_LABEL } from '../../providers/types.ts';
import { COLUMN_ROLE_LABEL, DOCUMENT_TYPE_LABEL, KIND_LABEL, ROW_CLASS_LABEL, cellLabel, describeValue, percent } from './labels.ts';
import { StateChip } from './ProposalList.tsx';

export interface EvidencePanelProps {
  readonly proposal: Proposal;
  readonly tables: readonly ExtractedTable[];
  readonly reviewer: string | null;
  readonly verificationContext: InterpretationContext;
  readonly onDecision: (updated: Proposal) => void;
  readonly onCitationClick: (tableId: string, rowIndex: number, columnIndex?: number) => void;
}

const severityStyle = { blocking: 'border-red-300 bg-red-50 text-red-900', warning: 'border-amber-300 bg-amber-50 text-amber-900', info: 'border-slate-200 bg-slate-50 text-slate-700' };

/** The values a person may choose as a correction, for the kinds where that makes sense. */
function correctionOptions(p: Proposal): { value: string; label: string }[] | null {
  switch (p.interpretation.decisionKind) {
    case 'documentType':
      return SOURCE_DOCUMENT_TYPES.map((v) => ({ value: v, label: DOCUMENT_TYPE_LABEL[v] }));
    case 'columnRole':
      return COLUMN_ROLES.map((v) => ({ value: v, label: COLUMN_ROLE_LABEL[v] }));
    case 'rowClass':
      return BQ_ROW_CLASSES_FOR_CHECKS.map((v) => ({ value: v, label: ROW_CLASS_LABEL[v] }));
    default:
      return null;
  }
}

function correctedValue(p: Proposal, chosen: string): unknown {
  const v = p.interpretation.value as unknown as Record<string, unknown>;
  switch (p.interpretation.decisionKind) {
    case 'documentType':
      return { documentType: chosen };
    case 'columnRole':
      return { ...v, role: chosen };
    case 'rowClass':
      return { ...v, rowClass: chosen };
    default:
      return v;
  }
}

export function EvidencePanel({ proposal: p, tables, reviewer, verificationContext, onDecision, onCitationClick }: EvidencePanelProps) {
  const [note, setNote] = useState('');
  const [correction, setCorrection] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setNote('');
    setCorrection('');
    setError(null);
  }, [p.id]);

  const i = p.interpretation;
  const findings = p.verification.findings;
  const blocking = findings.filter((f) => f.severity === 'blocking');
  const warnings = findings.filter((f) => f.severity === 'warning');
  const open = p.status === 'proposed';
  const needsNote = warnings.length > 0 && note.trim() === '';
  const alternatives = i.alternatives ?? [];
  const options = correctionOptions(p);
  const decision = () => ({ by: reviewer, at: new Date().toISOString(), ...(note.trim() ? { note: note.trim() } : {}) });

  const act = (fn: () => Proposal) => {
    try {
      setError(null);
      onDecision(fn());
    } catch (e) {
      setError(e instanceof ProposalError ? e.message : String(e));
    }
  };

  return (
    <section aria-label="Evidence and decision" className="space-y-3 text-sm" data-testid="evidence-panel">
      <header>
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">{KIND_LABEL[i.decisionKind]}</h3>
          <StateChip p={p} />
        </div>
        <p className="text-xs text-slate-500">{i.method === 'ai' ? AI_LABEL : RULE_BASED_LABEL} · {i.providerId}</p>
      </header>

      <div className="rounded border border-dashed border-sky-400 bg-sky-50 p-2">
        <div className="text-xs font-medium text-sky-800">Proposed interpretation</div>
        <div data-testid="proposed-value">{describeValue(i.decisionKind, i.value, tables)}</div>
        <div className="mt-1 text-xs text-slate-700">
          Confidence <strong>{percent(i.confidence)}</strong>, based on the {i.evidence.length} cited source cell(s) below.
        </div>
      </div>

      <div>
        <div className="text-xs font-medium text-slate-600">Explanation</div>
        <p data-testid="explanation">{i.reasoning}</p>
      </div>

      <div>
        <div className="text-xs font-medium text-slate-600">Source evidence (exact text from the file)</div>
        <table className="mt-1 w-full border-collapse text-xs" data-testid="evidence-table">
          <thead>
            <tr className="bg-slate-100 text-left">
              <th className="border px-1">Worksheet / cell</th>
              <th className="border px-1">Quoted text</th>
            </tr>
          </thead>
          <tbody>
            {i.evidence.map((ref, n) => {
              const table = tables.find((t) => t.id === ref.tableId);
              return (
                <tr key={n}>
                  <td className="border px-1">
                    <button type="button" className="text-sky-700 underline" onClick={() => onCitationClick(ref.tableId, ref.rowIndex, ref.columnIndex)}>
                      {cellLabel(table, ref.rowIndex, ref.columnIndex)}
                    </button>
                  </td>
                  <td className="border px-1 font-mono">{i.quotedText ? `“${i.quotedText[n]}”` : <span className="font-sans text-slate-500">(whole row — nothing to quote)</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {alternatives.length > 0 && (
        <div>
          <div className="text-xs font-medium text-slate-600">Alternative interpretations</div>
          <ul className="mt-1 space-y-1">
            {alternatives.map((a, n) => (
              <li key={n} className="rounded border border-slate-200 p-2 text-xs">
                <div className="font-medium">{describeValue(i.decisionKind, a.value, tables)}</div>
                <div className="text-slate-600">Confidence {percent(a.confidence)} — {a.reasoning}</div>
                {open && p.verification.ok && (
                  <button type="button" disabled={needsNote} onClick={() => act(() => approveProposal(p, decision(), n))} className="mt-1 rounded border border-green-700 px-2 py-0.5 text-green-800 disabled:opacity-40">
                    Approve this alternative
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <div className="text-xs font-medium text-slate-600">Verification findings</div>
        {findings.length === 0 ? (
          <p className="text-xs text-slate-500">No findings: the cited cells exist, belong to this document and match the quoted text.</p>
        ) : (
          <ul className="mt-1 space-y-1" data-testid="findings">
            {findings.map((f, n) => (
              <li key={n} className={`rounded border px-2 py-1 text-xs ${severityStyle[f.severity]}`}>
                <strong className="uppercase">{f.severity}</strong> {f.code}: {f.message}
              </li>
            ))}
          </ul>
        )}
      </div>

      {p.status !== 'proposed' && p.decision && (
        <div className="rounded border border-slate-300 bg-slate-50 p-2 text-xs" data-testid="decision-record">
          <strong>{p.status === 'approved' ? 'Approved' : 'Rejected'}</strong> by {p.decision.by ?? 'not recorded'} at {p.decision.at}
          {p.status === 'approved' && p.chosen !== undefined && (p.chosen === 'primary' ? ' — the proposed reading' : ` — alternative ${(p.chosen as number) + 1}: ${describeValue(i.decisionKind, alternatives[p.chosen as number]!.value, tables)}`)}
          {p.correction && <div>Correction: {describeValue(i.decisionKind, p.correction.value, tables)}</div>}
          {p.decision.note && <div>Note: {p.decision.note}</div>}
        </div>
      )}

      {open && (
        <div className="space-y-2 rounded border border-slate-300 p-2" data-testid="decision-controls">
          <label className="block text-xs">
            Note {warnings.length > 0 ? <strong className="text-amber-800">(required to acknowledge the warnings)</strong> : '(optional)'}
            <textarea aria-label="Decision note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="mt-1 w-full rounded border px-1" />
          </label>
          {blocking.length > 0 && <p className="text-xs text-red-800">This proposal failed verification and cannot be approved. You can reject it.</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={blocking.length > 0 || needsNote}
              onClick={() => act(() => approveProposal(p, decision(), alternatives.length ? 'primary' : undefined))}
              className="rounded bg-green-700 px-3 py-1 text-xs font-medium text-white disabled:bg-slate-300"
            >
              {alternatives.length ? 'Approve the proposed reading' : 'Approve'}
            </button>
            <button type="button" onClick={() => act(() => rejectProposal(p, decision()))} className="rounded bg-slate-700 px-3 py-1 text-xs font-medium text-white">
              Reject
            </button>
            <span className="self-center text-xs text-slate-500">or leave it unresolved</span>
          </div>
          {needsNote && blocking.length === 0 && <p className="text-xs text-amber-800">Approval needs a note acknowledging the warning(s).</p>}
          {options && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <label>
                Correct to{' '}
                <select aria-label="Correction" value={correction} onChange={(e) => setCorrection(e.target.value)} className="rounded border px-1">
                  <option value="">— choose —</option>
                  {options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={!correction || note.trim() === ''}
                onClick={() => act(() => correctProposal(p, decision(), correctedValue(p, correction) as never, verificationContext))}
                className="rounded border border-slate-700 px-2 py-0.5 disabled:opacity-40"
              >
                Reject and record this correction
              </button>
              {correction && note.trim() === '' && <span className="text-slate-500">(a note explaining the correction is required)</span>}
            </div>
          )}
          {error && <p role="alert" className="text-xs text-red-800">{error}</p>}
        </div>
      )}
    </section>
  );
}
