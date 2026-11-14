/**
 * IMPORTING A REVIEW BACKUP into this browser's saved reviews.
 *
 *  1. The backup is read and checked completely (readBackup): checksum, structure, decision rules
 *     and history consistency. Anything that fails is refused with the reasons. The backup file is
 *     only read; it is never changed.
 *  2. Unless the person has deliberately chosen "import as a separate copy", the import stops with
 *     a warning when this browser already has
 *       - a review with the same review id (the original, or an earlier import of it), or
 *       - a review imported from a backup with the same content fingerprint (backup checksum).
 *  3. The review is stored with `add`, which never overwrites: if another import stored the same
 *     id a moment earlier, this one stops with the same warning instead.
 *  4. "Import as a separate copy" stores it under a NEW id. The original is never touched.
 *
 * An "imported" history entry records the backup's file name and content checksum. No other
 * history entry is added, removed or rewritten.
 */
import { readBackup, recordEvent, reviewChecksum, type SavedReview } from '../core/review/index.ts';
import type { ReviewStore } from './reviewStore.ts';

export interface DuplicateMatch {
  readonly reviewId: string;
  readonly fileName: string | null;
  /** same_review_id: a review with this id is saved here (unchanged = identical to the backup's review). already_imported: this backup's content was imported before. */
  readonly reason: 'same_review_id' | 'already_imported';
  readonly unchanged: boolean;
}

export type ImportOutcome =
  | { readonly status: 'imported'; readonly review: SavedReview; readonly asCopy: boolean }
  | { readonly status: 'refused'; readonly errors: readonly string[] }
  | { readonly status: 'duplicate'; readonly matches: readonly DuplicateMatch[]; readonly backupChecksum: string };

export interface ImportOptions {
  readonly fileName: string;
  readonly at: string;
  readonly by: string | null;
  readonly newId: () => string;
  /** The person chose to import it as a separate copy after the duplicate warning. */
  readonly asCopy?: boolean;
}

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** What this browser already holds that matches the backup (any stored record, valid or not). */
export async function findDuplicates(store: ReviewStore, review: SavedReview, backupChecksum: string): Promise<DuplicateMatch[]> {
  const matches: DuplicateMatch[] = [];
  for (const raw of await store.rawAll()) {
    if (!isObject(raw)) continue;
    const reviewId = String(raw['reviewId']);
    const fileName = isObject(raw['document']) && typeof raw['document']['fileName'] === 'string' ? raw['document']['fileName'] : null;
    const imported = Array.isArray(raw['history']) && raw['history'].some((e) => isObject(e) && e['action'] === 'review_imported' && e['backupChecksum'] === backupChecksum);
    if (reviewId === review.reviewId) matches.push({ reviewId, fileName, reason: 'same_review_id', unchanged: (await reviewChecksum(raw)) === backupChecksum });
    else if (imported) matches.push({ reviewId, fileName, reason: 'already_imported', unchanged: false });
  }
  return matches;
}

export async function importReviewBackup(store: ReviewStore, bytes: Uint8Array, options: ImportOptions): Promise<ImportOutcome> {
  const read = await readBackup(bytes);
  if (!read.ok) return { status: 'refused', errors: read.errors };
  const { review, checksum } = read;

  const stamp = (r: SavedReview, copy: boolean) =>
    recordEvent(r, 'review_imported', options.at, options.by, `Imported from backup "${options.fileName}"${copy ? ' as a separate copy (new review id; the earlier review is unchanged)' : ''}.`, { backupChecksum: checksum });

  if (!options.asCopy) {
    const matches = await findDuplicates(store, review, checksum);
    if (matches.length) return { status: 'duplicate', matches, backupChecksum: checksum };
    const imported = stamp(review, false);
    if (await store.add(imported)) return { status: 'imported', review: imported, asCopy: false };
    // Another import stored this id a moment ago: nothing was overwritten.
    return { status: 'duplicate', matches: await findDuplicates(store, review, checksum), backupChecksum: checksum };
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const copy = stamp({ ...review, reviewId: options.newId() }, true);
    if (await store.add(copy)) return { status: 'imported', review: copy, asCopy: true };
  }
  return { status: 'refused', errors: ['A new id for the copy could not be found. Nothing was imported or changed.'] };
}
