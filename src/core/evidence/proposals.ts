/**
 * PROPOSALS — how a provider's answer can (only) become approved data.
 *
 *   provider answer ──► evidence verifier ──► proposal ("proposed") ──► a PERSON approves or rejects
 *
 * Rules:
 *   - A proposal is created only together with the verifier's report for that exact answer.
 *   - An answer with a blocking finding can never be approved.
 *   - An answer with warnings can be approved only with a note that acknowledges them.
 *   - Passing the verifier is NOT approval. Nothing is approved automatically.
 *   - Records are frozen; approving or rejecting returns a new record.
 */
import { frozenCopy } from '../../lib/immutable.ts';
import type { DecisionKind, DecisionTypes, Interpretation } from '../../providers/types.ts';
import { type VerificationReport, blockingFindings, stableKey, warningFindings } from './findings.ts';

export interface ProposalDecision {
  readonly by: string;
  readonly at: string;
  readonly note?: string;
}

export interface Proposal<K extends DecisionKind = DecisionKind> {
  readonly id: string;
  readonly interpretation: Interpretation<K>;
  readonly verification: VerificationReport;
  readonly status: 'proposed' | 'approved' | 'rejected';
  readonly decision?: ProposalDecision;
}

export class ProposalError extends Error {
  override name = 'ProposalError';
}

export function createProposal<K extends DecisionKind>(id: string, interpretation: Interpretation<K>, verification: VerificationReport): Proposal<K> {
  if (verification.subjectKey !== stableKey(interpretation)) {
    throw new ProposalError('The verification report is for a different (or since changed) answer. Verify this answer first.');
  }
  if (interpretation.status !== 'proposed') throw new ProposalError('Only an answer with status "proposed" can become a proposal.');
  return frozenCopy<Proposal<K>>({ id, interpretation, verification, status: 'proposed' });
}

/** A person approves. Refused for blocking findings; warnings need an acknowledging note. */
export function approveProposal<K extends DecisionKind>(proposal: Proposal<K>, decision: ProposalDecision): Proposal<K> {
  if (proposal.status !== 'proposed') throw new ProposalError(`Proposal "${proposal.id}" was already ${proposal.status}.`);
  if (!decision.by.trim()) throw new ProposalError('Approval must name the person approving.');
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
  return frozenCopy<Proposal<K>>({ ...proposal, status: 'approved', decision });
}

export function rejectProposal<K extends DecisionKind>(proposal: Proposal<K>, decision: ProposalDecision): Proposal<K> {
  if (proposal.status !== 'proposed') throw new ProposalError(`Proposal "${proposal.id}" was already ${proposal.status}.`);
  if (!decision.by.trim()) throw new ProposalError('Rejection must name the person rejecting.');
  return frozenCopy<Proposal<K>>({ ...proposal, status: 'rejected', decision });
}

/** The decisions a person has approved — the only ones later stages may use. */
export function approvedDecisions<K extends DecisionKind>(proposals: readonly Proposal<K>[]): DecisionTypes[K][] {
  return proposals.filter((p) => p.status === 'approved').map((p) => p.interpretation.value);
}
