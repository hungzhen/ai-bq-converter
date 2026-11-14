/**
 * RESTORING A SAVED REVIEW — only onto the SAME document.
 *
 *  1. The chosen file's SHA-256 fingerprint must equal the saved review's. A matching file name is
 *     never enough. If they differ, nothing is restored and no cells are matched.
 *  2. The file is re-read exactly as before (same document id and CSV settings).
 *  3. Every saved proposal is VERIFIED AGAIN against the freshly read cells: the result must be the
 *     same as when it was saved (same cells, same quoted text). Otherwise the restore is refused.
 *  4. The whole record is checked (validate.ts): decision rules and history consistency; and
 *     every recorded correction must still fit the cited cells.
 */
import { verifyInterpretation } from '../evidence/verifyInterpretation.ts';
import type { Proposal } from '../evidence/proposals.ts';
import type { PipelineSuccess } from '../pipeline/runPipeline.ts';
import type { SavedReview } from './reviewRecord.ts';
import { decisionProblems, historyProblems, structureProblems } from './validate.ts';

export type RestoreFailureReason = 'invalid_record' | 'fingerprint_mismatch' | 'document_mismatch' | 'evidence_mismatch' | 'invalid_decisions';

export type RestoreResult =
  | { readonly ok: true; readonly proposals: readonly Proposal[] }
  | { readonly ok: false; readonly reason: RestoreFailureReason; readonly message: string; readonly details: readonly string[] };

/** The only test of "same document": identical SHA-256 fingerprints. */
export const sameFingerprint = (review: SavedReview, sha256: string): boolean => review.document.sha256 === sha256;

const codesOf = (p: { findings: readonly { code: string; severity: string }[] }) =>
  p.findings.filter((f) => f.code !== 'PROVIDER_MISMATCH').map((f) => `${f.severity}:${f.code}`).sort().join(',');

export function restoreReview(review: SavedReview, reread: PipelineSuccess): RestoreResult {
  const structure = structureProblems(review);
  if (structure.length) {
    return { ok: false, reason: 'invalid_record', message: 'The saved review is incomplete or damaged. Nothing was restored.', details: structure };
  }
  const doc = reread.extraction.document;
  if (!sameFingerprint(review, doc.sha256)) {
    return {
      ok: false,
      reason: 'fingerprint_mismatch',
      message: `This is not the same document: its fingerprint (${doc.sha256.slice(0, 12)}…) differs from the saved review's (${review.document.sha256.slice(0, 12)}…). Nothing was restored.`,
      details: [],
    };
  }
  if (doc.id !== review.document.id) {
    return { ok: false, reason: 'document_mismatch', message: 'The file was not re-read as the saved document. Nothing was restored.', details: [] };
  }

  const ctx = { project: reread.project, tables: reread.extraction.tables, documentId: doc.id };
  const evidenceProblems: string[] = [];
  for (const p of review.proposals) {
    const fresh = verifyInterpretation(p.interpretation, ctx);
    if (fresh.ok !== p.verification.ok || codesOf(fresh) !== codesOf(p.verification)) {
      evidenceProblems.push(`${p.id}: its evidence no longer checks out the same way against the file (${codesOf(fresh) || 'no findings'} now; ${codesOf(p.verification) || 'no findings'} when saved).`);
    }
  }
  if (evidenceProblems.length) {
    return { ok: false, reason: 'evidence_mismatch', message: `${evidenceProblems.length} saved proposal(s) do not match the file's cells any more. Nothing was restored.`, details: evidenceProblems };
  }

  const problems = [...decisionProblems(review), ...historyProblems(review)];
  for (const p of review.proposals) {
    if (p.status === 'rejected' && p.correction) {
      const { alternatives: _a, ...rest } = p.interpretation;
      void _a;
      const check = verifyInterpretation({ ...rest, value: p.correction.value }, ctx);
      if (!check.ok) problems.push(`${p.id}: the recorded correction no longer fits the cited cells.`);
    }
  }
  if (problems.length) {
    return { ok: false, reason: 'invalid_decisions', message: `${problems.length} problem(s) with the saved decisions or their history. Nothing was restored.`, details: problems };
  }
  return { ok: true, proposals: review.proposals };
}
