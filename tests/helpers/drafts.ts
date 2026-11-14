/**
 * Helpers for the Stage 2J draft-row tests. SYNTHETIC — NOT REAL COST DATA.
 */
import { approveProposal, correctProposal, rejectProposal, type Proposal } from '../../src/core/evidence/index.ts';
import { recordChanges, setProjectDetails, type ProjectDetails, type SavedReview, NO_PROJECT_DETAILS } from '../../src/core/review/index.ts';
import type { PipelineSuccess } from '../../src/core/pipeline/runPipeline.ts';
import { buildDrafts, type DraftResult } from '../../src/core/staging/index.ts';

export const AT = '2000-01-02T10:00:00.000Z';
export const TODAY = '2000-01-02';
export const SYNTHETIC_PROJECT: ProjectDetails = { name: 'SYNTHETIC PROJECT — NOT REAL COST DATA', year: '2024 Q1', projectRef: null, location: null };

/** Approves every verified proposal (its main reading), with a note — as a person reviewing would. */
export function approveAll(review: SavedReview, except: (p: Proposal) => boolean = () => false): SavedReview {
  const changes = review.proposals
    .filter((p) => p.status === 'proposed' && p.verification.ok && !except(p))
    .map((p) => ({ before: p, after: approveProposal(p, { by: 'Synthetic Reviewer', at: AT, note: 'SYNTHETIC test approval.' }, (p.interpretation.alternatives?.length ?? 0) > 0 ? 'primary' : undefined) }));
  return recordChanges(review, changes, AT, 'Synthetic Reviewer');
}

export const withProject = (review: SavedReview, details: ProjectDetails = SYNTHETIC_PROJECT) => setProjectDetails(review, details, AT, 'Synthetic Reviewer');

export function drafts(review: SavedReview, run: PipelineSuccess): DraftResult {
  return buildDrafts({ proposals: review.proposals, tables: run.extraction.tables, documentId: run.extraction.document.id, projectDetails: review.projectDetails ?? NO_PROJECT_DETAILS, today: TODAY });
}

/** Finds a proposal of a kind whose value matches. */
export function proposalOf(review: SavedReview, kind: string, match: Record<string, unknown>): Proposal {
  const p = review.proposals.find((x) => x.interpretation.decisionKind === kind && Object.entries(match).every(([k, v]) => (x.interpretation.value as unknown as Record<string, unknown>)[k] === v));
  if (!p) throw new Error(`No ${kind} proposal matching ${JSON.stringify(match)}`);
  return p;
}

export function reject(review: SavedReview, p: Proposal, note = 'SYNTHETIC rejection.'): SavedReview {
  return recordChanges(review, [{ before: p, after: rejectProposal(p, { by: 'Synthetic Reviewer', at: AT, note }) }], AT, 'Synthetic Reviewer');
}

export function correct(review: SavedReview, run: PipelineSuccess, p: Proposal, value: unknown, note = 'SYNTHETIC correction.'): SavedReview {
  const ctx = { project: run.project, tables: run.extraction.tables, documentId: run.extraction.document.id };
  return recordChanges(review, [{ before: p, after: correctProposal(p, { by: 'Synthetic Reviewer', at: AT, note }, value as never, ctx) }], AT, 'Synthetic Reviewer');
}
