/**
 * Stage 2J — draft rows from saved and restored reviews, project details in the history, and
 * backward compatibility with reviews and backups saved by Stage 2I.
 * SYNTHETIC — NOT REAL COST DATA.
 */
import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  type SavedReview,
  ProjectDetailsError,
  createBackup,
  readBackup,
  restoreReview,
  setProjectDetails,
  validateReviewRecord,
} from '../../../src/core/review/index.ts';
import { decideDraftRow, verifyDrafts, viewRow } from '../../../src/core/staging/index.ts';
import { createIndexedDbReviewStore, createMemoryReviewStore } from '../../../src/storage/reviewStore.ts';
import { importReviewBackup } from '../../../src/storage/importReview.ts';
import { draftsBq } from '../../helpers/synthetic/draftLayouts.ts';
import { editable, newReview, reread } from '../../helpers/reviews.ts';
import { AT, SYNTHETIC_PROJECT, approveAll, drafts, withProject } from '../../helpers/drafts.ts';

const FIXTURES = resolve(import.meta.dirname, '../../fixtures/stage2i');
const oldBackupBytes = () => new Uint8Array(readFileSync(`${FIXTURES}/SYNTHETIC_BQ.review-backup.json`));
const oldFileBytes = () => new Uint8Array(readFileSync(`${FIXTURES}/SYNTHETIC_BQ.xlsx`));
const opts = { fileName: 'SYNTHETIC_BQ.review-backup.json', at: AT, by: 'Synthetic Reviewer', newId: () => 'copy-1' };

describe('project details', () => {
  it('are recorded in the history with the earlier values; blank fields are "not entered"', async () => {
    const { review } = await newReview(draftsBq(), 'SYNTHETIC_DRAFTS.xlsx');
    const first = setProjectDetails(review, { name: '  SYNTHETIC PROJECT  ', year: '', projectRef: null, location: null }, AT, 'Synthetic Reviewer');
    expect(first.projectDetails).toEqual({ name: 'SYNTHETIC PROJECT', year: null, projectRef: null, location: null });
    const second = setProjectDetails(first, { ...first.projectDetails!, year: '2024 Q1' }, AT, null);
    const events = second.history.filter((e) => e.action === 'project_details_changed');
    expect(events.map((e) => [e.details?.previous?.year ?? null, e.details?.next.year])).toEqual([[null, null], [null, '2024 Q1']]);
    expect(validateReviewRecord(second)).toEqual([]);
    expect(setProjectDetails(second, second.projectDetails!, AT, null)).toBe(second); // no change, no entry
  });

  it('a year in the wrong form is refused, not corrected', async () => {
    const { review } = await newReview(draftsBq(), 'SYNTHETIC_DRAFTS.xlsx');
    expect(() => setProjectDetails(review, { ...SYNTHETIC_PROJECT, year: '2024' }, AT, null)).toThrow(ProjectDetailsError);
  });

  it('project details edited outside the app (no matching history entry) fail the checks', async () => {
    const { review } = await newReview(draftsBq(), 'SYNTHETIC_DRAFTS.xlsx');
    const r = editable(withProject(review));
    r['projectDetails']['name'] = 'EDITED';
    expect(validateReviewRecord(r).join(' ')).toContain('do not match the last project details recorded in the history');
  });
});

describe('drafts from saved and restored reviews', () => {
  async function decided() {
    const { run, review } = await newReview(draftsBq(), 'SYNTHETIC_DRAFTS.xlsx');
    return { run, review: withProject(approveAll(review)) };
  }

  it('saved in the browser, reloaded and restored onto the same file: identical drafts', async () => {
    const { run, review } = await decided();
    const browserDb = new IDBFactory();
    await createIndexedDbReviewStore(browserDb).put(review);
    const loaded = await createIndexedDbReviewStore(browserDb).load(review.reviewId);
    expect(loaded?.ok).toBe(true);
    const saved = (loaded as { review: SavedReview }).review;
    const again = await reread(saved, draftsBq());
    expect(restoreReview(saved, again).ok).toBe(true);
    const after = drafts(saved, again);
    expect(JSON.stringify(after)).toBe(JSON.stringify(drafts(review, run)));
    expect(verifyDrafts(after, again.extraction.tables)).toEqual([]);
  });

  it('exported as a backup and imported: same project details, same drafts', async () => {
    const { run, review } = await decided();
    const store = createMemoryReviewStore();
    const outcome = await importReviewBackup(store, new TextEncoder().encode(await createBackup(review, AT)), opts);
    expect(outcome.status).toBe('imported');
    const imported = (outcome as { review: SavedReview }).review;
    expect(imported.projectDetails).toEqual(SYNTHETIC_PROJECT);
    const again = await reread(imported, draftsBq());
    expect(restoreReview(imported, again).ok).toBe(true);
    expect(JSON.stringify(drafts(imported, again).tables)).toBe(JSON.stringify(drafts(review, run).tables));
  });
});

describe('backward compatibility with Stage 2I', () => {
  it('a backup exported by the Stage 2I app still imports, reopens and gives drafts (project details "not entered")', async () => {
    const read = await readBackup(oldBackupBytes());
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.review.projectDetails).toBeUndefined();
    expect(validateReviewRecord(read.review)).toEqual([]);

    const store = createIndexedDbReviewStore(new IDBFactory());
    const outcome = await importReviewBackup(store, oldBackupBytes(), opts);
    expect(outcome.status).toBe('imported');
    const imported = (outcome as { review: SavedReview }).review;
    const again = await reread(imported, oldFileBytes());
    expect(restoreReview(imported, again)).toMatchObject({ ok: true });

    const d = drafts(imported, again);
    expect(d.projectIssues.map((i) => i.code)).toEqual(['PROJECT_NAME_NOT_ENTERED', 'PROJECT_YEAR_NOT_ENTERED']);
    expect(d.documentBlockers).toEqual(['The document type has not been decided yet.']); // that review approved one proposal only
    expect(verifyDrafts(d, again.extraction.tables)).toEqual([]);

    // Continue the old review in Stage 2J: decide everything, enter the project; still a valid record.
    const continued = withProject(approveAll(imported));
    expect(validateReviewRecord(continued)).toEqual([]);
    const ready = drafts(continued, again);
    expect(ready.tables.filter((t) => t.status === 'ready').map((t) => t.name)).toEqual(['Bill 2', 'Bill 3']);
  });

  it('a review saved in the browser by Stage 2I loads as valid and its file is unchanged', async () => {
    const old = JSON.parse(readFileSync(`${FIXTURES}/SYNTHETIC_BQ.review-backup.json`, 'utf8')).review;
    const store = createMemoryReviewStore([old]);
    const [entry] = await store.list();
    expect(entry).toMatchObject({ status: 'valid', reviewId: old.reviewId });
    const before = readFileSync(`${FIXTURES}/SYNTHETIC_BQ.xlsx`);
    const loaded = await store.load(old.reviewId);
    expect(loaded?.ok).toBe(true);
    expect(restoreReview((loaded as { review: SavedReview }).review, await reread(old, oldFileBytes())).ok).toBe(true);
    expect(readFileSync(`${FIXTURES}/SYNTHETIC_BQ.xlsx`).equals(before)).toBe(true);
  });
});

describe('Stage 2K row decisions are kept and older reviews still work', () => {
  const FIX2J = resolve(import.meta.dirname, '../../fixtures/stage2j');

  it('row decisions survive saving, reloading, restoring and a backup round trip', async () => {
    const { run, review } = await newReview(draftsBq(), 'SYNTHETIC_DRAFTS.xlsx');
    let r = withProject(approveAll(review));
    const t = drafts(r, run).tables[0]!;
    const neg = t.drafts.find((d) => d.itemRowIndex === 6)!;
    const clean = t.drafts.find((d) => d.itemRowIndex === 7)!;
    r = decideDraftRow(r, neg, 'excluded', 'Negative credit: excluded from the upload.', AT, 'Synthetic Reviewer');
    r = decideDraftRow(r, clean, 'approved', null, AT, 'Synthetic Reviewer');

    const browserDb = new IDBFactory();
    await createIndexedDbReviewStore(browserDb).put(r);
    const loaded = (await createIndexedDbReviewStore(browserDb).load(r.reviewId)) as { ok: true; review: SavedReview };
    expect(loaded.ok).toBe(true);
    const again = await reread(loaded.review, draftsBq());
    expect(restoreReview(loaded.review, again).ok).toBe(true);

    const outcome = await importReviewBackup(createMemoryReviewStore(), new TextEncoder().encode(await createBackup(loaded.review, AT)), opts);
    const imported = (outcome as { review: SavedReview }).review;
    for (const rv of [loaded.review, imported]) {
      const t2 = drafts(rv, again).tables[0]!;
      const states = rv.draftRows ?? [];
      expect(viewRow(t2.drafts.find((d) => d.itemRowIndex === 6)!, states.find((s) => s.draftId === neg.row.id)!).effective).toBe('excluded');
      expect(viewRow(t2.drafts.find((d) => d.itemRowIndex === 7)!, states.find((s) => s.draftId === clean.row.id)!).effective).toBe('approved');
      expect(t2.drafts.find((d) => d.itemRowIndex === 6)!.row.item.amount).toBe(-200);
    }
  });

  it('a Stage 2J backup (project details, no row decisions) imports, reopens and gets row decisions', async () => {
    const bytes = new Uint8Array(readFileSync(`${FIX2J}/SYNTHETIC_DRAFTS.review-backup.json`));
    const read = await readBackup(bytes);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.review.draftRows).toBeUndefined();
    const file = new Uint8Array(readFileSync(`${FIX2J}/SYNTHETIC_DRAFTS.xlsx`));
    const again = await reread(read.review, file);
    expect(restoreReview(read.review, again).ok).toBe(true);
    const t = drafts(read.review, again).tables[0]!;
    expect(t.drafts.map((d) => viewRow(d, null).effective).every((s) => s === 'pending')).toBe(true);
    const r = decideDraftRow(read.review, t.drafts.find((d) => d.itemRowIndex === 7)!, 'approved', null, AT, null);
    expect(validateReviewRecord(r)).toEqual([]);
  });

  it('a Stage 2I backup still imports and has no row decisions until a reviewer makes them', async () => {
    const read = await readBackup(oldBackupBytes());
    expect(read.ok && read.review.draftRows).toBeUndefined();
  });
});
