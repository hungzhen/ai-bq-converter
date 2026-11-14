/**
 * REVIEW BACKUP FILES — export a saved review to a .json file and import it again.
 *
 * A backup holds the whole saved review: document identity and fingerprint, CSV settings, every
 * original proposal with its evidence (cell references and quoted text) and verification report,
 * every decision, note, correction and chosen alternative, and the full history. It holds no
 * spreadsheet contents and no calculated or invented BQ figures.
 *
 * It is NOT a Cost Library upload workbook: it is JSON, it is labelled as a review backup, and
 * importing a spreadsheet as a backup is refused.
 *
 * A SHA-256 checksum of the review is stored in the file. It is an ORDINARY hash with no secret
 * key or signature: it detects accidental damage and casual edits, but anyone who edits the file
 * deliberately can work the checksum out again. It does not prevent deliberate tampering.
 *
 * On import the review is also checked completely (validate.ts): structure, decision rules
 * (approval eligibility, warning notes, chosen alternatives, corrections) and the consistency of
 * the history with the current decisions. Anything that fails is refused with the reasons; the
 * backup file itself is only read, never changed.
 */
import { stableKey } from '../evidence/findings.ts';
import { sha256Hex } from '../extraction/hash.ts';
import { REVIEW_FORMAT_VERSION, type SavedReview } from './reviewRecord.ts';
import { validateReviewRecord } from './validate.ts';

export const BACKUP_KIND = 'ai-bq-converter.review-backup';
export const BACKUP_NOTICE =
  'AI BQ Converter review backup. Contains review decisions and evidence references only — no spreadsheet contents and no calculated BQ figures. This is NOT a Cost Library upload workbook.';

export interface BackupFile {
  readonly kind: typeof BACKUP_KIND;
  readonly formatVersion: typeof REVIEW_FORMAT_VERSION;
  readonly notice: string;
  readonly exportedAt: string;
  readonly checksum: { readonly algorithm: 'SHA-256'; readonly value: string };
  readonly review: SavedReview;
}

export type ImportResult = { readonly ok: true; readonly review: SavedReview; readonly checksum: string } | { readonly ok: false; readonly errors: readonly string[] };

/** The backup-content fingerprint: SHA-256 of the review's stable text form (no secret key). */
export const reviewChecksum = (review: unknown) => sha256Hex(new TextEncoder().encode(stableKey(review)));

/** The file name suggested for a backup. */
export function backupFileName(review: SavedReview): string {
  const base = review.document.fileName.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_');
  return `${base}.review-backup.json`;
}

export async function createBackup(review: SavedReview, exportedAt: string): Promise<string> {
  const file: BackupFile = {
    kind: BACKUP_KIND,
    formatVersion: REVIEW_FORMAT_VERSION,
    notice: BACKUP_NOTICE,
    exportedAt,
    checksum: { algorithm: 'SHA-256', value: await reviewChecksum(review) },
    review,
  };
  return JSON.stringify(file, null, 2);
}

/**
 * Kept for compatibility: the complete check of a saved review (structure, decision rules and
 * history consistency). See validate.ts.
 */
export const validateSavedReview = validateReviewRecord;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Reads a backup file's bytes. Refuses anything that is not a valid, unchanged review backup. */
export async function readBackup(bytes: Uint8Array): Promise<ImportResult> {
  if (bytes.length === 0) return { ok: false, errors: ['The file is empty.'] };
  if ((bytes[0] === 0x50 && bytes[1] === 0x4b) || (bytes[0] === 0xd0 && bytes[1] === 0xcf)) {
    return { ok: false, errors: ['This is a spreadsheet, not a review backup. Review backups are .json files exported from this app.'] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return { ok: false, errors: ['This file is not a review backup (it is not valid JSON).'] };
  }
  if (!isObject(parsed) || parsed['kind'] !== BACKUP_KIND) {
    return { ok: false, errors: ['This file is not an AI BQ Converter review backup.'] };
  }
  if (parsed['formatVersion'] !== REVIEW_FORMAT_VERSION) {
    return { ok: false, errors: [`This backup uses format version ${String(parsed['formatVersion'])}; this version of the app reads version ${REVIEW_FORMAT_VERSION}.`] };
  }
  const checksum = parsed['checksum'];
  const actual = await reviewChecksum(parsed['review']);
  const checksumOk = isObject(checksum) && checksum['algorithm'] === 'SHA-256' && checksum['value'] === actual;
  const problems = validateReviewRecord(parsed['review']);
  if (!checksumOk || problems.length) {
    return {
      ok: false,
      errors: [
        ...(checksumOk ? [] : ['The backup has been changed or damaged since it was exported (its checksum does not match). It was not imported.']),
        ...(problems.length ? ['The review in the backup did not pass its checks, so it was not imported:', ...problems] : []),
      ],
    };
  }
  return { ok: true, review: parsed['review'] as SavedReview, checksum: actual };
}
