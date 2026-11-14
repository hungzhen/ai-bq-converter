/**
 * STAGED BQ ROW — one converted BQ row waiting for review.
 *
 * It WRAPS the Cost Library's own FullBQItem (unchanged interface) and keeps, next to it:
 *   - the evidence for every value (raw text, state, source references);
 *   - "placeholders": required FullBQItem fields the document does not provide;
 *   - proposed classifications (Trade, Cost Item, Element) awaiting a person's decision;
 *   - issues (warnings) and the review status.
 *
 * RULES ENFORCED HERE
 *  1. Every value in `item` comes from evidence. Nothing is invented.
 *  2. FullBQItem REQUIRES description, unit, quantity, rate and amount. When the document does
 *     not give one, `item` must still hold something (0 or empty text) — so that placeholder is
 *     RECORDED in `placeholders` and reported as an issue. It is never silent.
 *     A missing QUANTITY, RATE or AMOUNT is a BLOCKING issue (Stage 2J decision 1): the 0 in the
 *     item is only an internal placeholder and is never a genuine zero. A genuine zero in the
 *     document has evidence state "zero" and no placeholder record.
 *  2a. The project name and year are entered by a person, never inferred. A missing name or year
 *     is a BLOCKING issue.
 *  3. originalRate / originalAmount are set only from the document's own rate / amount.
 *  4. Negative values keep their sign and raise a BLOCKING issue (D-004).
 *  5. Trade / Cost Item / Element stay blank until a person approves a proposal (D-008).
 *  6. Rows are frozen. Every change returns a NEW row; the old one stays exactly as it was.
 *  7. Claim data is never stored here (see progressClaim.ts).
 */
import { frozenCopy } from '../../lib/immutable.ts';
import type { FullBQItem } from '../../vendor/cost-library/index.ts';
import {
  type FieldEvidence,
  type ValueState,
  hasUsableValue,
  isNegative,
  validateFieldEvidence,
} from './evidence.ts';
import type { IssueResolution, IssueSeverity, ValidationIssue } from './issues.ts';
import { isUnresolvedBlocking } from './issues.ts';
import type { ConverterProject } from './project.ts';
import { type ReviewState, type ReviewStatus, PENDING_REVIEW, ReviewError } from './review.ts';
import { type SourceReference, describeSourceReference, toCostLibrarySourceReference } from './source.ts';

/** What kind of row this is in the source document (Revision 2 §7). */
export type BqRowClass =
  | 'title' // title / preamble text above the table
  | 'column_header' // a column-heading row (first or repeated on a later page)
  | 'bill_heading'
  | 'section_heading'
  | 'main_heading'
  | 'subheading'
  | 'secondary_subheading'
  | 'priced_item'
  | 'description_only_item' // an item with a description but no unit or figures
  | 'provisional_sum'
  | 'prime_cost_sum'
  | 'percentage_item' // e.g. "Allow for profit" with unit % (only when the row shows it)
  | 'continuation'
  | 'note'
  | 'note_label'
  | 'subtotal'
  | 'total'
  | 'brought_forward'
  | 'carried_forward'
  | 'collection'
  | 'summary'
  | 'reference' // page numbers, "continued", drawing references
  | 'blank' // no content (spacer)
  | 'unknown' // cannot be determined from the row
  | 'ignore';

/** Required FullBQItem fields that must come from the document. */
export const REQUIRED_DOCUMENT_FIELDS = ['description', 'unit', 'quantity', 'rate', 'amount'] as const;
export type RequiredDocumentField = (typeof REQUIRED_DOCUMENT_FIELDS)[number];

/** Optional FullBQItem text fields filled only from document evidence. */
export const EVIDENCE_TEXT_FIELDS = [
  'billNo', 'billDescription', 'sectionNo', 'sectionDescription', 'itemNo', 'originalItemNo',
  'mainHeading', 'subheading', 'secondarySubheading', 'parentSpecDescription', 'specification', 'notes',
] as const satisfies readonly (keyof FullBQItem)[];
export type EvidenceTextField = (typeof EVIDENCE_TEXT_FIELDS)[number];

/** Optional FullBQItem number fields filled only from document evidence (e.g. working-file columns). */
export const EVIDENCE_NUMBER_FIELDS = [
  'baseRate', 'baseAmount', 'tenderRate', 'tenderAmount', 'profitPercent', 'rateAfterDiscount',
] as const satisfies readonly (keyof FullBQItem)[];
export type EvidenceNumberField = (typeof EVIDENCE_NUMBER_FIELDS)[number];

/** Classification fields: blank until a person approves a proposal (D-008). */
export const CLASSIFICATION_FIELDS = ['tradeWork', 'subTrade', 'costItem', 'element', 'elementCode'] as const satisfies readonly (keyof FullBQItem)[];
export type ClassificationField = (typeof CLASSIFICATION_FIELDS)[number];

export interface RequiredRowEvidence {
  readonly description: FieldEvidence<string>;
  readonly unit: FieldEvidence<string>;
  readonly quantity: FieldEvidence<number>;
  readonly rate: FieldEvidence<number>;
  readonly amount: FieldEvidence<number>;
}

export type RowEvidence = RequiredRowEvidence &
  Partial<Record<EvidenceTextField, FieldEvidence<string>>> &
  Partial<Record<EvidenceNumberField, FieldEvidence<number>>> &
  Partial<Record<ClassificationField | 'projectYear', FieldEvidence<string>>>;

/** A required FullBQItem field that holds 0 or '' only because FullBQItem demands a value. */
export interface PlaceholderRecord {
  readonly field: RequiredDocumentField | 'projectYear' | 'projectName';
  readonly placeholder: 0 | '';
  /** Why there is no real value: the evidence state, or "not_entered" for the project name / year. */
  readonly reason: ValueState | 'not_entered';
}

/** A source column with no FullBQItem field (e.g. a labour/material split). Kept, never uploaded. */
export interface ExtraColumnValue {
  readonly columnHeader: string;
  readonly evidence: FieldEvidence;
}

export interface ClassificationProposal {
  readonly id: string;
  readonly field: ClassificationField;
  readonly value: string;
  readonly method: 'rule-based';
  readonly providerId: string;
  /** Plain-English reason, e.g. 'Description contains "formwork"'. */
  readonly reason: string;
  readonly sources: readonly SourceReference[];
  readonly status: 'pending' | 'approved' | 'rejected';
  readonly decidedBy?: string;
  readonly decidedAt?: string;
}

export interface StagedBQRow {
  readonly id: string;
  readonly projectId: string;
  readonly documentId: string;
  readonly rowClass: BqRowClass;
  /** Order of the row in its source document. */
  readonly sequence: number;
  /** The Cost Library record, built only from evidence. */
  readonly item: Readonly<FullBQItem>;
  readonly evidence: RowEvidence;
  readonly placeholders: readonly PlaceholderRecord[];
  readonly proposals: readonly ClassificationProposal[];
  readonly extraColumns: readonly ExtraColumnValue[];
  /** Every source row that contributed (e.g. an item and its continuation lines). */
  readonly sources: readonly SourceReference[];
  readonly issues: readonly ValidationIssue[];
  readonly review: ReviewState;
}

export interface StagedBQRowInput {
  readonly id: string;
  readonly project: Pick<ConverterProject, 'id' | 'name' | 'projectYear'> & { readonly projectRef?: string; readonly location?: string };
  readonly documentId: string;
  readonly rowClass: BqRowClass;
  readonly sequence: number;
  readonly sources: readonly SourceReference[];
  readonly evidence: RequiredRowEvidence &
    Partial<Record<EvidenceTextField, FieldEvidence<string>>> &
    Partial<Record<EvidenceNumberField, FieldEvidence<number>>>;
  readonly extraColumns?: readonly ExtraColumnValue[];
  readonly proposals?: readonly ClassificationProposal[];
  /** Date used for dateCreated / dateUpdated (YYYY-MM-DD). */
  readonly today: string;
  /** Further issues found by the caller (e.g. values on a continuation row that were not used). */
  readonly extraIssues?: readonly ValidationIssue[];
}

export class StagedRowError extends Error {
  override name = 'StagedRowError';
}

const issueId = (rowId: string, code: string, field: string) => `${rowId}:${code}:${field}`;

function evidenceIssues(rowId: string, field: string, e: FieldEvidence): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const add = (code: ValidationIssue['code'], severity: IssueSeverity, message: string) =>
    out.push({ id: issueId(rowId, code, field), code, severity, message, field, sources: e.sources });

  if (isNegative(e)) {
    add('NEGATIVE_VALUE', 'blocking', `${field} is negative (${String(e.raw)}). It is kept exactly as it is and never turned positive; the row can only be excluded from the upload (D-004).`);
  }
  if (e.state === 'unparseable') add('UNPARSEABLE_VALUE', 'warning', `${field}: "${String(e.raw)}" could not be understood.`);
  if (e.state === 'missing') add('SOURCE_VALUE_MISSING', 'warning', `${field} could not be read from the document.${e.note ? ` ${e.note}` : ''}`);
  if (e.state === 'special') add('SPECIAL_VALUE', 'info', `${field} shows "${String(e.raw)}" (${e.special}) instead of a figure.`);
  return out;
}

/** Builds a staged row from evidence. Throws if the evidence is inconsistent. */
export function createStagedBQRow(input: StagedBQRowInput): StagedBQRow {
  if (input.sources.length === 0) throw new StagedRowError('A row needs at least one source reference.');
  if (input.sources.some((s) => s.documentId !== input.documentId)) {
    throw new StagedRowError('All source references of a row must be in the row\'s own document.');
  }
  if ((input.proposals ?? []).some((p) => p.status !== 'pending')) {
    throw new StagedRowError('New proposals must be pending; only a person can approve or reject them.');
  }

  const allEvidence: [string, FieldEvidence][] = [
    ...Object.entries(input.evidence),
    ...(input.extraColumns ?? []).map((x): [string, FieldEvidence] => [`extra:${x.columnHeader}`, x.evidence]),
  ];
  for (const [field, e] of allEvidence) {
    const problems = validateFieldEvidence(e);
    if (problems.length) throw new StagedRowError(`Evidence for ${field} is inconsistent: ${problems.join(' ')}`);
    if (e.sources.some((s) => s.documentId !== input.documentId)) {
      throw new StagedRowError(`Evidence for ${field} points outside the row's document.`);
    }
  }

  const placeholders: PlaceholderRecord[] = [];
  const issues: ValidationIssue[] = [];
  const ev = input.evidence;

  const requiredText = (field: 'description' | 'unit'): string => {
    const e = ev[field];
    if (hasUsableValue(e)) return e.parsed;
    placeholders.push({ field, placeholder: '', reason: e.state });
    return '';
  };
  const requiredNumber = (field: 'quantity' | 'rate' | 'amount'): number => {
    const e = ev[field];
    if (hasUsableValue(e)) return e.parsed;
    placeholders.push({ field, placeholder: 0, reason: e.state });
    return 0;
  };

  let projectName = input.project.name;
  if (projectName.trim() === '') {
    placeholders.push({ field: 'projectName', placeholder: '', reason: 'not_entered' });
    issues.push({
      id: issueId(input.id, 'PROJECT_NAME_NOT_ENTERED', 'projectName'),
      code: 'PROJECT_NAME_NOT_ENTERED',
      severity: 'blocking',
      message: 'The project name has not been entered. It is never taken from the file name or assumed.',
      field: 'projectName',
      sources: [],
    });
    projectName = '';
  }

  let projectYear = input.project.projectYear;
  if (projectYear === null) {
    placeholders.push({ field: 'projectYear', placeholder: '', reason: 'not_entered' });
    issues.push({
      id: issueId(input.id, 'PROJECT_YEAR_NOT_ENTERED', 'projectYear'),
      code: 'PROJECT_YEAR_NOT_ENTERED',
      severity: 'blocking',
      message: 'The project year (e.g. "2024 Q1") has not been entered. It is never assumed.',
      field: 'projectYear',
      sources: [],
    });
    projectYear = '';
  }

  const first = input.sources[0]!;
  const item: FullBQItem = {
    id: input.id,
    projectId: input.project.id,
    projectName,
    ...(input.project.projectRef ? { projectRef: input.project.projectRef } : {}),
    ...(input.project.location ? { location: input.project.location } : {}),
    projectYear,
    description: requiredText('description'),
    unit: requiredText('unit'),
    quantity: requiredNumber('quantity'),
    rate: requiredNumber('rate'),
    amount: requiredNumber('amount'),
    sourceFile: first.fileName,
    sourceReference: toCostLibrarySourceReference(first),
    ...(first.kind !== 'pdf' ? { sourceRowNumber: first.rowNumber } : {}),
    sourceSequence: input.sequence,
    dateCreated: input.today,
    dateUpdated: input.today,
  };
  // Original BQ financials: only the document's own rate and amount.
  if (hasUsableValue(ev.rate)) item.originalRate = ev.rate.parsed;
  if (hasUsableValue(ev.amount)) item.originalAmount = ev.amount.parsed;

  const writable = item as unknown as Record<string, unknown>;
  for (const field of [...EVIDENCE_TEXT_FIELDS, ...EVIDENCE_NUMBER_FIELDS]) {
    const e = ev[field] as FieldEvidence | undefined;
    if (e && hasUsableValue(e)) writable[field] = e.parsed;
  }

  for (const p of placeholders) {
    if (p.field === 'projectYear' || p.field === 'projectName') continue;
    const numeric = p.field === 'quantity' || p.field === 'rate' || p.field === 'amount';
    issues.push({
      id: issueId(input.id, 'REQUIRED_FIELD_NOT_IN_SOURCE', p.field),
      code: 'REQUIRED_FIELD_NOT_IN_SOURCE',
      severity: numeric ? 'blocking' : input.rowClass === 'priced_item' ? 'warning' : 'info',
      message: numeric
        ? `${p.field} is required by FullBQItem but the document gives no figure (${p.reason}). The 0 held in the item is ONLY an internal placeholder — not a zero from the document.`
        : `${p.field} is required by FullBQItem but the document gives none (${p.reason}); "${String(p.placeholder)}" is only a placeholder.`,
      field: p.field,
      sources: ev[p.field].sources,
    });
  }
  for (const [field, e] of allEvidence) issues.push(...evidenceIssues(input.id, field, e));
  issues.push(...(input.extraIssues ?? []));

  const evidence: RowEvidence = {
    ...ev,
    ...(input.project.projectYear !== null
      ? {
          projectYear: {
            state: 'value',
            raw: input.project.projectYear,
            parsed: input.project.projectYear,
            sources: [],
            method: 'user_entered',
            verification: 'user_confirmed',
            note: 'Entered by a person in the converter project.',
          },
        }
      : {}),
  };

  return frozenCopy<StagedBQRow>({
    id: input.id,
    projectId: input.project.id,
    documentId: input.documentId,
    rowClass: input.rowClass,
    sequence: input.sequence,
    item,
    evidence,
    placeholders,
    proposals: input.proposals ?? [],
    extraColumns: input.extraColumns ?? [],
    sources: input.sources,
    issues,
    review: PENDING_REVIEW,
  });
}

export const unresolvedBlockingIssues = (row: StagedBQRow): ValidationIssue[] => row.issues.filter(isUnresolvedBlocking);

/** Records that a person resolved an issue. The value itself is NOT changed. */
export function resolveIssue(row: StagedBQRow, issueIdToResolve: string, resolution: IssueResolution): StagedBQRow {
  const target = row.issues.find((i) => i.id === issueIdToResolve);
  if (!target) throw new StagedRowError(`No issue "${issueIdToResolve}" on row ${row.id}.`);
  if (target.resolution) throw new StagedRowError(`Issue "${issueIdToResolve}" is already resolved.`);
  if (resolution.note.trim() === '') throw new StagedRowError('Resolving an issue needs a note explaining why.');
  return frozenCopy<StagedBQRow>({
    ...row,
    issues: row.issues.map((i) => (i.id === issueIdToResolve ? { ...i, resolution } : i)),
  });
}

/** Changes the review status. Approval is refused while blocking issues are unresolved. */
export function setReviewStatus(row: StagedBQRow, status: ReviewStatus, by: string, at: string, note?: string): StagedBQRow {
  if (status === 'approved') {
    const blocking = unresolvedBlockingIssues(row);
    if (blocking.length > 0) {
      throw new ReviewError(`Row ${row.id} cannot be approved: ${blocking.map((i) => i.code).join(', ')} must be resolved first.`);
    }
  }
  return frozenCopy<StagedBQRow>({
    ...row,
    review: { status, history: [...row.review.history, { status, by, at, ...(note !== undefined ? { note } : {}) }] },
  });
}

/** A person approves a classification proposal: only now does the value enter the FullBQItem. */
export function approveClassificationProposal(row: StagedBQRow, proposalId: string, by: string, at: string): StagedBQRow {
  const proposal = row.proposals.find((p) => p.id === proposalId);
  if (!proposal) throw new StagedRowError(`No proposal "${proposalId}" on row ${row.id}.`);
  if (proposal.status !== 'pending') throw new StagedRowError(`Proposal "${proposalId}" was already ${proposal.status}.`);
  const decided: ClassificationProposal = { ...proposal, status: 'approved', decidedBy: by, decidedAt: at };
  const evidence: FieldEvidence<string> = {
    state: 'value',
    raw: proposal.value,
    parsed: proposal.value,
    sources: proposal.sources,
    method: 'user_entered',
    verification: 'user_confirmed',
    note: `Rule-based suggestion (${proposal.providerId}: ${proposal.reason}) approved by ${by}.`,
  };
  return frozenCopy<StagedBQRow>({
    ...row,
    item: { ...row.item, [proposal.field]: proposal.value, dateUpdated: at.slice(0, 10) },
    evidence: { ...row.evidence, [proposal.field]: evidence },
    proposals: row.proposals.map((p) => (p.id === proposalId ? decided : p)),
  });
}

export function rejectClassificationProposal(row: StagedBQRow, proposalId: string, by: string, at: string): StagedBQRow {
  const proposal = row.proposals.find((p) => p.id === proposalId);
  if (!proposal) throw new StagedRowError(`No proposal "${proposalId}" on row ${row.id}.`);
  if (proposal.status !== 'pending') throw new StagedRowError(`Proposal "${proposalId}" was already ${proposal.status}.`);
  return frozenCopy<StagedBQRow>({
    ...row,
    proposals: row.proposals.map((p) => (p.id === proposalId ? { ...p, status: 'rejected', decidedBy: by, decidedAt: at } : p)),
  });
}

/**
 * Checks that every value in `item` is backed by evidence (or a recorded placeholder).
 * Returns plain-English problems; an empty list means the row is fully traceable.
 */
export function checkStagedRowIntegrity(row: StagedBQRow): string[] {
  const problems: string[] = [];
  const item = row.item as unknown as Record<string, unknown>;
  const ev = row.evidence as unknown as Record<string, FieldEvidence | undefined>;

  for (const field of REQUIRED_DOCUMENT_FIELDS) {
    const e = ev[field]!;
    const placeholder = row.placeholders.find((p) => p.field === field);
    if (hasUsableValue(e)) {
      if (placeholder) problems.push(`${field} has a value but is also listed as a placeholder.`);
      if (item[field] !== e.parsed) problems.push(`${field} in the item (${String(item[field])}) differs from its evidence (${String(e.parsed)}).`);
    } else {
      if (!placeholder) problems.push(`${field} has no value in the document but no placeholder is recorded.`);
      else if (item[field] !== placeholder.placeholder) problems.push(`${field} holds "${String(item[field])}" instead of its recorded placeholder.`);
    }
  }

  for (const field of [...EVIDENCE_TEXT_FIELDS, ...EVIDENCE_NUMBER_FIELDS]) {
    const e = ev[field];
    const expected = e && hasUsableValue(e) ? e.parsed : undefined;
    if (item[field] !== expected) problems.push(`${field} in the item (${String(item[field])}) is not backed by evidence.`);
  }

  for (const [field, source] of [['originalRate', 'rate'], ['originalAmount', 'amount']] as const) {
    const e = ev[source]!;
    const expected = hasUsableValue(e) ? e.parsed : undefined;
    if (item[field] !== expected) problems.push(`${field} must equal the document's own ${source}.`);
  }

  for (const field of CLASSIFICATION_FIELDS) {
    if (item[field] === undefined) continue;
    const approved = row.proposals.some((p) => p.field === field && p.status === 'approved' && p.value === item[field]);
    if (!approved) problems.push(`${field} is filled without an approved proposal.`);
  }

  if (item['actualCost'] !== undefined) problems.push('actualCost must never be filled by the converter.');

  for (const [field, e] of Object.entries(ev)) {
    if (e && isNegative(e) && !row.issues.some((i) => i.code === 'NEGATIVE_VALUE' && i.field === field)) {
      problems.push(`${field} is negative but has no NEGATIVE_VALUE issue.`);
    }
  }
  return problems;
}

/** Everything known about one field of a row: its value, its evidence and where it came from. */
export function traceField(row: StagedBQRow, field: RequiredDocumentField | EvidenceTextField | EvidenceNumberField | ClassificationField | 'projectYear') {
  const evidence = (row.evidence as unknown as Record<string, FieldEvidence | undefined>)[field];
  return {
    field,
    itemValue: (row.item as unknown as Record<string, unknown>)[field],
    isPlaceholder: row.placeholders.some((p) => p.field === field),
    evidence,
    sources: (evidence?.sources ?? []).map(describeSourceReference),
  };
}
