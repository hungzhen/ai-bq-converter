/**
 * Stage 2I hardening — importing backups: duplicates recognised, simultaneous imports, and no
 * existing review or decision ever overwritten. SYNTHETIC — NOT REAL COST DATA.
 */
import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createBackup, recordChanges, reviewChecksum } from '../../../src/core/review/index.ts';
import { rejectProposal } from '../../../src/core/evidence/index.ts';
import { importReviewBackup } from '../../../src/storage/importReview.ts';
import { type ReviewStore, createIndexedDbReviewStore, createMemoryReviewStore } from '../../../src/storage/reviewStore.ts';
import { decidedReview, deliberatelyEditedBackup, rowOf } from '../../helpers/reviews.ts';

const AT = '2000-01-05T00:00:00.000Z';
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v));
let n = 0;
const opts = (extra: { asCopy?: boolean; newId?: () => string } = {}) => ({ fileName: 'SYNTHETIC_BQ.review-backup.json', at: AT, by: 'Synthetic Reviewer', newId: () => `copy-${++n}`, ...extra });

async function backupOf() {
  const { review } = await decidedReview();
  const text = await createBackup(review, AT);
  return { review, bytes: new TextEncoder().encode(text), checksum: await reviewChecksum(review) };
}

describe.each([
  ['memory', () => createMemoryReviewStore()],
  ['IndexedDB', () => createIndexedDbReviewStore(new IDBFactory())],
] as const)('%s store', (_name, make) => {
  it('importing while the original review still exists: warned, nothing imported, original unchanged', async () => {
    const store: ReviewStore = make();
    const { review, bytes } = await backupOf();
    await store.add(review);
    const outcome = await importReviewBackup(store, bytes, opts());
    expect(outcome).toMatchObject({ status: 'duplicate', matches: [{ reviewId: review.reviewId, reason: 'same_review_id', unchanged: true }] });
    expect(await store.rawAll()).toEqual([plain(review)]);
  });

  it('original changed since the export: still warned; its newer decisions are not overwritten', async () => {
    const store = make();
    const { review, bytes } = await backupOf();
    const p = review.proposals.find((x) => x.status === 'proposed')!;
    const newer = recordChanges(review, [{ before: p, after: rejectProposal(p, { by: 'Synthetic Reviewer', at: AT }) }], AT, 'Synthetic Reviewer');
    await store.add(newer);
    const outcome = await importReviewBackup(store, bytes, opts());
    expect(outcome).toMatchObject({ status: 'duplicate', matches: [{ reason: 'same_review_id', unchanged: false }] });
    expect(await store.getRaw(review.reviewId)).toEqual(plain(newer));
  });

  it('deliberate "import as a separate copy": new id, original untouched, the import is recorded with the backup checksum', async () => {
    const store = make();
    const { review, bytes, checksum } = await backupOf();
    await store.add(review);
    const outcome = await importReviewBackup(store, bytes, opts({ asCopy: true }));
    expect(outcome.status).toBe('imported');
    if (outcome.status !== 'imported') return;
    expect(outcome.review.reviewId).not.toBe(review.reviewId);
    expect(outcome.review.history.at(-1)).toMatchObject({ action: 'review_imported', backupChecksum: checksum });
    expect(outcome.review.history.slice(0, -1)).toEqual(review.history.map(plain)); // nothing invented or rewritten
    expect(await store.getRaw(review.reviewId)).toEqual(plain(review));
    expect((await store.list()).every((e) => e.status === 'valid')).toBe(true);
  });

  it('importing the same backup twice: the second time is recognised by its content fingerprint', async () => {
    const store = make();
    const { bytes, checksum } = await backupOf();
    expect((await importReviewBackup(store, bytes, opts())).status).toBe('imported');
    const again = await importReviewBackup(store, bytes, opts());
    expect(again).toMatchObject({ status: 'duplicate', backupChecksum: checksum });
    // Even with the first import stored as a copy (different id), the same backup is still recognised.
    const store2 = make();
    await importReviewBackup(store2, bytes, opts({ asCopy: true }));
    const third = await importReviewBackup(store2, bytes, opts());
    expect(third).toMatchObject({ status: 'duplicate', matches: [{ reason: 'already_imported' }] });
    expect(await store2.rawAll()).toHaveLength(1);
  });

  it('simultaneous imports of the same backup: exactly one is stored, the others are warned', async () => {
    const store = make();
    const { bytes } = await backupOf();
    const outcomes = await Promise.all([1, 2, 3].map(() => importReviewBackup(store, bytes, opts())));
    expect(outcomes.filter((o) => o.status === 'imported')).toHaveLength(1);
    expect(outcomes.filter((o) => o.status === 'duplicate')).toHaveLength(2);
    expect(await store.rawAll()).toHaveLength(1);
  });

  it('simultaneous "separate copy" imports each get their own id; the original is never overwritten', async () => {
    const store = make();
    const { review, bytes } = await backupOf();
    await store.add(review);
    const outcomes = await Promise.all([1, 2].map(() => importReviewBackup(store, bytes, opts({ asCopy: true }))));
    expect(outcomes.map((o) => o.status)).toEqual(['imported', 'imported']);
    expect(await store.rawAll()).toHaveLength(3);
    expect(await store.getRaw(review.reviewId)).toEqual(plain(review));
  });

  it('an id collision while copying never overwrites: retried, then refused', async () => {
    const store = make();
    const { review, bytes } = await backupOf();
    await store.add(review);
    const outcome = await importReviewBackup(store, bytes, opts({ asCopy: true, newId: () => review.reviewId }));
    expect(outcome).toMatchObject({ status: 'refused' });
    expect(await store.rawAll()).toEqual([plain(review)]);
  });

  it('a backup that fails its checks is refused and nothing is stored', async () => {
    const store = make();
    const { review } = await decidedReview();
    const bytes = await deliberatelyEditedBackup(review, (r) => void (r['proposals'].find((p: Record<string, unknown>) => p['id'] === rowOf(review, 1, 22).id)['status'] = 'approved'));
    const outcome = await importReviewBackup(store, bytes, opts());
    expect(outcome).toMatchObject({ status: 'refused' });
    expect(await store.rawAll()).toEqual([]);
  });
});
