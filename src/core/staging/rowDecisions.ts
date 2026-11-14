/**
 * DRAFT-ROW DECISIONS (Stage 2K) — resolving blocking issues and approving draft rows.
 *
 * Nothing here changes a value. A draft row is rebuilt from the review's decisions every time;
 * these functions record what a person decided ABOUT it, in the saved review, with history.
 *
 * RULES (Stage 2K decisions)
 *   1. A placeholder figure can be resolved only by confirming that the document does not state
 *      it; it stays BLANK in the eventual export. It is never a zero or a supplied figure.
 *   2. A negative value cannot be resolved. Such a row can only be EXCLUDED from the upload; its
 *      value stays negative (e.g. -5000) and stays in the reconciliation with its evidence.
 *   3. Bulk approval only for rows with no issues at all, after an explicit confirmation.
 *   4. Each resolution and decision stores a fingerprint of the row's source-derived content.
 *      If the row changes (a review decision changed it), they become OUTDATED: shown as such,
 *      with what changed, and must be redone. The earlier ones stay in the history.
 *   5. Blocking issues are resolved one by one. Warnings are acknowledged by a note when the row
 *      is approved.
 *   - A row with an unresolved blocking issue can never be approved.
 *   - Excluding a row needs a reason. It never deletes or alters the draft row.
 *   - Missing project details are never resolved with a note: they must be entered.
 *   - Reviewer names are typed in, not verified. The history is not tamper-proof.
 */
import { stableKey } from '../evidence/findings.ts';
import { sha256HexSync } from '../../lib/sha256Sync.ts';
import { type FieldEvidence, type ValidationIssue, hasUsableValue } from '../models/index.ts';
import {
  type DraftIssueResolution,
  type DraftRowDecision,
  type DraftRowState,
  type DraftRowStatus,
  type IssueResolutionKind,
  RESOLUTION_FOR_ISSUE,
  type RowContentSummary,
  type SavedReview,
  recordDraftRowChange,
} from '../review/reviewRecord.ts';
import type { DraftResult, DraftRow, TableDrafts } from './buildDrafts.ts';

export class DraftRowDecisionError extends Error {
  override name = 'DraftRowDecisionError';
}

// ---------------------------------------------------------------------------------------------
// What a decision is about: the row's source-derived content
// ---------------------------------------------------------------------------------------------

/** Item fields that do not come from the source (project details, dates, running number). */
const NOT_SOURCE_DERIVED = ['projectId', 'projectName', 'projectYear', 'projectRef', 'location', 'dateCreated', 'dateUpdated', 'sourceSequence'];
const isProjectIssue = (i: ValidationIssue) => i.code === 'PROJECT_NAME_NOT_ENTERED' || i.code === 'PROJECT_YEAR_NOT_ENTERED';

function omit(o: object, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
}

/** The row's source-derived content: values, evidence, sources, issues, headings, trade labels. */
function sourceContent(d: DraftRow): unknown {
  const r = d.row;
  return {
    rowClass: r.rowClass,
    item: omit(r.item, NOT_SOURCE_DERIVED),
    evidence: omit(r.evidence, ['projectYear']),
    placeholders: r.placeholders.filter((p) => p.field !== 'projectName' && p.field !== 'projectYear'),
    issues: r.issues.filter((i) => !isProjectIssue(i)).map((i) => ({ id: i.id, code: i.code, severity: i.severity, field: i.field ?? null, message: i.message, sources: i.sources })),
    sources: r.sources,
    extraColumns: r.extraColumns,
    classification: r.proposals.map((p) => ({ field: p.field, value: p.value, status: p.status })),
    descriptionParts: d.descriptionParts,
    continuationRowIndexes: d.continuationRowIndexes,
    unit: d.unit,
  };
}

/** Fingerprint of a draft row's source-derived content (SHA-256). Same content = same fingerprint. */
export const rowFingerprint = (d: DraftRow): string => sha256HexSync(stableKey(sourceContent(d)));

/** How a figure reads: the value, "0 (stated as 0)", or "not stated (…)" — never a bare 0 for a placeholder. */
export function figureText(e: FieldEvidence): string {
  if (hasUsableValue(e)) return e.state === 'zero' ? '0 (stated as 0)' : String(e.parsed);
  const what = e.state === 'special' ? `"${String(e.raw)}"` : e.state === 'unparseable' ? `"${String(e.raw)}" not understood` : e.state === 'not_stated' ? 'no column' : 'empty';
  return `not stated (${what})`;
}

/** A readable summary kept with each decision, to explain later what changed. */
export function rowSummary(d: DraftRow): RowContentSummary {
  const r = d.row;
  const text = (e: FieldEvidence | undefined) => (e && hasUsableValue(e) ? String(e.parsed) : 'not stated');
  return {
    'Item no.': text(r.evidence.itemNo),
    Description: text(r.evidence.description),
    Unit: text(r.evidence.unit),
    Qty: figureText(r.evidence.quantity),
    Rate: figureText(r.evidence.rate),
    Amount: figureText(r.evidence.amount),
    Headings: [r.item.billDescription, r.item.sectionDescription, r.item.mainHeading, r.item.subheading, r.item.secondarySubheading].filter(Boolean).join(' › ') || '—',
    Trade: [r.item.tradeWork, r.item.subTrade, r.item.costItem, r.item.element].filter(Boolean).join(' / ') || '—',
    'Row type': r.rowClass,
    'Continuation rows': d.continuationRowIndexes.map((i) => `Row ${i + 1}`).join(', ') || '—',
    Issues: r.issues.filter((i) => !isProjectIssue(i)).map((i) => `${i.code}${i.field ? `(${i.field})` : ''}`).join(', ') || '—',
  };
}

/** Plain-English list of what changed between a decision's summary and the row now. */
export function describeChanges(then: RowContentSummary, now: RowContentSummary): string[] {
  const changes = Object.keys({ ...then, ...now })
    .filter((k) => then[k] !== now[k])
    .map((k) => `${k}: "${then[k] ?? '—'}" → "${now[k] ?? '—'}"`);
  return changes.length ? changes : ['Other source-derived details changed (evidence, cell references or the cells it was read from).'];
}

// ---------------------------------------------------------------------------------------------
// The state of one row
// ---------------------------------------------------------------------------------------------

export interface IssueView {
  readonly issue: ValidationIssue;
  /** How a person may resolve it (null: it cannot be resolved with a note). */
  readonly resolvable: IssueResolutionKind | null;
  /** Why it cannot be resolved with a note (when resolvable is null). */
  readonly howToClear: string | null;
  readonly resolution: DraftIssueResolution | null;
  readonly outdated: boolean;
  readonly changes: readonly string[];
}

export type RowEffectiveStatus = 'pending' | 'approved' | 'needs_changes' | 'excluded' | 'outdated';

export interface RowView {
  readonly draft: DraftRow;
  readonly state: DraftRowState | null;
  readonly fingerprint: string;
  readonly summary: RowContentSummary;
  readonly blocking: readonly IssueView[];
  readonly warnings: readonly ValidationIssue[];
  readonly decision: { readonly record: DraftRowDecision; readonly outdated: boolean; readonly changes: readonly string[] } | null;
  readonly effective: RowEffectiveStatus;
  readonly unresolvedBlocking: readonly ValidationIssue[];
  /** Why the row cannot be approved now (empty = it can). */
  readonly approvalBlockers: readonly string[];
}

export function resolvableAs(issue: ValidationIssue): { kind: IssueResolutionKind | null; howToClear: string | null } {
  if (issue.severity !== 'blocking') return { kind: null, howToClear: null };
  if (issue.code === RESOLUTION_FOR_ISSUE.confirmed_not_stated && ['quantity', 'rate', 'amount'].includes(issue.field ?? '')) return { kind: 'confirmed_not_stated', howToClear: null };
  if (issue.code === RESOLUTION_FOR_ISSUE.confirmed_not_part_of_item) return { kind: 'confirmed_not_part_of_item', howToClear: null };
  if (issue.code === 'NEGATIVE_VALUE') return { kind: null, howToClear: 'A negative value cannot be resolved. The row can only be excluded from the upload; its value stays negative.' };
  if (isProjectIssue(issue)) return { kind: null, howToClear: 'Enter the project details above.' };
  return { kind: null, howToClear: 'Change the review decision behind it, or exclude the row from the upload.' };
}

export function viewRow(draft: DraftRow, state: DraftRowState | null): RowView {
  const fingerprint = rowFingerprint(draft);
  const summary = rowSummary(draft);
  const issues = draft.row.issues;
  const blocking: IssueView[] = issues
    .filter((i) => i.severity === 'blocking')
    .map((issue) => {
      const { kind, howToClear } = resolvableAs(issue);
      const resolution = state?.resolutions.find((r) => r.issueId === issue.id) ?? null;
      const outdated = resolution !== null && (resolution.rowFingerprint !== fingerprint || resolution.kind !== kind);
      return { issue, resolvable: kind, howToClear, resolution, outdated, changes: resolution && outdated ? describeChanges(resolution.contentSummary, summary) : [] };
    });
  const unresolvedBlocking = blocking.filter((b) => !b.resolution || b.outdated).map((b) => b.issue);
  const warnings = issues.filter((i) => i.severity === 'warning');

  let decision: RowView['decision'] = null;
  if (state?.decision) {
    const record = state.decision;
    let outdated = record.rowFingerprint !== fingerprint;
    let changes = outdated ? describeChanges(record.contentSummary, summary) : [];
    // Defensive: an approval is never valid while a blocking issue is unresolved.
    if (!outdated && record.status === 'approved' && unresolvedBlocking.length > 0) {
      outdated = true;
      changes = [`The approval is not valid: ${unresolvedBlocking.length} blocking issue(s) are unresolved.`];
    }
    decision = { record, outdated, changes };
  }
  const anyOutdated = (decision?.outdated ?? false) || blocking.some((b) => b.outdated);
  const effective: RowEffectiveStatus = decision && !decision.outdated ? decision.record.status : anyOutdated ? 'outdated' : 'pending';

  const approvalBlockers: string[] = [];
  if (decision && !decision.outdated) approvalBlockers.push(`Already ${decision.record.status.replace('_', ' ')}. Change this decision first.`);
  for (const i of unresolvedBlocking) approvalBlockers.push(`Unresolved blocking issue: ${i.message}`);
  return { draft, state, fingerprint, summary, blocking, warnings, decision, effective, unresolvedBlocking, approvalBlockers };
}

// ---------------------------------------------------------------------------------------------
// Recording decisions (each returns a NEW review with a history entry)
// ---------------------------------------------------------------------------------------------

const stateOf = (review: SavedReview, draftId: string): DraftRowState | null => review.draftRows?.find((r) => r.draftId === draftId) ?? null;
const empty = (draftId: string): DraftRowState => ({ draftId, resolutions: [], decision: null });
const needNote = (note: string | null | undefined, what: string): string => {
  if (!note || note.trim() === '') throw new DraftRowDecisionError(`${what} needs a note.`);
  return note.trim();
};
const label = (d: DraftRow) => d.row.item.sourceReference ?? d.row.id;

/** Resolves one blocking issue with a note. The value is not changed. */
export function resolveDraftIssue(review: SavedReview, draft: DraftRow, issueId: string, note: string, at: string, by: string | null): SavedReview {
  const view = viewRow(draft, stateOf(review, draft.row.id));
  const target = view.blocking.find((b) => b.issue.id === issueId);
  if (!target) throw new DraftRowDecisionError('That blocking issue is not on this row.');
  if (!target.resolvable) throw new DraftRowDecisionError(target.howToClear ?? 'This issue cannot be resolved with a note.');
  if (target.resolution && !target.outdated) throw new DraftRowDecisionError('This issue is already resolved.');
  const text = needNote(note, 'Resolving an issue');
  const resolution: DraftIssueResolution = { issueId, kind: target.resolvable, by, at, note: text, rowFingerprint: view.fingerprint, contentSummary: view.summary };
  const base = view.state ?? empty(draft.row.id);
  const next: DraftRowState = { ...base, resolutions: [...base.resolutions.filter((r) => r.issueId !== issueId), resolution] };
  const what = target.resolvable === 'confirmed_not_stated'
    ? `${target.issue.field} confirmed as not stated in the document (stays blank in the export; not a zero)`
    : 'continuation-row values confirmed as not part of this item';
  return recordDraftRowChange(review, next, 'row_issue_resolved', `${label(draft)}: ${what}.`, at, by, text);
}

/** Withdraws a resolution (it stays in the history). Not while the row is approved. */
export function withdrawDraftResolution(review: SavedReview, draft: DraftRow, issueId: string, at: string, by: string | null): SavedReview {
  const view = viewRow(draft, stateOf(review, draft.row.id));
  if (view.decision && !view.decision.outdated && view.decision.record.status === 'approved') throw new DraftRowDecisionError('The row is approved. Change that decision first.');
  const state = view.state;
  if (!state?.resolutions.some((r) => r.issueId === issueId)) throw new DraftRowDecisionError('That issue has no resolution to withdraw.');
  const next: DraftRowState = { ...state, resolutions: state.resolutions.filter((r) => r.issueId !== issueId) };
  return recordDraftRowChange(review, next, 'row_resolution_withdrawn', `${label(draft)}: resolution withdrawn; the earlier one stays in this history.`, at, by);
}

/**
 * Approves, marks "needs changes", or excludes a draft row.
 *   approve   only with no unresolved blocking issue; warnings need an acknowledging note
 *   exclude   always possible, with a reason; the draft row and its values are not changed
 */
export function decideDraftRow(review: SavedReview, draft: DraftRow, status: DraftRowStatus, note: string | null, at: string, by: string | null): SavedReview {
  const view = viewRow(draft, stateOf(review, draft.row.id));
  if (view.decision && !view.decision.outdated) throw new DraftRowDecisionError(`This row is already ${view.decision.record.status.replace('_', ' ')}. Change that decision first.`);
  const text = note && note.trim() !== '' ? note.trim() : null;
  let acknowledgedWarnings: string[] = [];
  if (status === 'approved') {
    if (view.unresolvedBlocking.length > 0) throw new DraftRowDecisionError(`This row cannot be approved: ${view.unresolvedBlocking.length} blocking issue(s) are unresolved.`);
    acknowledgedWarnings = view.warnings.map((w) => w.id);
    if (acknowledgedWarnings.length && !text) throw new DraftRowDecisionError(`This row has ${acknowledgedWarnings.length} warning(s); approving it needs a note acknowledging them.`);
  }
  if (status === 'excluded') needNote(text, 'Excluding a row');
  const decision: DraftRowDecision = { status, by, at, note: text, acknowledgedWarnings, rowFingerprint: view.fingerprint, contentSummary: view.summary };
  const next: DraftRowState = { ...(view.state ?? empty(draft.row.id)), decision };
  const action = status === 'approved' ? 'row_approved' : status === 'excluded' ? 'row_excluded' : 'row_needs_changes';
  const summary =
    status === 'approved'
      ? `${label(draft)}: approved${acknowledgedWarnings.length ? `, acknowledging ${acknowledgedWarnings.length} warning(s)` : ''}.`
      : status === 'excluded'
        ? `${label(draft)}: excluded from the upload. The draft row and its values are unchanged and stay in the reconciliation.`
        : `${label(draft)}: marked as needing changes.`;
  return recordDraftRowChange(review, next, action, summary, at, by, text ?? undefined);
}

/** Undoes a row decision (approved / needs changes / excluded). The earlier one stays in the history. */
export function reopenDraftRow(review: SavedReview, draftId: string, at: string, by: string | null): SavedReview {
  const state = stateOf(review, draftId);
  if (!state?.decision) throw new DraftRowDecisionError('This row has no decision to change.');
  return recordDraftRowChange(review, { ...state, decision: null }, 'row_decision_reopened', `${draftId}: earlier decision (${state.decision.status}) reopened; it is kept in this history.`, at, by);
}

export const BULK_ROW_NOTE = 'Bulk approval of draft rows with no issues at all.';

/** Why a row may not be bulk-approved (null = it may). Only rows with NO issues at all. */
export function bulkRowIneligibility(view: RowView): string | null {
  if (view.draft.row.issues.length > 0) return `has ${view.draft.row.issues.length} issue(s)`;
  if (view.decision) return view.decision.outdated ? 'has an outdated decision to redo individually' : 'already decided';
  return null;
}

/** Approves, after the person's confirmation, every given row that has no issues at all. */
export function bulkApproveDraftRows(review: SavedReview, drafts: readonly DraftRow[], at: string, by: string | null): { review: SavedReview; approved: string[]; skipped: { draftId: string; reason: string }[] } {
  let r = review;
  const approved: string[] = [];
  const skipped: { draftId: string; reason: string }[] = [];
  for (const d of drafts) {
    const reason = bulkRowIneligibility(viewRow(d, stateOf(r, d.row.id)));
    if (reason) skipped.push({ draftId: d.row.id, reason });
    else {
      r = decideDraftRow(r, d, 'approved', BULK_ROW_NOTE, at, by);
      approved.push(d.row.id);
    }
  }
  return { review: r, approved, skipped };
}

// ---------------------------------------------------------------------------------------------
// Tables and the whole document
// ---------------------------------------------------------------------------------------------

export interface TableReadiness {
  readonly views: readonly RowView[];
  readonly counts: Readonly<Record<RowEffectiveStatus, number>>;
  /** Every draft row approved or excluded, the table ready and the project details entered. Shown only — nothing is exported. */
  readonly readyForExport: boolean;
  readonly notReadyBecause: readonly string[];
}

export function tableReadiness(table: TableDrafts, review: SavedReview, projectIssues: DraftResult['projectIssues']): TableReadiness {
  const views = table.drafts.map((d) => viewRow(d, stateOf(review, d.row.id)));
  const counts = { pending: 0, approved: 0, needs_changes: 0, excluded: 0, outdated: 0 };
  for (const v of views) counts[v.effective]++;
  const notReadyBecause: string[] = [];
  if (table.status !== 'ready') notReadyBecause.push(`The table is ${table.status === 'blocked' ? 'blocked' : 'not converted'}.`);
  if (projectIssues.length) notReadyBecause.push('The project details are not complete.');
  const open = counts.pending + counts.needs_changes + counts.outdated;
  if (open) notReadyBecause.push(`${open} draft row(s) are not yet approved or excluded.`);
  return { views, counts, readyForExport: table.status === 'ready' && notReadyBecause.length === 0, notReadyBecause };
}

/** Decisions kept for draft rows that no longer exist (e.g. a row's type was changed). Not applied; kept in the history. */
export function orphanedRowDecisions(result: DraftResult, review: SavedReview): DraftRowState[] {
  const ids = new Set(result.tables.flatMap((t) => t.drafts.map((d) => d.row.id)));
  return (review.draftRows ?? []).filter((s) => !ids.has(s.draftId) && (s.decision !== null || s.resolutions.length > 0));
}
