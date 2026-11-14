/**
 * Stage 2I — the local review store (browser IndexedDB, simulated here; and memory).
 * SYNTHETIC — NOT REAL COST DATA.
 */
import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type ReviewStore, createIndexedDbReviewStore, createMemoryReviewStore } from '../../../src/storage/reviewStore.ts';
import { decidedReview, editable, newReview } from '../../helpers/reviews.ts';

const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v));

const STORES = [
  ['memory', (initial: unknown[] = []) => createMemoryReviewStore(initial)],
  [
    'IndexedDB',
    async (initial: unknown[] = []) => {
      const s = createIndexedDbReviewStore(new IDBFactory());
      for (const r of initial) await s.put(r as never); // stored exactly as given, like a record already in the browser
      return s;
    },
  ],
] as const;

describe.each(STORES)('%s store', (_name, make) => {
  it('saves, lists (newest first), reads back exactly and deletes', async () => {
    const store: ReviewStore = await make();
    const { review } = await newReview();
    const later = { ...review, reviewId: 'review-2', savedAt: '2000-01-03T00:00:00.000Z' };
    await store.put(review);
    await store.put(later);
    expect((await store.list()).map((s) => s.reviewId)).toEqual(['review-2', 'review-1']);
    expect(await store.load('review-1')).toEqual({ ok: true, review: plain(review) });
    const entry = (await store.list())[1]!;
    expect(entry.status).toBe('valid');
    if (entry.status !== 'valid') return;
    expect(entry.summary).toMatchObject({ fileName: 'SYNTHETIC_BQ.xlsx', sha256: review.document.sha256, reviewer: 'Synthetic Reviewer' });
    expect(entry.summary.counts.unresolved).toBe(review.proposals.length);
    await store.delete('review-1');
    expect(await store.load('review-1')).toBeUndefined();
    expect((await store.list()).map((s) => s.reviewId)).toEqual(['review-2']);
  });

  it('add never overwrites: an existing id is refused and the stored review is unchanged', async () => {
    const store = await make();
    const { review } = await decidedReview();
    expect(await store.add(review)).toBe(true);
    const other = { ...(await newReview()).review, reviewId: review.reviewId };
    expect(await store.add(other)).toBe(false);
    expect(await store.getRaw(review.reviewId)).toEqual(plain(review));
  });

  it('simultaneous adds of the same id: exactly one is stored', async () => {
    const store = await make();
    const { review } = await newReview();
    const results = await Promise.all([store.add(review), store.add({ ...review, savedAt: '2000-01-09T00:00:00.000Z' }), store.add(review)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await store.list())).toHaveLength(1);
  });

  it('damaged records on startup are listed as invalid with reasons, kept exactly as stored; valid ones still load', async () => {
    const { review } = await decidedReview();
    const damaged = editable(review);
    damaged['reviewId'] = 'damaged-1';
    damaged['proposals'].find((p: Record<string, unknown>) => p['status'] === 'proposed')['status'] = 'approved';
    const broken = { reviewId: 'broken-2', kind: 'ai-bq-converter.review', document: { fileName: 'SYNTHETIC_OTHER.xlsx' } };
    const store = await make([review, damaged, broken]);
    const before = plain([await store.getRaw('damaged-1'), await store.getRaw('broken-2')]);

    const entries = await store.list();
    const byId = Object.fromEntries(entries.map((e) => [e.reviewId, e]));
    expect(byId['review-1']!.status).toBe('valid');
    expect(byId['damaged-1']).toMatchObject({ status: 'invalid', fileName: 'SYNTHETIC_BQ.xlsx' });
    expect(byId['broken-2']).toMatchObject({ status: 'invalid', fileName: 'SYNTHETIC_OTHER.xlsx' });
    const loaded = await store.load('damaged-1');
    expect(loaded).toMatchObject({ ok: false, reviewId: 'damaged-1' });
    expect(loaded?.ok ? [] : loaded!.problems.join(' ')).toContain('does not match the last decision recorded in the history');

    // Preserved: listing and loading changed nothing, and the valid review still loads.
    expect([await store.getRaw('damaged-1'), await store.getRaw('broken-2')]).toEqual(before);
    expect(await store.load('review-1')).toEqual({ ok: true, review: plain(review) });
    expect(await store.rawAll()).toHaveLength(3);
  });
});

describe('IndexedDB persistence', () => {
  it('a review saved by one page is there after a "reload" (a new store on the same browser database)', async () => {
    const browserDb = new IDBFactory();
    const { review } = await newReview();
    await createIndexedDbReviewStore(browserDb).put(review);
    const afterReload = await createIndexedDbReviewStore(browserDb).load('review-1');
    expect(afterReload?.ok && afterReload.review.document.sha256).toBe(review.document.sha256);
  });

  it('a different browser database (another browser / cleared data) does not have it', async () => {
    const { review } = await newReview();
    await createIndexedDbReviewStore(new IDBFactory()).put(review);
    expect(await createIndexedDbReviewStore(new IDBFactory()).load('review-1')).toBeUndefined();
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
