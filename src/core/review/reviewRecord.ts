/**
 * SAVED REVIEW — everything about one review of one document, kept so a person can stop and come
 * back later without losing anything.
 *
 * It holds:
 *   - the document's identity: file name, size, format and SHA-256 FINGERPRINT;
 *   - how it was read (CSV settings), so it can be re-read exactly the same way;
 *   - every ORIGINAL proposal, with its evidence (cell references and quoted text) and its
 *     verification report — not just the final values;
 *   - each proposal's current state (proposed / approved / rejected), chosen alternative,
 *     correction, reviewer, note and timestamp;
 *   - a HISTORY of every action (proposal created, approved, rejected, correction recorded,
 *     warning acknowledged, alternative chosen, decision reopened, restored, imported).
 *     Earlier decisions are never overwritten: changing a decision adds events.
 *     The history is append-only THROUGH THIS APPLICATION. It is not tamper-proof and is not a
 *     secure audit trail: the record lives in the browser (and in exported backups) where it
 *     could be edited outside the app. Reviewer names are typed in, not verified identities.
 *
 * It does NOT hold the spreadsheet's contents. To reopen a review, the original file is chosen
 * again and must have the same fingerprint.
 */
import { frozenCopy } from '../../lib/immutable.ts';
import type { ExtractionOptions } from '../extraction/extractSpreadsheet.ts';
import { type Proposal, type ProposalDecision, reviewState } from '../evidence/proposals.ts';
import type { SheetVisibility, SourceDocument } from '../models/index.ts';
import type { PipelineSuccess } from '../pipeline/runPipeline.ts';
import type { ProviderInfo } from '../../providers/types.ts';
import { providerStamp } from '../../providers/types.ts';

export const REVIEW_KIND = 'ai-bq-converter.review';
export const REVIEW_FORMAT_VERSION = 1;

export type HistoryAction =
  | 'review_created'
  | 'proposal_created'
  | 'approved'
  | 'rejected'
  | 'correction_recorded'
  | 'alternative_chosen'
  | 'warning_acknowledged'
  | 'decision_reopened'
  | 'review_restored'
  | 'review_imported'
  | 'project_details_changed'
  | 'row_issue_resolved'
  | 'row_resolution_withdrawn'
  | 'row_approved'
  | 'row_needs_changes'
  | 'row_excluded'
  | 'row_decision_reopened'
  | 'review_exported';

export const HISTORY_ACTIONS: readonly HistoryAction[] = [
  'review_created', 'proposal_created', 'approved', 'rejected', 'correction_recorded',
  'alternative_chosen', 'warning_acknowledged', 'decision_reopened', 'review_restored', 'review_imported',
  'project_details_changed',
  'row_issue_resolved', 'row_resolution_withdrawn', 'row_approved', 'row_needs_changes', 'row_excluded', 'row_decision_reopened',
  'review_exported',
];

/** What an export produced (Stage 2L): the tables included and each file's fingerprint. */
export interface ExportRecord {
  readonly tables: readonly { readonly tableId: string; readonly name: string; readonly rows: number }[];
  readonly files: readonly { readonly kind: 'upload' | 'reconciliation'; readonly fileName: string; readonly sha256: string; readonly bytes: number }[];
}

/** History actions about draft rows (Stage 2K). */
export const ROW_ACTIONS: readonly HistoryAction[] = [
  'row_issue_resolved', 'row_resolution_withdrawn', 'row_approved', 'row_needs_changes', 'row_excluded', 'row_decision_reopened',
];

// ---------------------------------------------------------------------------------------------
// Draft-row decisions (Stage 2K). Stored with the review; the draft rows themselves are not.
// ---------------------------------------------------------------------------------------------

/**
 * How a blocking issue may be resolved — each only for one kind of issue. A resolution never
 * changes a value; it records that a person looked at the issue and what they confirmed.
 *   confirmed_not_stated        a placeholder figure: the document does not state it, and the cell
 *                               stays BLANK in the eventual export. It is NOT a zero or a supplied figure.
 *   confirmed_not_part_of_item  values on a continuation row outside the description do not belong
 *                               to this item (they stay unused).
 * Negative values cannot be resolved: such a row can only be excluded from the upload (Stage 2K
 * decision 2). Missing project details cannot be resolved with a note: they must be entered.
 */
export type IssueResolutionKind = 'confirmed_not_stated' | 'confirmed_not_part_of_item';
export const RESOLUTION_FOR_ISSUE: Readonly<Record<IssueResolutionKind, string>> = {
  confirmed_not_stated: 'REQUIRED_FIELD_NOT_IN_SOURCE',
  confirmed_not_part_of_item: 'CONTINUATION_VALUES_NOT_USED',
};

/** What the draft row looked like when a person decided (to explain what changed later). */
export type RowContentSummary = Readonly<Record<string, string>>;

export interface DraftIssueResolution {
  /** e.g. "draft:doc:sheet:1:7:REQUIRED_FIELD_NOT_IN_SOURCE:rate". */
  readonly issueId: string;
  readonly kind: IssueResolutionKind;
  readonly by: string | null;
  readonly at: string;
  readonly note: string;
  /** Fingerprint of the row's source-derived content when resolved. A different row = outdated. */
  readonly rowFingerprint: string;
  readonly contentSummary: RowContentSummary;
}

export type DraftRowStatus = 'approved' | 'needs_changes' | 'excluded';

export interface DraftRowDecision {
  readonly status: DraftRowStatus;
  readonly by: string | null;
  readonly at: string;
  /** Required to exclude a row and to approve a row with warnings. */
  readonly note: string | null;
  /** Warning issue ids acknowledged by an approval's note. */
  readonly acknowledgedWarnings: readonly string[];
  readonly rowFingerprint: string;
  readonly contentSummary: RowContentSummary;
}

export interface DraftRowState {
  /** The draft row's id, e.g. "draft:doc:sheet:1:7" (table and row of the item). */
  readonly draftId: string;
  readonly resolutions: readonly DraftIssueResolution[];
  readonly decision: DraftRowDecision | null;
}

/**
 * Project details typed in by a person (Stage 2J). Never inferred from the file name or contents.
 * null = not entered. A review saved before Stage 2J has none: it reads as "not entered".
 */
export interface ProjectDetails {
  readonly name: string | null;
  /** "YYYY Q#", e.g. "2024 Q1". */
  readonly year: string | null;
  readonly projectRef: string | null;
  readonly location: string | null;
}

export const NO_PROJECT_DETAILS: ProjectDetails = { name: null, year: null, projectRef: null, location: null };

/** A proposal's decision at one moment. */
export interface DecisionSnapshot {
  readonly status: Proposal['status'];
  readonly decision?: ProposalDecision;
  readonly chosen?: Proposal['chosen'];
  readonly correctionValue?: unknown;
}

export interface HistoryEvent {
  /** 1, 2, 3 … in the order things happened. */
  readonly sequence: number;
  readonly at: string;
  /** Who did it — null when no name was given (never invented). */
  readonly by: string | null;
  readonly action: HistoryAction;
  readonly proposalId?: string;
  readonly summary: string;
  readonly previous?: DecisionSnapshot;
  readonly next?: DecisionSnapshot;
  readonly note?: string;
  /** Warning codes acknowledged (action "warning_acknowledged"). */
  readonly warningCodes?: readonly string[];
  /** The imported backup's content checksum (action "review_imported") — used to notice the same backup imported again. */
  readonly backupChecksum?: string;
  /** A draft row's decisions before and after (row_* actions). */
  readonly draftRow?: { readonly draftId: string; readonly previous: DraftRowState | null; readonly next: DraftRowState };
  /** What was exported (action "review_exported"). */
  readonly exported?: ExportRecord;
  /** Project details before and after (action "project_details_changed"). */
  readonly details?: { readonly previous: ProjectDetails | null; readonly next: ProjectDetails };
}

export interface SavedReview {
  readonly kind: typeof REVIEW_KIND;
  readonly formatVersion: typeof REVIEW_FORMAT_VERSION;
  readonly reviewId: string;
  readonly createdAt: string;
  readonly savedAt: string;
  readonly document: SourceDocument;
  readonly extractionOptions: ExtractionOptions;
  readonly sheets: readonly { readonly name: string; readonly visibility: SheetVisibility; readonly status: string }[];
  /** "id@version" of the provider that made the proposals. */
  readonly providerId: string;
  /** The last reviewer name used (null when none was given). */
  readonly reviewer: string | null;
  readonly proposals: readonly Proposal[];
  readonly history: readonly HistoryEvent[];
  /** Entered by a person (Stage 2J). Absent in reviews saved before Stage 2J. */
  readonly projectDetails?: ProjectDetails;
  /** Decisions about draft rows (Stage 2K). Absent in reviews saved before Stage 2K. */
  readonly draftRows?: readonly DraftRowState[];
}

export interface ReviewCounts {
  readonly total: number;
  readonly approved: number;
  readonly rejected: number;
  readonly unresolved: number;
  readonly failedVerification: number;
}

export function reviewCounts(review: Pick<SavedReview, 'proposals'>): ReviewCounts {
  let approved = 0, rejected = 0, failedVerification = 0;
  for (const p of review.proposals) {
    const s = reviewState(p);
    if (s === 'approved') approved++;
    else if (s === 'rejected') rejected++;
    else if (s === 'failed_verification') failedVerification++;
  }
  const total = review.proposals.length;
  return { total, approved, rejected, failedVerification, unresolved: total - approved - rejected };
}

export const snapshot = (p: Proposal): DecisionSnapshot => ({
  status: p.status,
  ...(p.decision ? { decision: p.decision } : {}),
  ...(p.chosen !== undefined ? { chosen: p.chosen } : {}),
  ...(p.correction ? { correctionValue: p.correction.value } : {}),
});

/** A new saved review for a fresh pipeline run: every proposal recorded as created. */
export function createReview(
  result: PipelineSuccess,
  options: { reviewId: string; at: string; reviewer: string | null; extractionOptions: ExtractionOptions; provider: ProviderInfo },
): SavedReview {
  const history: HistoryEvent[] = [
    { sequence: 1, at: options.at, by: options.reviewer, action: 'review_created', summary: `Review of "${result.extraction.document.fileName}" started (${result.proposals.length} proposals).` },
  ];
  for (const p of result.proposals) {
    history.push({ sequence: history.length + 1, at: options.at, by: null, action: 'proposal_created', proposalId: p.id, summary: `Proposed by ${providerStamp(options.provider)}${p.verification.ok ? '' : ' — failed verification'}.`, next: snapshot(p) });
  }
  return frozenCopy<SavedReview>({
    kind: REVIEW_KIND,
    formatVersion: REVIEW_FORMAT_VERSION,
    reviewId: options.reviewId,
    createdAt: options.at,
    savedAt: options.at,
    document: result.extraction.document,
    extractionOptions: options.extractionOptions,
    sheets: result.extraction.sheets.length
      ? result.extraction.sheets.map((s) => ({ name: s.name, visibility: s.visibility, status: s.status }))
      : [{ name: 'CSV', visibility: 'visible', status: 'extracted' }],
    providerId: providerStamp(options.provider),
    reviewer: options.reviewer,
    proposals: result.proposals,
    history,
  });
}

function eventsFor(before: Proposal, after: Proposal, at: string, start: number): HistoryEvent[] {
  const by = after.decision?.by ?? before.decision?.by ?? null;
  const base = { at, proposalId: after.id, previous: snapshot(before), next: snapshot(after) };
  const note = after.decision?.note;
  const out: Omit<HistoryEvent, 'sequence'>[] = [];

  if (before.status !== 'proposed' && after.status === 'proposed') {
    out.push({ ...base, by: null, action: 'decision_reopened', summary: `Earlier decision (${before.status}) reopened; it is kept in this history.` });
  } else if (before.status === 'proposed' && after.status === 'approved') {
    const warnings = after.verification.findings.filter((f) => f.severity === 'warning').map((f) => f.code);
    if (warnings.length) out.push({ ...base, by, action: 'warning_acknowledged', summary: `Acknowledged: ${warnings.join(', ')}.`, warningCodes: warnings, ...(note ? { note } : {}) });
    if (typeof after.chosen === 'number') out.push({ ...base, by, action: 'alternative_chosen', summary: `Alternative ${after.chosen + 1} chosen.`, ...(note ? { note } : {}) });
    out.push({ ...base, by, action: 'approved', summary: 'Approved.', ...(note ? { note } : {}) });
  } else if (before.status === 'proposed' && after.status === 'rejected') {
    out.push(after.correction
      ? { ...base, by, action: 'correction_recorded', summary: 'Rejected, with a correction recorded.', ...(note ? { note } : {}) }
      : { ...base, by, action: 'rejected', summary: 'Rejected.', ...(note ? { note } : {}) });
  }
  return out.map((e, n) => ({ ...e, sequence: start + n }));
}

/**
 * Records a change to one or more proposals: replaces them in the review and appends history
 * events. Nothing earlier in the history is changed.
 */
export function recordChanges(review: SavedReview, changes: readonly { before: Proposal; after: Proposal }[], at: string, reviewer: string | null): SavedReview {
  const byId = new Map(changes.map((c) => [c.after.id, c.after]));
  const history = [...review.history];
  for (const c of changes) {
    if (c.before.id !== c.after.id) throw new Error('A change must be to the same proposal.');
    history.push(...eventsFor(c.before, c.after, at, history.length + 1));
  }
  return frozenCopy<SavedReview>({
    ...review,
    savedAt: at,
    reviewer: reviewer ?? review.reviewer,
    proposals: review.proposals.map((p) => byId.get(p.id) ?? p),
    history,
  });
}

/** Adds a review-level event (restored, imported). */
export function recordEvent(
  review: SavedReview,
  action: 'review_restored' | 'review_imported',
  at: string,
  by: string | null,
  summary: string,
  extra: { readonly backupChecksum?: string } = {},
): SavedReview {
  return frozenCopy<SavedReview>({
    ...review,
    savedAt: at,
    history: [...review.history, { sequence: review.history.length + 1, at, by, action, summary, ...(extra.backupChecksum ? { backupChecksum: extra.backupChecksum } : {}) }],
  });
}

export const historyOf = (review: SavedReview, proposalId: string): HistoryEvent[] => review.history.filter((e) => e.proposalId === proposalId);

export class ProjectDetailsError extends Error {
  override name = 'ProjectDetailsError';
}

const PROJECT_YEAR = /^\d{4} Q[1-4]$/;
const tidy = (v: string | null | undefined) => (v === null || v === undefined || v.trim() === '' ? null : v.trim());

/** Checks typed-in project details. Returns plain-English problems (an empty list = acceptable). */
export function projectDetailsProblems(d: ProjectDetails): string[] {
  const problems: string[] = [];
  if (d.year !== null && !PROJECT_YEAR.test(d.year)) problems.push(`The project year must look like "2024 Q1" (got "${d.year}").`);
  return problems;
}

/**
 * Records project details typed in by a person, with a history entry keeping the earlier
 * details. Blank fields become null ("not entered"); nothing is filled in automatically.
 */
export function setProjectDetails(review: SavedReview, input: ProjectDetails, at: string, by: string | null): SavedReview {
  const next: ProjectDetails = { name: tidy(input.name), year: tidy(input.year), projectRef: tidy(input.projectRef), location: tidy(input.location) };
  const problems = projectDetailsProblems(next);
  if (problems.length) throw new ProjectDetailsError(problems.join(' '));
  const previous = review.projectDetails ?? null;
  const changed = ['name', 'year', 'projectRef', 'location'].filter((k) => (previous?.[k as keyof ProjectDetails] ?? null) !== next[k as keyof ProjectDetails]);
  if (changed.length === 0) return review;
  return frozenCopy<SavedReview>({
    ...review,
    savedAt: at,
    projectDetails: next,
    history: [
      ...review.history,
      { sequence: review.history.length + 1, at, by, action: 'project_details_changed', summary: `Project details changed: ${changed.join(', ')}.`, details: { previous, next } },
    ],
  });
}

/**
 * Records a new state for one draft row, with a history entry keeping the earlier state.
 * Callers (src/core/staging/rowDecisions.ts) check the rules first.
 */
export function recordDraftRowChange(
  review: SavedReview,
  next: DraftRowState,
  action: HistoryAction,
  summary: string,
  at: string,
  by: string | null,
  note?: string,
): SavedReview {
  if (!ROW_ACTIONS.includes(action)) throw new Error(`"${action}" is not a draft-row action.`);
  const rows = review.draftRows ?? [];
  const previous = rows.find((r) => r.draftId === next.draftId) ?? null;
  return frozenCopy<SavedReview>({
    ...review,
    savedAt: at,
    draftRows: previous ? rows.map((r) => (r.draftId === next.draftId ? next : r)) : [...rows, next],
    history: [
      ...review.history,
      { sequence: review.history.length + 1, at, by, action, summary, ...(note ? { note } : {}), draftRow: { draftId: next.draftId, previous, next } },
    ],
  });
}

/** Records an export (Stage 2L): time, name as typed, tables included and both files' SHA-256. */
export function recordExport(review: SavedReview, record: ExportRecord, at: string, by: string | null): SavedReview {
  const rows = record.tables.reduce((n, t) => n + t.rows, 0);
  return frozenCopy<SavedReview>({
    ...review,
    savedAt: at,
    history: [
      ...review.history,
      {
        sequence: review.history.length + 1,
        at,
        by,
        action: 'review_exported',
        summary: `Exported ${rows} approved row(s) from ${record.tables.map((t) => t.name).join(', ')} (upload workbook NOT YET VALIDATED for Cost Library import) and a reconciliation workbook.`,
        exported: record,
      },
    ],
  });
}
