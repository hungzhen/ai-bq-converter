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
