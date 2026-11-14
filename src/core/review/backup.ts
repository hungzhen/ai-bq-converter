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
 * A SHA-256 checksum of the review is stored in the file. On import, a file whose content no
 * longer matches its checksum (changed or damaged) is refused, and so is anything that is not a
 * complete, valid review of a supported version.
 */
import { DECISION_KINDS } from '../../providers/types.ts';
import { stableKey } from '../evidence/findings.ts';
import { sha256Hex } from '../extraction/hash.ts';
import { HISTORY_ACTIONS, REVIEW_FORMAT_VERSION, REVIEW_KIND, type SavedReview } from './reviewRecord.ts';

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

export type ImportResult = { readonly ok: true; readonly review: SavedReview } | { readonly ok: false; readonly errors: readonly string[] };

const checksumOf = (review: unknown) => sha256Hex(new TextEncoder().encode(stableKey(review)));

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
    checksum: { algorithm: 'SHA-256', value: await checksumOf(review) },
    review,
  };
  return JSON.stringify(file, null, 2);
}

const isString = (v: unknown): v is string => typeof v === 'string';
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Checks that something is a complete, consistent saved review. Returns plain-English problems. */
export function validateSavedReview(value: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(value)) return ['The review is missing.'];
  const r = value;
  if (r['kind'] !== REVIEW_KIND) errors.push('It is not an AI BQ Converter review.');
  if (r['formatVersion'] !== REVIEW_FORMAT_VERSION) errors.push(`It uses review format version ${String(r['formatVersion'])}; this version of the app reads version ${REVIEW_FORMAT_VERSION}.`);
  for (const key of ['reviewId', 'createdAt', 'savedAt', 'providerId']) if (!isString(r[key]) || r[key] === '') errors.push(`"${key}" is missing.`);
  const doc = r['document'];
  if (!isObject(doc) || !isString(doc['fileName']) || !isString(doc['id']) || !isString(doc['sha256']) || !/^[0-9a-f]{64}$/.test(doc['sha256'])) {
    errors.push('The original document\'s name or fingerprint is missing or invalid.');
  }
  if (!isObject(r['extractionOptions'])) errors.push('The extraction settings are missing.');
  if (r['reviewer'] !== null && !isString(r['reviewer'])) errors.push('The reviewer name is invalid.');

  const proposals = r['proposals'];
  if (!Array.isArray(proposals)) {
    errors.push('The proposals are missing.');
  } else {
    const ids = new Set<string>();
    proposals.forEach((p, n) => {
      const where = `Proposal ${n + 1}`;
      if (!isObject(p) || !isString(p['id'])) return errors.push(`${where} is invalid.`);
      if (ids.has(p['id'])) errors.push(`${where}: the id "${p['id']}" appears twice.`);
      ids.add(p['id']);
      if (!['proposed', 'approved', 'rejected'].includes(String(p['status']))) errors.push(`${where}: unknown status "${String(p['status'])}".`);
      const i = p['interpretation'];
      if (!isObject(i) || !DECISION_KINDS.includes(i['decisionKind'] as never) || !Array.isArray(i['evidence']) || i['status'] !== 'proposed') {
        return errors.push(`${where}: the original proposal is incomplete.`);
      }
      const v = p['verification'];
      if (!isObject(v) || !isString(v['subjectKey']) || !Array.isArray(v['findings']) || typeof v['ok'] !== 'boolean') {
        return errors.push(`${where}: the verification report is missing.`);
      }
      if (v['subjectKey'] !== stableKey(i)) errors.push(`${where}: the proposal does not match its verification report (it was changed).`);
      if (p['status'] !== 'proposed') {
        const d = p['decision'];
        if (!isObject(d) || !isString(d['at']) || (d['by'] !== null && !isString(d['by']))) errors.push(`${where}: the decision record is incomplete.`);
      }
    });
  }

  const history = r['history'];
  if (!Array.isArray(history) || history.length === 0) {
    errors.push('The decision history is missing.');
  } else {
    history.forEach((e, n) => {
      if (!isObject(e) || e['sequence'] !== n + 1 || !isString(e['at']) || !HISTORY_ACTIONS.includes(e['action'] as never)) errors.push(`History entry ${n + 1} is invalid.`);
    });
  }
  return errors;
}

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
  const problems = validateSavedReview(parsed['review']);
  if (problems.length) return { ok: false, errors: ['The backup is incomplete or invalid:', ...problems] };
  const checksum = parsed['checksum'];
  if (!isObject(checksum) || checksum['algorithm'] !== 'SHA-256' || checksum['value'] !== (await checksumOf(parsed['review']))) {
    return { ok: false, errors: ['The backup has been changed or damaged since it was exported (its checksum does not match). It was not imported.'] };
  }
  return { ok: true, review: parsed['review'] as SavedReview };
}
