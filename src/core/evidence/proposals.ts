/**
 * PROPOSALS — how a provider's answer can (only) become approved data.
 *
 *   provider answer ──► evidence verifier ──► proposal ──► a PERSON approves or rejects
 *
 * Review states (see `reviewState`):
 *   failed_verification   the verifier found a blocking problem — can never be approved
 *   verified              passed the verifier; awaiting a person's decision (NOT approved)
 *   approved              a person approved it (who, when, which reading, note)
 *   rejected              a person rejected it (who, when, note)
 *
 * Rules:
 *   - A proposal is created only together with the verifier's report for that exact answer.
 *   - Passing the verifier is NOT approval, and neither is high confidence. Nothing is approved
 *     automatically.
 *   - An answer with warnings can be approved only with a note acknowledging them.
 *   - An answer with alternative readings can be approved only by explicitly choosing one.
 *   - Bulk approval (a person's explicit action) only covers straightforward answers: verified,
 *     no warnings, no alternatives, and of a kind listed in BULK_APPROVABLE_KINDS. Everything
 *     else stays for individual review.
 *   - Records are frozen; approving or rejecting returns a new record.
 */
import { frozenCopy } from '../../lib/immutable.ts';
import type { DecisionKind, DecisionTypes, Interpretation } from '../../providers/types.ts';
import { type VerificationReport, blockingFindings, stableKey, warningFindings } from './findings.ts';
import { type InterpretationContext, verifyInterpretation } from './verifyInterpretation.ts';

export interface ProposalDecision {
  /** Who decided — when known. null = not recorded (there is no sign-in yet); never invented. */
  readonly by: string | null;
  readonly at: string;
  readonly note?: string;
}

/** A person's correction recorded with a rejection: their own value for the same cited cells. */
export interface ProposalCorrection<K extends DecisionKind = DecisionKind> {
  readonly value: DecisionTypes[K];
  /** The correction checked against the same evidence (it must have no blocking finding). */
  readonly verification: VerificationReport;
}

/** Which reading a person approved: the main answer, or alternative number n (0-based). */
export type ProposalChoice = 'primary' | number;

export interface Proposal<K extends DecisionKind = DecisionKind> {
  readonly id: string;
  readonly interpretation: Interpretation<K>;
  readonly verification: VerificationReport;
  readonly status: 'proposed' | 'approved' | 'rejected';
  readonly decision?: ProposalDecision;
  /** Set on approval. */
  readonly chosen?: ProposalChoice;
  /** Set when a person rejected the proposal and recorded their own value instead. */
  readonly correction?: ProposalCorrection<K>;
}

export type ReviewState = 'failed_verification' | 'verified' | 'approved' | 'rejected';

export class ProposalError extends Error {
  override name = 'ProposalError';
}

/** Decision kinds that may be approved in bulk, when straightforward. */
export const BULK_APPROVABLE_KINDS: readonly DecisionKind[] = ['tableRegion', 'columnRole', 'rowClass'];

/** A name, when given, must not be blank; null means "not recorded". */
function checkIdentity(decision: ProposalDecision, what: string): void {
  if (decision.by !== null && decision.by.trim() === '') {
    throw new ProposalError(`${what}: the name is blank. Give a name, or leave it as "not recorded".`);
  }
}

export function createProposal<K extends DecisionKind>(id: string, interpretation: Interpretation<K>, verification: VerificationReport): Proposal<K> {
  if (verification.subjectKey !== stableKey(interpretation)) {
    throw new ProposalError('The verification report is for a different (or since changed) answer. Verify this answer first.');
  }
  if (interpretation.status !== 'proposed') throw new ProposalError('Only an answer with status "proposed" can become a proposal.');
  return frozenCopy<Proposal<K>>({ id, interpretation, verification, status: 'proposed' });
}

/** Verifies each answer and wraps it as a proposal. Nothing is approved. */
export function createVerifiedProposals<K extends DecisionKind>(idPrefix: string, interpretations: readonly Interpretation<K>[], ctx: InterpretationContext): Proposal<K>[] {
  return interpretations.map((interpretation, n) => createProposal(`${idPrefix}-${n + 1}`, interpretation, verifyInterpretation(interpretation, ctx)));
}

export function reviewState(p: Proposal): ReviewState {
  if (p.status === 'approved') return 'approved';
  if (p.status === 'rejected') return 'rejected';
  return p.verification.ok ? 'verified' : 'failed_verification';
}

const hasAlternatives = (p: Proposal) => (p.interpretation.alternatives?.length ?? 0) > 0;

/**
 * A person approves. Refused for blocking findings; warnings need an acknowledging note; an
 * answer with alternatives needs an explicit choice ('primary' or the alternative's number).
 */
export function approveProposal<K extends DecisionKind>(proposal: Proposal<K>, decision: ProposalDecision, choice?: ProposalChoice): Proposal<K> {
  if (proposal.status !== 'proposed') throw new ProposalError(`Proposal "${proposal.id}" was already ${proposal.status}.`);
  checkIdentity(decision, 'Approval');
  if (proposal.verification.subjectKey !== stableKey(proposal.interpretation)) {
    throw new ProposalError('The answer changed after it was verified. It must be verified again.');
  }
  const blocking = blockingFindings(proposal.verification);
  if (blocking.length > 0) {
    throw new ProposalError(`Proposal "${proposal.id}" cannot be approved: ${blocking.map((f) => f.code).join(', ')}.`);
  }
  if (warningFindings(proposal.verification).length > 0 && !decision.note?.trim()) {
    throw new ProposalError(`Proposal "${proposal.id}" has warnings; approving it needs a note acknowledging them.`);
  }
  const alternatives = proposal.interpretation.alternatives ?? [];
  if (alternatives.length > 0 && choice === undefined) {
    throw new ProposalError(`Proposal "${proposal.id}" has ${alternatives.length} alternative reading(s); choose 'primary' or an alternative.`);
  }
  const chosen: ProposalChoice = choice ?? 'primary';
  if (chosen !== 'primary' && (!Number.isInteger(chosen) || chosen < 0 || chosen >= alternatives.length)) {
    throw new ProposalError(`Proposal "${proposal.id}" has no alternative number ${String(chosen)}.`);
  }
  return frozenCopy<Proposal<K>>({ ...proposal, status: 'approved', decision, chosen });
}

export function rejectProposal<K extends DecisionKind>(proposal: Proposal<K>, decision: ProposalDecision): Proposal<K> {
  if (proposal.status !== 'proposed') throw new ProposalError(`Proposal "${proposal.id}" was already ${proposal.status}.`);
  checkIdentity(decision, 'Rejection');
  return frozenCopy<Proposal<K>>({ ...proposal, status: 'rejected', decision });
}

/**
 * A person rejects the proposal and records their own value for the same cited cells (e.g. a
 * different row type). The correction is checked against the same evidence; it is refused if
 * that check finds a blocking problem. A note explaining the correction is required.
 * The original proposal and the source data are not changed.
 */
export function correctProposal<K extends DecisionKind>(
  proposal: Proposal<K>,
  decision: ProposalDecision,
  value: DecisionTypes[K],
  ctx: InterpretationContext,
): Proposal<K> {
  if (proposal.status !== 'proposed') throw new ProposalError(`Proposal "${proposal.id}" was already ${proposal.status}.`);
  checkIdentity(decision, 'Correction');
  if (!decision.note?.trim()) throw new ProposalError('A correction needs a note explaining it.');
  const { alternatives: _alternatives, quotedText, ...rest } = proposal.interpretation;
  void _alternatives;
  const asAnswer: Interpretation<K> = { ...rest, ...(quotedText ? { quotedText } : {}), value, reasoning: `Correction: ${decision.note}` };
  const verification = verifyInterpretation({ ...asAnswer, providerId: proposal.interpretation.providerId }, { ...ctx, provider: undefined });
  const blocking = blockingFindings(verification);
  if (blocking.length > 0) throw new ProposalError(`The correction does not fit the cited cells: ${blocking.map((f) => f.code).join(', ')}.`);
  return frozenCopy<Proposal<K>>({ ...proposal, status: 'rejected', decision, correction: { value, verification } });
}

/** Approved readings and recorded corrections — what a person has decided, with where it came from. */
export function decidedValues<K extends DecisionKind>(proposals: readonly Proposal<K>[]): { proposalId: string; value: DecisionTypes[K]; source: 'approved' | 'correction' }[] {
  const out: { proposalId: string; value: DecisionTypes[K]; source: 'approved' | 'correction' }[] = [];
  for (const p of proposals) {
    if (p.status === 'approved') out.push({ proposalId: p.id, value: approvedDecisions([p])[0]!, source: 'approved' });
    else if (p.status === 'rejected' && p.correction) out.push({ proposalId: p.id, value: p.correction.value, source: 'correction' });
  }
  return out;
}

/** Why a proposal is not eligible for bulk approval (null = eligible). */
export function bulkIneligibility(p: Proposal): string | null {
  if (p.status !== 'proposed') return `already ${p.status}`;
  if (!p.verification.ok) return 'failed verification';
  if (!BULK_APPROVABLE_KINDS.includes(p.interpretation.decisionKind)) return `"${p.interpretation.decisionKind}" decisions are reviewed individually`;
  if (hasAlternatives(p)) return 'has alternative readings';
  if (warningFindings(p.verification).length > 0) return 'has warnings';
  return null;
}

/**
 * A person approves many straightforward proposals at once. Anything ambiguous, questionable or
 * of another kind is skipped (with the reason) and stays for individual review.
 */
export function bulkApprove<K extends DecisionKind>(
  proposals: readonly Proposal<K>[],
  decision: ProposalDecision,
): { approved: Proposal<K>[]; skipped: { proposal: Proposal<K>; reason: string }[] } {
  checkIdentity(decision, 'Bulk approval');
  const approved: Proposal<K>[] = [];
  const skipped: { proposal: Proposal<K>; reason: string }[] = [];
  for (const p of proposals) {
    const reason = bulkIneligibility(p);
    if (reason) skipped.push({ proposal: p, reason });
    else approved.push(approveProposal(p, { ...decision, note: decision.note ?? 'Bulk approval of straightforward proposals.' }, 'primary'));
  }
  return { approved, skipped };
}

/** The decisions a person has approved (the chosen reading) — the only ones later stages may use. */
export function approvedDecisions<K extends DecisionKind>(proposals: readonly Proposal<K>[]): DecisionTypes[K][] {
  return proposals
    .filter((p) => p.status === 'approved')
    .map((p) => (p.chosen === undefined || p.chosen === 'primary' ? p.interpretation.value : p.interpretation.alternatives![p.chosen]!.value));
}
