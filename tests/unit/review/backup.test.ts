/**
 * Stage 2I — review backup export / import, and rejection of invalid or incompatible files.
 * SYNTHETIC — NOT REAL COST DATA.
 */
import { describe, expect, it } from 'vitest';
import { approveProposal, rejectProposal } from '../../../src/core/evidence/index.ts';
import { BACKUP_KIND, backupFileName, createBackup, readBackup, recordChanges } from '../../../src/core/review/index.ts';
import * as L from '../../helpers/synthetic/bqLayouts.ts';
import { utf8 } from '../../helpers/synthetic/spreadsheets.ts';
import { newReview, rowOf } from '../../helpers/reviews.ts';

const AT = '2000-01-02T10:00:00.000Z';
const bytes = (text: string) => utf8(text);

async function decidedReview() {
  const { review } = await newReview();
  const a = rowOf(review, 1, 5);
  const b = rowOf(review, 1, 22);
  let r = recordChanges(review, [{ before: a, after: approveProposal(a, { by: 'Synthetic Reviewer', at: AT, note: 'acknowledged' }, 0) }], AT, 'Synthetic Reviewer');
  r = recordChanges(r, [{ before: b, after: rejectProposal(b, { by: null, at: AT, note: 'not a percentage item' }) }], AT, null);
  return r;
}

describe('export and import', () => {
  it('round-trips the whole review: fingerprint, proposals, evidence, decisions, notes, alternatives, history', async () => {
    const review = await decidedReview();
    const text = await createBackup(review, AT);
    const result = await readBackup(bytes(text));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.review).toEqual(JSON.parse(JSON.stringify(review)));
    expect(result.review.document.sha256).toBe(review.document.sha256);
    expect(result.review.proposals.find((p) => p.id === rowOf(review, 1, 5).id)).toMatchObject({ chosen: 0, decision: { by: 'Synthetic Reviewer', note: 'acknowledged' } });
    expect(result.review.history.map((e) => e.action)).toContain('warning_acknowledged');
  });

  it('is a labelled JSON review backup — not a Cost Library upload, no recalculated figures', async () => {
    const review = await decidedReview();
    const text = await createBackup(review, AT);
    const json = JSON.parse(text);
    expect(json.kind).toBe(BACKUP_KIND);
    expect(json.notice).toContain('NOT a Cost Library upload workbook');
    expect(backupFileName(review)).toBe('SYNTHETIC_BQ.review-backup.json');
    expect(text).not.toMatch(/"(originalRate|originalAmount|quantity|rate|amount|FullBQItem)"\s*:/);
  });
});

describe('invalid or incompatible files are refused with a clear message', () => {
  it.each([
    ['an empty file', new Uint8Array(0), 'empty'],
    ['a spreadsheet', L.conventionalBq(), 'spreadsheet, not a review backup'],
    ['text that is not JSON', bytes('hello'), 'not valid JSON'],
    ['some other JSON', bytes('{"name":"x"}'), 'not an AI BQ Converter review backup'],
  ])('%s', async (_name, input, message) => {
    const result = await readBackup(input);
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.errors.join(' ')).toContain(message);
  });

  it('a backup of a different format version', async () => {
    const json = JSON.parse(await createBackup(await decidedReview(), AT));
    json.formatVersion = 99;
    const result = await readBackup(bytes(JSON.stringify(json)));
    expect(result.ok ? '' : result.errors.join(' ')).toContain('format version 99');
  });

  it('a backup edited after export (checksum no longer matches)', async () => {
    const json = JSON.parse(await createBackup(await decidedReview(), AT));
    json.review.history.at(-1).note = 'edited afterwards';
    const result = await readBackup(bytes(JSON.stringify(json)));
    expect(result.ok ? '' : result.errors.join(' ')).toContain('changed or damaged');
  });

  it('an incomplete backup (no fingerprint, no history) or one whose proposal was altered', async () => {
    const json = JSON.parse(await createBackup(await decidedReview(), AT));
    delete json.review.document.sha256;
    json.review.history = [];
    json.review.proposals[0].interpretation.confidence = 1;
    const result = await readBackup(bytes(JSON.stringify(json)));
    const text = result.ok ? '' : result.errors.join(' ');
    expect(text).toContain('fingerprint is missing');
    expect(text).toContain('history is missing');
    expect(text).toContain('does not match its verification report');
  });
});
