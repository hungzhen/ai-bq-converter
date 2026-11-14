/**
 * Stage 2I — the local review store (browser IndexedDB, simulated here; and memory).
 * SYNTHETIC — NOT REAL COST DATA.
 */
import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type ReviewStore, createIndexedDbReviewStore, createMemoryReviewStore } from '../../../src/storage/reviewStore.ts';
import { newReview } from '../../helpers/reviews.ts';

describe.each([
  ['memory', () => createMemoryReviewStore()],
  ['IndexedDB', () => createIndexedDbReviewStore(new IDBFactory())],
] as const)('%s store', (_name, make) => {
  it('saves, lists (newest first), reads back exactly and deletes', async () => {
    const store: ReviewStore = make();
    const { review } = await newReview();
    const later = { ...review, reviewId: 'review-2', savedAt: '2000-01-03T00:00:00.000Z' };
    await store.put(review);
    await store.put(later);
    expect((await store.list()).map((s) => s.reviewId)).toEqual(['review-2', 'review-1']);
    expect(await store.get('review-1')).toEqual(JSON.parse(JSON.stringify(review)));
    const summary = (await store.list())[1]!;
    expect(summary).toMatchObject({ fileName: 'SYNTHETIC_BQ.xlsx', sha256: review.document.sha256, reviewer: 'Synthetic Reviewer' });
    expect(summary.counts.unresolved).toBe(review.proposals.length);
    await store.delete('review-1');
    expect(await store.get('review-1')).toBeUndefined();
    expect((await store.list()).map((s) => s.reviewId)).toEqual(['review-2']);
  });
});

describe('IndexedDB persistence', () => {
  it('a review saved by one page is there after a "reload" (a new store on the same browser database)', async () => {
    const browserDb = new IDBFactory();
    const { review } = await newReview();
    await createIndexedDbReviewStore(browserDb).put(review);
    const afterReload = createIndexedDbReviewStore(browserDb);
    expect((await afterReload.get('review-1'))?.document.sha256).toBe(review.document.sha256);
  });

  it('a different browser database (another browser / cleared data) does not have it', async () => {
    const { review } = await newReview();
    await createIndexedDbReviewStore(new IDBFactory()).put(review);
    expect(await createIndexedDbReviewStore(new IDBFactory()).get('review-1')).toBeUndefined();
  });
});

describe('no network or external storage', () => {
  it('no application file sends data anywhere or refers to an external service', () => {
    const src = resolve(import.meta.dirname, '../../../src');
    const files: string[] = [];
    const walk = (d: string) => readdirSync(d).forEach((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : /\.(ts|tsx)$/.test(n) && files.push(join(d, n))));
    walk(src);
    for (const f of files) {
      const code = readFileSync(f, 'utf8');
      expect(code, f).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket\s*\(|sendBeacon|EventSource\s*\(/);
      expect(code, f).not.toMatch(/supabase|cloudflare|firebase/i);
      expect(code, f).not.toMatch(/https?:\/\/(?!localhost)/);
    }
  });
});
