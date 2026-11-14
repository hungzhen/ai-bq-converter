/**
 * LOCAL REVIEW STORE — where saved reviews live: in THIS BROWSER only.
 *
 *   IndexedDB store  the browser's own database on this computer (normal use)
 *   memory store     kept only while the page is open (tests, or when IndexedDB is unavailable)
 *
 * Nothing is sent anywhere. Browser data can be lost if the browser's data is cleared, and it is
 * not available in another browser or on another computer — export backups to keep a copy.
 */
import { type SavedReview, reviewCounts, type ReviewCounts } from '../core/review/reviewRecord.ts';

export interface ReviewSummary {
  readonly reviewId: string;
  readonly fileName: string;
  readonly sha256: string;
  readonly createdAt: string;
  readonly savedAt: string;
  readonly reviewer: string | null;
  readonly counts: ReviewCounts;
}

export interface ReviewStore {
  readonly kind: 'indexeddb' | 'memory';
  list(): Promise<ReviewSummary[]>;
  get(reviewId: string): Promise<SavedReview | undefined>;
  put(review: SavedReview): Promise<void>;
  delete(reviewId: string): Promise<void>;
}

export const summarise = (r: SavedReview): ReviewSummary => ({
  reviewId: r.reviewId,
  fileName: r.document.fileName,
  sha256: r.document.sha256,
  createdAt: r.createdAt,
  savedAt: r.savedAt,
  reviewer: r.reviewer,
  counts: reviewCounts(r),
});

const newestFirst = (a: ReviewSummary, b: ReviewSummary) => (a.savedAt < b.savedAt ? 1 : a.savedAt > b.savedAt ? -1 : 0);

/** Plain copy (no frozen objects), as stored. */
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function createMemoryReviewStore(): ReviewStore {
  const reviews = new Map<string, SavedReview>();
  return {
    kind: 'memory',
    list: async () => [...reviews.values()].map(summarise).sort(newestFirst),
    get: async (id) => (reviews.has(id) ? plain(reviews.get(id)!) : undefined),
    put: async (r) => void reviews.set(r.reviewId, plain(r)),
    delete: async (id) => void reviews.delete(id),
  };
}

const DB_NAME = 'ai-bq-converter';
const STORE = 'reviews';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Browser storage request failed.'));
  });
}

export function createIndexedDbReviewStore(factory: IDBFactory = globalThis.indexedDB, dbName = DB_NAME): ReviewStore {
  let db: Promise<IDBDatabase> | null = null;
  const open = () =>
    (db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(dbName, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'reviewId' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Browser storage could not be opened.'));
    }));
  const tx = async (mode: IDBTransactionMode) => (await open()).transaction(STORE, mode).objectStore(STORE);

  return {
    kind: 'indexeddb',
    list: async () => ((await request((await tx('readonly')).getAll())) as SavedReview[]).map(summarise).sort(newestFirst),
    get: async (id) => (await request((await tx('readonly')).get(id))) as SavedReview | undefined,
    put: async (r) => void (await request((await tx('readwrite')).put(plain(r)))),
    delete: async (id) => void (await request((await tx('readwrite')).delete(id))),
  };
}

/** IndexedDB when the browser offers it, otherwise memory (and the screen says so). */
export function createDefaultReviewStore(): ReviewStore {
  return typeof globalThis.indexedDB !== 'undefined' ? createIndexedDbReviewStore() : createMemoryReviewStore();
}
