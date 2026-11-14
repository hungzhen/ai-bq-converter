/**
 * Stage 2I hardening — checking a saved review completely: decision rules and history consistency,
 * on import (backups whose checksum was deliberately recalculated) and on restore.
 * SYNTHETIC — NOT REAL COST DATA.
 */
import { describe, expect, it } from 'vitest';
import { readBackup, restoreReview, validateReviewRecord } from '../../../src/core/review/index.ts';
import * as L from '../../helpers/synthetic/bqLayouts.ts';
import { type Mutable as M, decidedReview, deliberatelyEditedBackup, editable, pid, renumber, reread } from '../../helpers/reviews.ts';

const prop = (r: M, id: string): M => r['proposals'].find((p: M) => p['id'] === id);
const events = (r: M, id: string, action?: string): M[] => r['history'].filter((e: M) => e['proposalId'] === id && (!action || e['action'] === action));

/** Imports a deliberately edited backup; returns all refusal reasons as one text. */
async function refusal(edit: (r: M, ids: { warned: string; reopened: string; corrected: string }) => void): Promise<string> {
  const { review } = await decidedReview();
  const ids = { warned: pid(review, 1, 5), reopened: pid(review, 1, 22), corrected: pid(review, 1, 25) };
  const result = await readBackup(await deliberatelyEditedBackup(review, (r) => edit(r, ids)));
  expect(result.ok).toBe(false);
  const text = result.ok ? '' : result.errors.join('\n');
  expect(text).not.toContain('checksum does not match'); // the checksum was recalculated: only the content checks catch it
  return text;
}

describe('a review made through the application passes every check', () => {
  it('approvals with warnings and alternatives, a reopened decision, a rejection and a correction', async () => {
    const { review } = await decidedReview();
    expect(validateReviewRecord(review)).toEqual([]);
    expect(validateReviewRecord(JSON.parse(JSON.stringify(review)))).toEqual([]); // as stored
  });
});

describe('deliberately altered approval status (checksum recalculated) is refused on import', () => {
  it('an undecided proposal edited to "approved", with a plausible decision', async () => {
    const text = await refusal((r) => {
      const p = r['proposals'].find((x: M) => x['status'] === 'proposed' && !x['interpretation']['alternatives'] && !x['verification']['findings'].some((f: M) => f['severity'] === 'warning'));
      p['status'] = 'approved';
      p['decision'] = { by: 'Synthetic Reviewer', at: '2000-01-02T10:00:00.000Z' };
      p['chosen'] = 'primary';
    });
    expect(text).toMatch(/current decision \(approved\) does not match the last decision recorded in the history/);
  });

  it('a rejected proposal edited to "approved"', async () => {
    const text = await refusal((r, ids) => {
      const p = prop(r, ids.reopened);
      p['status'] = 'approved';
      p['chosen'] = 'primary';
    });
    expect(text).toContain('does not match the last decision recorded in the history');
  });

  it('approval of a proposal that failed verification', async () => {
    const text = await refusal((r, ids) => {
      const v = prop(r, ids.warned)['verification'];
      v['findings'].push({ code: 'QUOTE_MISMATCH', severity: 'blocking', message: 'SYNTHETIC' });
      v['ok'] = false;
    });
    expect(text).toContain('approved although it failed verification');
  });

  it('the verification result edited to disagree with its findings', async () => {
    const text = await refusal((r, ids) => void (prop(r, ids.corrected)['verification']['ok'] = !prop(r, ids.corrected)['verification']['ok']));
    expect(text).toContain('does not agree with its findings');
  });
});

describe('missing warning acknowledgement', () => {
  it('the acknowledging note removed from the approval (and its history entries)', async () => {
    const text = await refusal((r, ids) => {
      delete prop(r, ids.warned)['decision']['note'];
      for (const e of events(r, ids.warned)) delete e['note'];
    });
    expect(text).toContain('approved with warnings but no acknowledging note');
  });

  it('the "warning acknowledged" history entry removed (history renumbered)', async () => {
    const text = await refusal((r, ids) => {
      r['history'] = r['history'].filter((e: M) => !(e['proposalId'] === ids.warned && e['action'] === 'warning_acknowledged'));
      renumber(r);
    });
    expect(text).toContain('the warning acknowledgement is missing from the history');
  });
});

describe('invalid correction or alternative', () => {
  it('a chosen alternative that does not exist', async () => {
    const text = await refusal((r, ids) => {
      prop(r, ids.warned)['chosen'] = 7;
      for (const e of events(r, ids.warned)) e['next']['chosen'] = 7;
    });
    expect(text).toContain('the chosen alternative (7) does not exist');
  });

  it('an approval with alternatives but no choice', async () => {
    const text = await refusal((r, ids) => void delete prop(r, ids.warned)['chosen']);
    expect(text).toContain('approved without choosing among its alternatives');
  });

  it('a correction value edited after it was checked', async () => {
    const text = await refusal((r, ids) => {
      prop(r, ids.corrected)['correction']['value']['rowClass'] = 'total';
      for (const e of events(r, ids.corrected, 'correction_recorded')) e['next']['correctionValue']['rowClass'] = 'total';
    });
    expect(text).toContain('the recorded correction was changed after it was checked');
  });

  it('a correction without its explaining note', async () => {
    const text = await refusal((r, ids) => {
      delete prop(r, ids.corrected)['decision']['note'];
      for (const e of events(r, ids.corrected)) {
        delete e['note'];
        if (e['next']['decision']) delete e['next']['decision']['note'];
      }
    });
    expect(text).toContain('a correction needs an explaining note');
  });

  it('a correction attached to an approval', async () => {
    const text = await refusal((r, ids) => void (prop(r, ids.warned)['correction'] = prop(r, ids.corrected)['correction']));
    expect(text).toContain('an approved proposal cannot also carry a correction');
  });
});

describe('inconsistent proposal and history data', () => {
  it('a history entry removed (renumbered so the numbering looks right)', async () => {
    const text = await refusal((r, ids) => {
      r['history'] = r['history'].filter((e: M) => !(e['proposalId'] === ids.reopened && e['action'] === 'decision_reopened'));
      renumber(r);
    });
    expect(text).toMatch(/"before" state does not match the proposal's state at that point/);
  });

  it('history entries reordered', async () => {
    const text = await refusal((r, ids) => {
      const h = r['history'];
      const i = h.findIndex((e: M) => e['proposalId'] === ids.reopened && e['action'] === 'approved');
      const j = h.findIndex((e: M) => e['proposalId'] === ids.reopened && e['action'] === 'rejected');
      [h[i], h[j]] = [h[j], h[i]];
      renumber(r);
    });
    expect(text).toContain('does not match the proposal\'s state at that point');
  });

  it('a gap in the numbering', async () => {
    expect(await refusal((r) => void (r['history'][3]['sequence'] = 99))).toContain('numbered 99');
  });

  it('an entry for an unknown proposal, a proposal created twice, a missing "review created"', async () => {
    const text = await refusal((r, ids) => {
      r['history'].push({ ...r['history'][2], sequence: r['history'].length + 1, proposalId: 'not-in-this-review' });
      r['history'].push({ ...events(r, ids.warned, 'proposal_created')[0], sequence: r['history'].length + 1 });
      r['history'][0]['action'] = 'review_restored';
    });
    expect(text).toContain('not in this review');
    expect(text).toContain('the proposal is created twice');
    expect(text).toContain('does not start with "review created"');
  });

  it('a decision whose name or note differs between the proposal and its history', async () => {
    const text = await refusal((r, ids) => {
      prop(r, ids.warned)['decision']['by'] = 'Someone Else';
    });
    expect(text).toContain('does not match the last decision recorded in the history');
  });
});

describe('the backup file itself is not changed by reading it', () => {
  it('bytes are identical after a refused import', async () => {
    const { review } = await decidedReview();
    const bytes = await deliberatelyEditedBackup(review, (r) => void (r['proposals'][0]['status'] = 'approved'));
    const copy = bytes.slice();
    await readBackup(bytes);
    expect(bytes).toEqual(copy);
  });
});

describe('restoring checks the whole record too', () => {
  it('a saved review whose history was edited is not restored, even onto the right file', async () => {
    const { review } = await decidedReview();
    const r = editable(review);
    r['history'] = r['history'].filter((e: M) => e['action'] !== 'decision_reopened');
    renumber(r);
    const result = restoreReview(r as never, await reread(review, L.conventionalBq()));
    expect(result).toMatchObject({ ok: false, reason: 'invalid_decisions' });
  });

  it('a valid review still restores exactly', async () => {
    const { review } = await decidedReview();
    const result = restoreReview(JSON.parse(JSON.stringify(review)), await reread(review, L.conventionalBq()));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.proposals).toEqual(JSON.parse(JSON.stringify(review.proposals)));
  });
});

describe('LIMITATION (documented): the checks are not tamper-proof', () => {
  it('a careful, fully consistent edit — a note changed everywhere and the checksum recalculated — is accepted', async () => {
    const { review } = await decidedReview();
    const id = pid(review, 1, 22);
    const bytes = await deliberatelyEditedBackup(review, (r) => {
      prop(r, id)['decision']['note'] = 'EDITED OUTSIDE THE APP';
      for (const e of events(r, id, 'rejected')) {
        e['note'] = 'EDITED OUTSIDE THE APP';
        e['next']['decision']['note'] = 'EDITED OUTSIDE THE APP';
      }
    });
    const result = await readBackup(bytes);
    expect(result.ok).toBe(true); // nothing in a browser-only app can prove this was not edited
  });
});
