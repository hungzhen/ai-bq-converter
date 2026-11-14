/**
 * PROGRESS CLAIMS — a data model kept completely separate from the original BQ.
 *
 *  - ClaimDocumentRecord: one claim (or valuation / certificate) document — its reference,
 *    dates, contractor, certification, and adjustments (retention, variations, …).
 *  - ProgressClaimRecord: one line of a claim — previous / current / cumulative claimed
 *    quantities and amounts, percent complete, and certified figures.
 *
 * SEPARATION RULES
 *  1. This file does NOT import FullBQItem or the BQ row type. A claim line refers to a BQ row
 *     only by its id (`bqLink.bqRowId`). It can never hold, and therefore never change, a BQ record.
 *  2. Contract figures that a claim happens to show (contract qty / rate / amount) are stored
 *     here for COMPARISON ONLY. Differences are reported; the BQ is never corrected from a claim.
 *  3. Claim values never go into FullBQItem — not into quantity / rate / amount, not into
 *     originalRate / originalAmount, and not into actualCost.
 *  4. Records are frozen; every change returns a new record.
 */
import { frozenCopy } from '../../lib/immutable.ts';
import { type FieldEvidence, hasUsableValue, isNegative, validateFieldEvidence } from './evidence.ts';
import type { IssueSeverity, ValidationIssue } from './issues.ts';
import { type ReviewState, PENDING_REVIEW } from './review.ts';
import type { SourceReference } from './source.ts';

export type ClaimBasis = 'claimed' | 'certified' | 'claimed_and_certified' | 'unknown';

export type ClaimAdjustmentKind =
  | 'variation'
  | 'dayworks'
  | 'materials_on_site'
  | 'retention'
  | 'retention_release'
  | 'advance_payment'
  | 'previous_payments'
  | 'deduction'
  | 'other';

/** An amount in the claim that is not a BQ line (e.g. retention). Negative values keep their sign. */
export interface ClaimAdjustment {
  readonly id: string;
  readonly kind: ClaimAdjustmentKind;
  readonly description: FieldEvidence<string>;
  readonly amount: FieldEvidence<number>;
  readonly sources: readonly SourceReference[];
}

export interface ClaimCertification {
  readonly certificateReference: FieldEvidence<string>;
  readonly certifiedDate: FieldEvidence<string>;
  readonly certifiedBy: FieldEvidence<string>;
  readonly certifiedAmount: FieldEvidence<number>;
}

export interface ClaimDocumentRecord {
  readonly id: string;
  readonly projectId: string;
  /** The uploaded claim file (a SourceDocument of type "progress_claim"). */
  readonly sourceDocumentId: string;
  /** e.g. "Progress Claim No. 5" — only if stated in the document. */
  readonly claimReference: FieldEvidence<string>;
  readonly claimDate: FieldEvidence<string>;
  readonly periodEnd: FieldEvidence<string>;
  readonly contractorName: FieldEvidence<string>;
  readonly basis: ClaimBasis;
  readonly certification: ClaimCertification;
  /** BQ documents this claim is made against. */
  readonly relatedBqDocumentIds: readonly string[];
  readonly adjustments: readonly ClaimAdjustment[];
  readonly issues: readonly ValidationIssue[];
  readonly review: ReviewState;
}

/** Previous, current (this claim) and cumulative (to date) figures. */
export interface ClaimProgress {
  readonly previous: FieldEvidence<number>;
  readonly current: FieldEvidence<number>;
  readonly cumulative: FieldEvidence<number>;
}

export type BqLinkStatus = 'unmatched' | 'suggested' | 'confirmed';

export interface BqLink {
  /** Id of the StagedBQRow this claim line belongs to; null when not matched. */
  readonly bqRowId: string | null;
  readonly status: BqLinkStatus;
  readonly method: 'item_no_and_description' | 'item_no' | 'description' | 'template' | 'user' | null;
  /** What matched, in plain English, e.g. ['item no "B.2"', 'description']. */
  readonly matchedOn: readonly string[];
  readonly decidedBy?: string;
  readonly decidedAt?: string;
}

export interface ProgressClaimRecord {
  readonly id: string;
  readonly projectId: string;
  readonly claimDocumentId: string;
  readonly sourceDocumentId: string;
  /** Order of the line in the claim document. */
  readonly sequence: number;
  /** The line as the claim writes it (may differ from the BQ). */
  readonly asWritten: {
    readonly itemNo: FieldEvidence<string>;
    readonly description: FieldEvidence<string>;
    readonly unit: FieldEvidence<string>;
  };
  /** Contract figures shown in the claim — for comparison with the BQ ONLY. */
  readonly contractFiguresInClaim: {
    readonly quantity: FieldEvidence<number>;
    readonly rate: FieldEvidence<number>;
    readonly amount: FieldEvidence<number>;
  };
  readonly claimedQuantity: ClaimProgress;
  readonly claimedAmount: ClaimProgress;
  readonly percentComplete: ClaimProgress;
  readonly certifiedQuantity: ClaimProgress;
  readonly certifiedAmount: ClaimProgress;
  readonly bqLink: BqLink;
  readonly sources: readonly SourceReference[];
  readonly issues: readonly ValidationIssue[];
  readonly review: ReviewState;
}

/**
 * The only parts of a BQ row a claim may look at (read-only), to match and compare.
 * A StagedBQRow fits this shape; this file still does not depend on the BQ row type.
 */
export interface BqRowForClaims {
  readonly id: string;
  readonly projectId: string;
  readonly evidence: {
    readonly description: FieldEvidence<string>;
    readonly quantity: FieldEvidence<number>;
    readonly rate: FieldEvidence<number>;
    readonly amount: FieldEvidence<number>;
    readonly itemNo?: FieldEvidence<string>;
  };
}

export class ClaimError extends Error {
  override name = 'ClaimError';
}

const UNMATCHED: BqLink = { bqRowId: null, status: 'unmatched', method: null, matchedOn: [] };

/** Allowed rounding difference when checking previous + current = cumulative. */
export const CLAIM_ARITHMETIC_TOLERANCE = 0.005;

function checkEvidence(owner: string, sourceDocumentId: string, entries: [string, FieldEvidence][]): void {
  for (const [field, e] of entries) {
    const problems = validateFieldEvidence(e);
    if (problems.length) throw new ClaimError(`${owner}: evidence for ${field} is inconsistent: ${problems.join(' ')}`);
    if (e.sources.some((s) => s.documentId !== sourceDocumentId)) {
      throw new ClaimError(`${owner}: evidence for ${field} points outside the claim document.`);
    }
  }
}

function progressEntries(name: string, p: ClaimProgress): [string, FieldEvidence][] {
  return [
    [`${name}.previous`, p.previous],
    [`${name}.current`, p.current],
    [`${name}.cumulative`, p.cumulative],
  ];
}

function issue(ownerId: string, code: ValidationIssue['code'], severity: IssueSeverity, field: string, message: string, sources: readonly SourceReference[]): ValidationIssue {
  return { id: `${ownerId}:${code}:${field}`, code, severity, field, message, sources };
}

/** previous + current should equal cumulative. A difference is REPORTED, never corrected. */
export function checkProgressArithmetic(ownerId: string, name: string, p: ClaimProgress): ValidationIssue[] {
  if (!hasUsableValue(p.previous) || !hasUsableValue(p.current) || !hasUsableValue(p.cumulative)) return [];
  const difference = p.previous.parsed + p.current.parsed - p.cumulative.parsed;
  if (Math.abs(difference) <= CLAIM_ARITHMETIC_TOLERANCE) return [];
  return [
    issue(ownerId, 'CLAIM_ARITHMETIC_MISMATCH', 'warning', name,
      `${name}: previous (${p.previous.parsed}) + current (${p.current.parsed}) ≠ cumulative (${p.cumulative.parsed}). Figures are kept as written.`,
      [...p.previous.sources, ...p.current.sources, ...p.cumulative.sources]),
  ];
}

function negativeIssues(ownerId: string, entries: [string, FieldEvidence][]): ValidationIssue[] {
  return entries
    .filter(([, e]) => isNegative(e))
    .map(([field, e]) => issue(ownerId, 'NEGATIVE_VALUE', 'warning', field, `${field} is negative (${String(e.raw)}); kept with its sign.`, e.sources));
}

export function createClaimDocumentRecord(
  input: Omit<ClaimDocumentRecord, 'issues' | 'review' | 'adjustments'> & { adjustments?: readonly ClaimAdjustment[] },
): ClaimDocumentRecord {
  const adjustments = input.adjustments ?? [];
  const entries: [string, FieldEvidence][] = [
    ['claimReference', input.claimReference],
    ['claimDate', input.claimDate],
    ['periodEnd', input.periodEnd],
    ['contractorName', input.contractorName],
    ['certification.certificateReference', input.certification.certificateReference],
    ['certification.certifiedDate', input.certification.certifiedDate],
    ['certification.certifiedBy', input.certification.certifiedBy],
    ['certification.certifiedAmount', input.certification.certifiedAmount],
    ...adjustments.flatMap((a): [string, FieldEvidence][] => [
      [`adjustment ${a.id} description`, a.description],
      [`adjustment ${a.id} amount`, a.amount],
    ]),
  ];
  checkEvidence(`Claim document ${input.id}`, input.sourceDocumentId, entries);
  return frozenCopy<ClaimDocumentRecord>({
    ...input,
    adjustments,
    issues: negativeIssues(input.id, entries),
    review: PENDING_REVIEW,
  });
}

export function createProgressClaimRecord(
  input: Omit<ProgressClaimRecord, 'issues' | 'review' | 'bqLink'>,
): ProgressClaimRecord {
  if (input.sources.length === 0) throw new ClaimError('A claim line needs at least one source reference.');
  if (input.sources.some((s) => s.documentId !== input.sourceDocumentId)) {
    throw new ClaimError('All source references of a claim line must be in the claim document.');
  }
  const groups: [string, ClaimProgress][] = [
    ['claimedQuantity', input.claimedQuantity],
    ['claimedAmount', input.claimedAmount],
    ['percentComplete', input.percentComplete],
    ['certifiedQuantity', input.certifiedQuantity],
    ['certifiedAmount', input.certifiedAmount],
  ];
  const entries: [string, FieldEvidence][] = [
    ['asWritten.itemNo', input.asWritten.itemNo],
    ['asWritten.description', input.asWritten.description],
    ['asWritten.unit', input.asWritten.unit],
    ['contractFiguresInClaim.quantity', input.contractFiguresInClaim.quantity],
    ['contractFiguresInClaim.rate', input.contractFiguresInClaim.rate],
    ['contractFiguresInClaim.amount', input.contractFiguresInClaim.amount],
    ...groups.flatMap(([name, p]) => progressEntries(name, p)),
  ];
  checkEvidence(`Claim line ${input.id}`, input.sourceDocumentId, entries);

  const issues: ValidationIssue[] = [
    ...negativeIssues(input.id, entries),
    ...groups.flatMap(([name, p]) => checkProgressArithmetic(input.id, name, p)),
    issue(input.id, 'CLAIM_NOT_LINKED', 'info', 'bqLink', 'This claim line is not linked to a BQ row yet.', []),
  ];
  return frozenCopy<ProgressClaimRecord>({ ...input, bqLink: UNMATCHED, issues, review: PENDING_REVIEW });
}

const withoutNotLinked = (issues: readonly ValidationIssue[]) => issues.filter((i) => i.code !== 'CLAIM_NOT_LINKED');

/**
 * Suggests that a claim line belongs to a BQ row. Only the claim record changes (a new record
 * is returned); the BQ row is read, never changed.
 */
export function suggestBqLink(
  claim: ProgressClaimRecord,
  bqRow: BqRowForClaims,
  method: NonNullable<BqLink['method']>,
  matchedOn: readonly string[],
): ProgressClaimRecord {
  if (bqRow.projectId !== claim.projectId) throw new ClaimError('A claim line can only be linked to a BQ row of the same project.');
  return frozenCopy<ProgressClaimRecord>({
    ...claim,
    bqLink: { bqRowId: bqRow.id, status: 'suggested', method, matchedOn },
    issues: withoutNotLinked(claim.issues),
  });
}

/** A person confirms the suggested link. */
export function confirmBqLink(claim: ProgressClaimRecord, by: string, at: string): ProgressClaimRecord {
  if (claim.bqLink.status !== 'suggested' || claim.bqLink.bqRowId === null) {
    throw new ClaimError('Only a suggested link can be confirmed.');
  }
  return frozenCopy<ProgressClaimRecord>({ ...claim, bqLink: { ...claim.bqLink, status: 'confirmed', decidedBy: by, decidedAt: at } });
}

/** A person rejects the link: the claim line becomes unmatched again. */
export function rejectBqLink(claim: ProgressClaimRecord): ProgressClaimRecord {
  return frozenCopy<ProgressClaimRecord>({
    ...claim,
    bqLink: UNMATCHED,
    issues: [...withoutNotLinked(claim.issues), issue(claim.id, 'CLAIM_NOT_LINKED', 'info', 'bqLink', 'This claim line is not linked to a BQ row.', [])],
  });
}

export interface ContractFigureDifference {
  readonly field: 'quantity' | 'rate' | 'amount';
  readonly claimValue: number;
  readonly bqValue: number;
  readonly claimSources: readonly SourceReference[];
  readonly bqSources: readonly SourceReference[];
}

/**
 * Compares the contract figures shown in a claim with the linked BQ row. READ-ONLY: it returns
 * the differences and changes nothing. Only figures present on both sides are compared.
 */
export function compareContractFigures(claim: ProgressClaimRecord, bqRow: BqRowForClaims): ContractFigureDifference[] {
  if (claim.bqLink.bqRowId !== bqRow.id) throw new ClaimError('This BQ row is not the one linked to the claim line.');
  const out: ContractFigureDifference[] = [];
  for (const field of ['quantity', 'rate', 'amount'] as const) {
    const c = claim.contractFiguresInClaim[field];
    const b = bqRow.evidence[field];
    if (hasUsableValue(c) && hasUsableValue(b) && Math.abs(c.parsed - b.parsed) > CLAIM_ARITHMETIC_TOLERANCE) {
      out.push({ field, claimValue: c.parsed, bqValue: b.parsed, claimSources: c.sources, bqSources: b.sources });
    }
  }
  return out;
}

/** Records the differences as issues ON THE CLAIM. The BQ row is not touched. */
export function withContractFigureIssues(claim: ProgressClaimRecord, bqRow: BqRowForClaims): ProgressClaimRecord {
  const differences = compareContractFigures(claim, bqRow);
  const newIssues = differences.map((d) =>
    issue(claim.id, 'CLAIM_CONTRACT_FIGURE_DIFFERS', 'warning', `contractFiguresInClaim.${d.field}`,
      `The claim shows contract ${d.field} ${d.claimValue}; the BQ has ${d.bqValue}. Reported only — the BQ is not changed.`,
      [...d.claimSources, ...d.bqSources]),
  );
  return frozenCopy<ProgressClaimRecord>({
    ...claim,
    issues: [...claim.issues.filter((i) => i.code !== 'CLAIM_CONTRACT_FIGURE_DIFFERS'), ...newIssues],
  });
}
