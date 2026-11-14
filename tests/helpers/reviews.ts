/** Helpers for the review-persistence tests. SYNTHETIC — NOT REAL COST DATA. */
import { type PipelineSuccess, runPipeline } from '../../src/core/pipeline/runPipeline.ts';
import { createReview, type SavedReview } from '../../src/core/review/index.ts';
import { RULE_BASED_INFO, createRuleBasedProvider } from '../../src/providers/rule-based/index.ts';
import type { ExtractionOptions } from '../../src/core/extraction/index.ts';
import * as L from './synthetic/bqLayouts.ts';

export const provider = createRuleBasedProvider();

export async function freshRun(bytes = L.conventionalBq(), fileName = 'SYNTHETIC_BQ.xlsx', options: ExtractionOptions = {}): Promise<PipelineSuccess> {
  const r = await runPipeline({ bytes, fileName, documentId: 'doc-review', uploadedAt: '2000-01-01T00:00:00.000Z' }, provider, options);
  if (!r.ok) throw new Error(r.message);
  return r;
}

export async function newReview(bytes = L.conventionalBq(), fileName = 'SYNTHETIC_BQ.xlsx', options: ExtractionOptions = {}): Promise<{ run: PipelineSuccess; review: SavedReview }> {
  const run = await freshRun(bytes, fileName, options);
  return { run, review: createReview(run, { reviewId: 'review-1', at: '2000-01-01T00:00:00.000Z', reviewer: 'Synthetic Reviewer', extractionOptions: options, provider: RULE_BASED_INFO }) };
}

/** Re-reads a file the way reopening does (same document id and options; no new proposals). */
export async function reread(review: SavedReview, bytes: Uint8Array, fileName = review.document.fileName): Promise<PipelineSuccess> {
  const r = await runPipeline({ bytes, fileName, documentId: review.document.id, uploadedAt: review.document.uploadedAt }, provider, review.extractionOptions, 'extract_only');
  if (!r.ok) throw new Error(r.message);
  return r;
}

/** Finds a proposal by kind and a predicate on its value. */
export function find(review: SavedReview, kind: string, pred: (v: Record<string, unknown>) => boolean) {
  return review.proposals.find((p) => p.interpretation.decisionKind === kind && pred(p.interpretation.value as unknown as Record<string, unknown>))!;
}

export const rowOf = (review: SavedReview, sheetIndex: number, excelRow: number) =>
  find(review, 'rowClass', (v) => v['tableId'] === `doc-review:sheet:${sheetIndex}` && v['rowIndex'] === excelRow - 1);

/**
 * A review with every kind of decision, made through the application's own functions:
 * row 5 approved with an alternative and an acknowledged warning; row 22 approved, reopened and
 * rejected; row 25 rejected with a correction.
 */
export async function decidedReview(): Promise<{ run: PipelineSuccess; review: SavedReview }> {
  const { approveProposal, correctProposal, rejectProposal, reopenProposal } = await import('../../src/core/evidence/index.ts');
  const { recordChanges } = await import('../../src/core/review/index.ts');
  const AT = '2000-01-02T10:00:00.000Z';
  const { run, review } = await newReview();
  const ctx = { project: run.project, tables: run.extraction.tables, documentId: run.extraction.document.id };
  const a = rowOf(review, 1, 5);
  const b = rowOf(review, 1, 22);
  const c = rowOf(review, 1, 25);
  let r = recordChanges(review, [{ before: a, after: approveProposal(a, { by: 'Synthetic Reviewer', at: AT, note: 'Third level.' }, 0) }], AT, 'Synthetic Reviewer');
  const bApproved = approveProposal(b, { by: 'Synthetic Reviewer', at: AT });
  r = recordChanges(r, [{ before: b, after: bApproved }], AT, 'Synthetic Reviewer');
  const bReopened = reopenProposal(bApproved);
  r = recordChanges(r, [{ before: bApproved, after: bReopened }], AT, 'Synthetic Reviewer');
  r = recordChanges(r, [{ before: bReopened, after: rejectProposal(bReopened, { by: null, at: AT, note: 'Not a percentage item.' }) }], AT, null);
  const corrected = correctProposal(c, { by: 'Synthetic Reviewer', at: AT, note: 'A heading.' }, { ...(c.interpretation.value as object), rowClass: 'main_heading' } as never, ctx);
  r = recordChanges(r, [{ before: c, after: corrected }], AT, 'Synthetic Reviewer');
  return { run, review: r };
}

export type Mutable = Record<string, any>;

/** A deep, editable copy of a review (to simulate deliberate or accidental edits outside the app). */
export const editable = (review: SavedReview): Mutable => JSON.parse(JSON.stringify(review));

/** Renumbers history entries 1, 2, 3… after an entry was removed or moved (as a careful editor would). */
export function renumber(r: Mutable): Mutable {
  r['history'].forEach((e: Mutable, n: number) => (e['sequence'] = n + 1));
  return r;
}

/** A backup file whose checksum was RECALCULATED after editing — a deliberate edit, not damage. */
export async function deliberatelyEditedBackup(review: SavedReview, edit: (r: Mutable) => void): Promise<Uint8Array> {
  const { createBackup, reviewChecksum } = await import('../../src/core/review/index.ts');
  const json = JSON.parse(await createBackup(review, '2000-01-03T00:00:00.000Z'));
  edit(json.review);
  json.checksum.value = await reviewChecksum(json.review);
  return new TextEncoder().encode(JSON.stringify(json));
}

export const pid = (review: SavedReview, sheetIndex: number, excelRow: number) => rowOf(review, sheetIndex, excelRow).id;
