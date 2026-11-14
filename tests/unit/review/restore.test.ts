/**
 * Stage 2I — restoring only onto the same document (fingerprint), with every proposal re-verified.
 * SYNTHETIC — NOT REAL COST DATA.
 */
import { describe, expect, it } from 'vitest';
import { approveProposal, correctProposal } from '../../../src/core/evidence/index.ts';
import { recordChanges, restoreReview, sameFingerprint } from '../../../src/core/review/index.ts';
import * as L from '../../helpers/synthetic/bqLayouts.ts';
import { utf8 } from '../../helpers/synthetic/spreadsheets.ts';
import { newReview, reread, rowOf } from '../../helpers/reviews.ts';

const AT = '2000-01-02T10:00:00.000Z';

describe('same document', () => {
  it('restores decisions, notes, corrections and alternatives exactly', async () => {
    const bytes = L.conventionalBq();
    const { run, review } = await newReview(bytes);
    const ctx = { project: run.project, tables: run.extraction.tables, documentId: run.extraction.document.id };
    const a = rowOf(review, 1, 5);
    const b = rowOf(review, 1, 25);
    let r = recordChanges(review, [{ before: a, after: approveProposal(a, { by: 'Synthetic Reviewer', at: AT, note: 'ack' }, 1) }], AT, 'Synthetic Reviewer');
    r = recordChanges(r, [{ before: b, after: correctProposal(b, { by: null, at: AT, note: 'heading' }, { ...(b.interpretation.value as object), rowClass: 'main_heading' } as never, ctx) }], AT, null);

    const result = restoreReview(r, await reread(r, bytes));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposals).toEqual(r.proposals);
    const restoredA = result.proposals.find((p) => p.id === a.id)!;
    expect(restoredA).toMatchObject({ status: 'approved', chosen: 1, decision: { by: 'Synthetic Reviewer', note: 'ack' } });
    expect(result.proposals.find((p) => p.id === b.id)!.correction?.value).toMatchObject({ rowClass: 'main_heading' });
  });

  it('a renamed copy of the same bytes is the same document (the fingerprint decides)', async () => {
    const bytes = L.conventionalBq();
    const { review } = await newReview(bytes);
    expect(restoreReview(review, await reread(review, bytes, 'RENAMED COPY.xlsx')).ok).toBe(true);
  });

  it('a CSV is re-read with the saved CSV settings', async () => {
    const bytes = utf8('a;b\n1;2\n');
    const { review } = await newReview(bytes, 'SYNTHETIC.csv', { csv: { delimiter: ';' } });
    expect(review.extractionOptions).toEqual({ csv: { delimiter: ';' } });
    expect(restoreReview(review, await reread(review, bytes)).ok).toBe(true);
  });
});

describe('a different document is never restored onto', () => {
  it('different content with the SAME file name: refused, nothing matched', async () => {
    const { review } = await newReview(L.conventionalBq(), 'SYNTHETIC_BQ.xlsx');
    const other = L.workingFile();
    expect(sameFingerprint(review, 'f'.repeat(64))).toBe(false);
    const result = restoreReview(review, await reread(review, other, 'SYNTHETIC_BQ.xlsx'));
    expect(result).toMatchObject({ ok: false, reason: 'fingerprint_mismatch' });
    expect(result.ok ? '' : result.message).toContain('Nothing was restored');
  });
});

describe('saved data that no longer fits is refused', () => {
  it('a saved proposal whose quoted text was changed (evidence no longer matches the file)', async () => {
    const bytes = L.conventionalBq();
    const { review } = await newReview(bytes);
    const tampered = structuredClone(review) as unknown as { proposals: { interpretation: { quotedText?: string[] } }[] };
    const target = tampered.proposals.find((p) => p.interpretation.quotedText?.length)!;
    target.interpretation.quotedText![0] = 'NOT IN THE FILE';
    const result = restoreReview(tampered as never, await reread(review, bytes));
    expect(result).toMatchObject({ ok: false, reason: 'evidence_mismatch' });
  });

  it('an approval without the required note, or of a proposal with alternatives but no choice', async () => {
    const bytes = L.conventionalBq();
    const { review } = await newReview(bytes);
    const tampered = structuredClone(review) as unknown as { proposals: Record<string, unknown>[] };
    const p = tampered.proposals.find((x) => x['id'] === rowOf(review, 1, 5).id)!;
    p['status'] = 'approved';
    p['decision'] = { by: null, at: AT };
    const result = restoreReview(tampered as never, await reread(review, bytes));
    expect(result).toMatchObject({ ok: false, reason: 'invalid_decisions' });
    expect(result.ok ? [] : result.details.join(' ')).toMatch(/no acknowledging note|without choosing/);
  });
});
