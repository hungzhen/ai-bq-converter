/**
 * LOCAL REVIEW STORE — where saved reviews live: in THIS BROWSER only.
 *
 *   IndexedDB store  the browser's own database on this computer (normal use)
 *   memory store     kept only while the page is open (tests, or when IndexedDB is unavailable)
 *
 * Nothing is sent anywhere. Browser data can be lost if the browser's data is cleared, and it is
 * not available in another browser or on another computer — export backups to keep a copy.
 *
 * Every record is CHECKED when it is loaded (src/core/review/validate.ts). A record that fails
 * is reported as invalid, with the reasons, and is KEPT EXACTLY AS STORED: it is never deleted,
 * overwritten, repaired or approved automatically. It can be exported as it is.
 *
 * `add` stores a new review only if no review with that id exists, as one atomic operation
 * (IndexedDB `add` inside a transaction). Two imports at the same moment can therefore never
 * overwrite each other or an existing review.
 */
import { type ReviewCounts, type SavedReview, reviewCounts } from '../core/review/reviewRecord.ts';
import { validateReviewRecord } from '../core/review/validate.ts';

export interface ReviewSummary {
  readonly reviewId: string;
  readonly fileName: string;
  readonly sha256: string;
  readonly createdAt: string;
  readonly savedAt: string;
  readonly reviewer: string | null;
  readonly counts: ReviewCounts;
}

/** One stored record, as listed: either a checked review or an invalid record (kept as stored). */
export type SavedReviewEntry =
  | { readonly status: 'valid'; readonly reviewId: string; readonly summary: ReviewSummary }
  | { readonly status: 'invalid'; readonly reviewId: string; readonly fileName: string | null; readonly savedAt: string | null; readonly problems: readonly string[] };

export type LoadResult =
  | { readonly ok: true; readonly review: SavedReview }
  | { readonly ok: false; readonly reviewId: string; readonly problems: readonly string[]; readonly raw: unknown };

export interface ReviewStore {
  readonly kind: 'indexeddb' | 'memory';
  /** Every stored record, checked; newest first, invalid records included (never hidden). */
  list(): Promise<SavedReviewEntry[]>;
  /** One record, checked. undefined when there is none with that id. */
  load(reviewId: string): Promise<LoadResult | undefined>;
  /** One record exactly as stored, unchecked (for exporting an invalid record as it is). */
  getRaw(reviewId: string): Promise<unknown>;
  /** Every record exactly as stored (for recognising a backup that was already imported). */
  rawAll(): Promise<unknown[]>;
  /** Saves the review that is open (same id): the autosave after each decision. */
  put(review: SavedReview): Promise<void>;
  /** Stores a NEW review atomically. false (and nothing written) if that id already exists. */
  add(review: SavedReview): Promise<boolean>;
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

const field = (raw: unknown, ...path: string[]): unknown =>
  path.reduce<unknown>((v, k) => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>)[k] : undefined), raw);
const text = (v: unknown) => (typeof v === 'string' ? v : null);

/** Checks a stored record. Nothing about the record is changed. */
export function checkRecord(raw: unknown): LoadResult {
  const reviewId = text(field(raw, 'reviewId')) ?? '(no id)';
  let problems: string[];
  try {
    problems = validateReviewRecord(raw);
  } catch (e) {
    problems = [`The record could not be checked: ${e instanceof Error ? e.message : String(e)}`];
  }
  return problems.length ? { ok: false, reviewId, problems, raw } : { ok: true, review: raw as SavedReview };
}

function entryOf(raw: unknown): SavedReviewEntry {
  const checked = checkRecord(raw);
  if (checked.ok) return { status: 'valid', reviewId: checked.review.reviewId, summary: summarise(checked.review) };
  return { status: 'invalid', reviewId: checked.reviewId, fileName: text(field(raw, 'document', 'fileName')), savedAt: text(field(raw, 'savedAt')), problems: checked.problems };
}

const savedAtOf = (e: SavedReviewEntry) => (e.status === 'valid' ? e.summary.savedAt : (e.savedAt ?? ''));
const newestFirst = (a: SavedReviewEntry, b: SavedReviewEntry) => (savedAtOf(a) < savedAtOf(b) ? 1 : savedAtOf(a) > savedAtOf(b) ? -1 : 0);

/** Plain copy (no frozen objects), as stored. */
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** The low-level part each kind of store provides. */
interface Backend {
  readonly kind: ReviewStore['kind'];
  all(): Promise<unknown[]>;
  get(id: string): Promise<unknown>;
  put(record: SavedReview): Promise<void>;
  add(record: SavedReview): Promise<boolean>;
  delete(id: string): Promise<void>;
}

function storeOver(b: Backend): ReviewStore {
  return {
    kind: b.kind,
    list: async () => (await b.all()).map(entryOf).sort(newestFirst),
    load: async (id) => {
      const raw = await b.get(id);
      return raw === undefined ? undefined : checkRecord(raw);
    },
    getRaw: (id) => b.get(id),
    rawAll: () => b.all(),
    put: (r) => b.put(plain(r)),
    add: (r) => b.add(plain(r)),
    delete: (id) => b.delete(id),
  };
}

/** A store kept in memory. `initial` records are stored exactly as given (tests use this for damaged records). */
export function createMemoryReviewStore(initial: readonly unknown[] = []): ReviewStore {
  const records = new Map<string, unknown>();
  for (const r of initial) records.set(String(field(r, 'reviewId')), plain(r));
  return storeOver({
    kind: 'memory',
    all: async () => [...records.values()].map(plain),
    get: async (id) => (records.has(id) ? plain(records.get(id)) : undefined),
    put: async (r) => void records.set(r.reviewId, r),
    // One synchronous check-and-set: nothing can run in between.
    add: async (r) => (records.has(r.reviewId) ? false : (records.set(r.reviewId, r), true)),
    delete: async (id) => void records.delete(id),
  });
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

  return storeOver({
    kind: 'indexeddb',
    all: async () => (await request((await tx('readonly')).getAll())) as unknown[],
    get: async (id) => (await request((await tx('readonly')).get(id))) as unknown,
    put: async (r) => void (await request((await tx('readwrite')).put(r))),
    // IndexedDB's own `add` refuses an existing key inside its transaction: atomic, never overwrites.
    add: async (r) => {
      const req = (await tx('readwrite')).add(r);
      return new Promise<boolean>((resolve, reject) => {
        req.onsuccess = () => resolve(true);
        req.onerror = (event) => {
          if (req.error?.name === 'ConstraintError') {
            event.preventDefault(); // expected: that id exists; nothing was written
            resolve(false);
          } else reject(req.error ?? new Error('Browser storage request failed.'));
        };
      });
    },
    delete: async (id) => void (await request((await tx('readwrite')).delete(id))),
  });
}

/** IndexedDB when the browser offers it, otherwise memory (and the screen says so). */
export function createDefaultReviewStore(): ReviewStore {
  return typeof globalThis.indexedDB !== 'undefined' ? createIndexedDbReviewStore() : createMemoryReviewStore();
}
