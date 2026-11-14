/**
 * CHECKING A SAVED REVIEW — used when a saved review is loaded from this browser, when a review
 * backup is imported, and before a review is restored onto its original file.
 *
 * Three groups of checks, all reported in plain English (nothing is repaired or changed):
 *
 *   1. STRUCTURE  — every required part is present and of the right type.
 *   2. DECISIONS  — every decision obeys the same rules the review screen enforces:
 *                   no approval of a proposal that failed verification; warnings acknowledged
 *                   with a note; a chosen reading for every approval (and a real alternative when
 *                   one is chosen); a correction only with a rejection, with its note, and still
 *                   matching the check that was made when it was recorded; nothing decided on an
 *                   undecided proposal.
 *   3. HISTORY    — the history is numbered without gaps, starts with "review created", has one
 *                   "proposal created" per proposal, and each recorded change starts from the
 *                   state the previous entry left. The last recorded state of every proposal must
 *                   be its current decision.
 *
 * IMPORTANT — what these checks are NOT: they find accidental damage and inconsistent or
 * hand-edited records. They cannot prove who made a decision or that nobody edited a record
 * carefully and consistently: there is no secret key or signature in a browser-only app.
 * The history is append-only through this application, but it is not tamper-proof and is not a
 * secure audit trail. Reviewer names are typed in by the user and are not verified identities.
 *
 * Checks that need the original file (re-verifying evidence against its cells, and whether a
 * correction still fits them) are made by restoreReview when the review is reopened.
 */
import { stableKey } from '../evidence/findings.ts';
import { DECISION_KINDS } from '../../providers/types.ts';
import { HISTORY_ACTIONS, REVIEW_FORMAT_VERSION, REVIEW_KIND, type SavedReview, snapshot } from './reviewRecord.ts';
import type { Proposal } from '../evidence/proposals.ts';

type Obj = Record<string, unknown>;
const isString = (v: unknown): v is string => typeof v === 'string';
const isObject = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isDate = (v: unknown) => isString(v) && v !== '' && !Number.isNaN(Date.parse(v));
const isName = (v: unknown) => v === null || isString(v);
const STATUSES = ['proposed', 'approved', 'rejected'];
const SEVERITIES = ['info', 'warning', 'blocking'];
const REVIEW_LEVEL = ['review_created', 'review_restored', 'review_imported'];
const AUXILIARY = ['warning_acknowledged', 'alternative_chosen'];
const HEX64 = /^[0-9a-f]{64}$/;

/** 1. Structure. An empty list means the record has every part, of the right type. */
export function structureProblems(value: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(value)) return ['The review is missing or is not a review record.'];
  const r = value;
  if (r['kind'] !== REVIEW_KIND) errors.push('It is not an AI BQ Converter review.');
  if (r['formatVersion'] !== REVIEW_FORMAT_VERSION) errors.push(`It uses review format version ${String(r['formatVersion'])}; this version of the app reads version ${REVIEW_FORMAT_VERSION}.`);
  for (const key of ['reviewId', 'providerId']) if (!isString(r[key]) || r[key] === '') errors.push(`"${key}" is missing.`);
  for (const key of ['createdAt', 'savedAt']) if (!isDate(r[key])) errors.push(`"${key}" is missing or is not a date.`);
  const doc = r['document'];
  if (!isObject(doc) || !isString(doc['fileName']) || !isString(doc['id']) || !isString(doc['sha256']) || !HEX64.test(doc['sha256'])) {
    errors.push('The original document\'s name or fingerprint is missing or invalid.');
  }
  if (!isObject(r['extractionOptions'])) errors.push('The extraction settings are missing.');
  if (!Array.isArray(r['sheets']) || r['sheets'].some((s) => !isObject(s) || !isString(s['name']))) errors.push('The worksheet list is missing or invalid.');
  if (!isName(r['reviewer'])) errors.push('The reviewer name is invalid.');

  const proposals = r['proposals'];
  if (!Array.isArray(proposals)) {
    errors.push('The proposals are missing.');
  } else {
    const ids = new Set<string>();
    proposals.forEach((p, n) => {
      const where = `Proposal ${n + 1}`;
      if (!isObject(p) || !isString(p['id']) || p['id'] === '') return errors.push(`${where} is invalid.`);
      if (ids.has(p['id'])) errors.push(`${where}: the id "${p['id']}" appears twice.`);
      ids.add(p['id']);
      if (!STATUSES.includes(String(p['status']))) errors.push(`${where}: unknown status "${String(p['status'])}".`);
      const i = p['interpretation'];
      if (!isObject(i) || !DECISION_KINDS.includes(i['decisionKind'] as never) || !Array.isArray(i['evidence']) || i['status'] !== 'proposed' || (i['alternatives'] !== undefined && !Array.isArray(i['alternatives']))) {
        errors.push(`${where}: the original proposal is incomplete.`);
      }
      const v = p['verification'];
      if (!isObject(v) || !isString(v['subjectKey']) || !Array.isArray(v['findings']) || typeof v['ok'] !== 'boolean' || v['findings'].some((f) => !isObject(f) || !isString(f['code']) || !SEVERITIES.includes(String(f['severity'])))) {
        errors.push(`${where}: the verification report is missing or invalid.`);
      }
      const d = p['decision'];
      if (d !== undefined && (!isObject(d) || !isDate(d['at']) || !isName(d['by']) || (d['note'] !== undefined && !isString(d['note'])))) errors.push(`${where}: the decision record is invalid.`);
      const c = p['chosen'];
      if (c !== undefined && c !== 'primary' && typeof c !== 'number') errors.push(`${where}: the chosen reading is invalid.`);
      const x = p['correction'];
      if (x !== undefined && (!isObject(x) || !('value' in x) || !isObject(x['verification']) || typeof x['verification']['ok'] !== 'boolean' || !Array.isArray(x['verification']['findings']) || !isString(x['verification']['subjectKey']))) {
        errors.push(`${where}: the correction record is invalid.`);
      }
    });
  }

  const history = r['history'];
  if (!Array.isArray(history) || history.length === 0) {
    errors.push('The decision history is missing.');
  } else {
    history.forEach((e, n) => {
      const where = `History entry ${n + 1}`;
      if (!isObject(e)) return errors.push(`${where} is invalid.`);
      if (e['sequence'] !== n + 1) errors.push(`${where}: it is numbered ${String(e['sequence'])} (entries must be numbered 1, 2, 3… with nothing missing).`);
      if (!isDate(e['at'])) errors.push(`${where}: its time is missing or invalid.`);
      if (!HISTORY_ACTIONS.includes(e['action'] as never)) errors.push(`${where}: unknown action "${String(e['action'])}".`);
      if (!isName(e['by'])) errors.push(`${where}: its name is invalid.`);
      if (!isString(e['summary'])) errors.push(`${where}: its summary is missing.`);
      if (e['proposalId'] !== undefined && !isString(e['proposalId'])) errors.push(`${where}: its proposal reference is invalid.`);
      if (e['note'] !== undefined && !isString(e['note'])) errors.push(`${where}: its note is invalid.`);
      for (const k of ['previous', 'next']) {
        const s = e[k];
        if (s !== undefined && (!isObject(s) || !STATUSES.includes(String(s['status'])))) errors.push(`${where}: its "${k === 'previous' ? 'before' : 'after'}" state is invalid.`);
      }
      if (e['warningCodes'] !== undefined && (!Array.isArray(e['warningCodes']) || e['warningCodes'].some((w) => !isString(w)))) errors.push(`${where}: its warning codes are invalid.`);
      if (e['backupChecksum'] !== undefined && (!isString(e['backupChecksum']) || !HEX64.test(e['backupChecksum']))) errors.push(`${where}: its backup checksum is invalid.`);
    });
  }
  return errors;
}

const warningCodes = (p: Proposal) => p.verification.findings.filter((f) => f.severity === 'warning').map((f) => f.code).sort();
const hasBlocking = (findings: readonly { severity: string }[]) => findings.some((f) => f.severity === 'blocking');
const blank = (s: string | null | undefined) => s === undefined || s === null || s.trim() === '';

/** The check a correction carried when it was recorded was made on exactly this answer. */
function correctionSubjectKey(p: Proposal): string {
  const { alternatives: _a, ...rest } = p.interpretation;
  void _a;
  return stableKey({ ...rest, value: p.correction!.value, reasoning: `Correction: ${p.decision?.note ?? ''}` });
}

/** 2. Decision rules for every proposal (no file needed). */
export function decisionProblems(review: SavedReview): string[] {
  const errors: string[] = [];
  for (const p of review.proposals) {
    const where = `Proposal "${p.id}"`;
    if (p.verification.subjectKey !== stableKey(p.interpretation)) errors.push(`${where}: the proposal does not match its verification report (it was changed).`);
    if (p.verification.ok === hasBlocking(p.verification.findings)) errors.push(`${where}: its verification result does not agree with its findings.`);
    const alternatives = p.interpretation.alternatives?.length ?? 0;

    if (p.status === 'proposed') {
      if (p.decision) errors.push(`${where}: undecided, but carries a decision record.`);
      if (p.chosen !== undefined) errors.push(`${where}: undecided, but carries a chosen reading.`);
      if (p.correction) errors.push(`${where}: undecided, but carries a correction.`);
      continue;
    }
    if (!p.decision) {
      errors.push(`${where}: decided (${p.status}) but the decision record is missing.`);
      continue;
    }
    if (p.decision.by !== null && p.decision.by.trim() === '') errors.push(`${where}: the name on the decision is blank (it must be a name or "not recorded").`);

    if (p.status === 'approved') {
      if (!p.verification.ok || hasBlocking(p.verification.findings)) errors.push(`${where}: approved although it failed verification (blocking findings cannot be approved).`);
      if (warningCodes(p).length > 0 && blank(p.decision.note)) errors.push(`${where}: approved with warnings but no acknowledging note.`);
      if (p.chosen === undefined) {
        errors.push(alternatives > 0 ? `${where}: approved without choosing among its alternatives.` : `${where}: approved without recording which reading was approved.`);
      } else if (p.chosen !== 'primary' && (!Number.isInteger(p.chosen) || p.chosen < 0 || p.chosen >= alternatives)) {
        errors.push(`${where}: the chosen alternative (${String(p.chosen)}) does not exist.`);
      }
      if (p.correction) errors.push(`${where}: an approved proposal cannot also carry a correction.`);
    }
    if (p.status === 'rejected') {
      if (p.chosen !== undefined) errors.push(`${where}: a rejected proposal cannot carry a chosen reading.`);
      if (p.correction) {
        if (blank(p.decision.note)) errors.push(`${where}: a correction needs an explaining note, and there is none.`);
        const v = p.correction.verification;
        if (!v.ok || hasBlocking(v.findings)) errors.push(`${where}: the recorded correction failed its check.`);
        if (v.subjectKey !== correctionSubjectKey(p)) errors.push(`${where}: the recorded correction was changed after it was checked.`);
      }
    }
  }
  return errors;
}

/** 3. History consistency with the proposals and their current decisions. */
export function historyProblems(review: SavedReview): string[] {
  const errors: string[] = [];
  const proposals = new Map(review.proposals.map((p) => [p.id, p]));
  const state = new Map<string, string>(); // proposal id → stableKey of its recorded state
  const pending = new Map<string, { next: string; actions: Set<string> }>(); // acknowledgement / alternative awaiting its approval
  const key = (v: unknown) => stableKey(v);

  review.history.forEach((e, n) => {
    const where = `History entry ${n + 1} (${e.action})`;
    if (n === 0 && e.action !== 'review_created') errors.push('The history does not start with "review created".');
    if (n > 0 && e.action === 'review_created') errors.push(`${where}: "review created" appears again.`);
    if (REVIEW_LEVEL.includes(e.action)) {
      if (e.proposalId !== undefined) errors.push(`${where}: a review-level entry must not refer to a proposal.`);
      return;
    }
    const p = e.proposalId === undefined ? undefined : proposals.get(e.proposalId);
    if (!p) return errors.push(`${where}: it refers to ${e.proposalId === undefined ? 'no proposal' : `proposal "${e.proposalId}", which is not in this review`}.`);
    const where2 = `${where} for proposal "${p.id}"`;

    if (e.action === 'proposal_created') {
      if (state.has(p.id)) errors.push(`${where2}: the proposal is created twice.`);
      if (e.previous !== undefined || e.next?.status !== 'proposed' || e.next.decision || e.next.chosen !== undefined || e.next.correctionValue !== undefined) errors.push(`${where2}: a new proposal must start undecided.`);
      state.set(p.id, key(e.next ?? { status: 'proposed' }));
      return;
    }
    if (!state.has(p.id)) return errors.push(`${where2}: it comes before the proposal was created.`);
    if (!e.previous || !e.next) return errors.push(`${where2}: the "before" or "after" state is missing.`);
    if (key(e.previous) !== state.get(p.id)) errors.push(`${where2}: its "before" state does not match the proposal's state at that point (an entry may have been removed, reordered or changed).`);
    const prev = e.previous;
    const next = e.next;
    const decisionBy = next.decision?.by ?? null;

    if (AUXILIARY.includes(e.action)) {
      if (prev.status !== 'proposed' || next.status !== 'approved') errors.push(`${where2}: it is not part of an approval.`);
      if (e.action === 'warning_acknowledged') {
        if (blank(e.note) || e.note !== next.decision?.note) errors.push(`${where2}: the acknowledgement has no note, or a note different from the approval's.`);
        if ((e.warningCodes ?? []).slice().sort().join(',') !== warningCodes(p).join(',')) errors.push(`${where2}: the acknowledged warnings are not the proposal's warnings.`);
      }
      if (e.action === 'alternative_chosen' && typeof next.chosen !== 'number') errors.push(`${where2}: no alternative is chosen in the approval.`);
      if (e.by !== decisionBy) errors.push(`${where2}: the name differs from the approval's.`);
      const open = pending.get(p.id);
      if (open && open.next !== key(next)) errors.push(`${where2}: it belongs to a different approval than the entry before it.`);
      pending.set(p.id, { next: key(next), actions: new Set([...(open?.actions ?? []), e.action]) });
      return;
    }

    const open = pending.get(p.id);
    pending.delete(p.id);
    if (open && (e.action !== 'approved' || open.next !== key(next))) errors.push(`${where2}: an earlier acknowledgement or chosen alternative is not followed by its approval.`);

    if (e.action === 'approved') {
      if (prev.status !== 'proposed' || next.status !== 'approved') errors.push(`${where2}: it does not change "proposed" to "approved".`);
      if (warningCodes(p).length > 0 && !open?.actions.has('warning_acknowledged')) errors.push(`${where2}: approved with warnings, but the warning acknowledgement is missing from the history.`);
      if (typeof next.chosen === 'number' && !open?.actions.has('alternative_chosen')) errors.push(`${where2}: an alternative was approved, but choosing it is missing from the history.`);
    } else if (e.action === 'rejected') {
      if (prev.status !== 'proposed' || next.status !== 'rejected' || next.correctionValue !== undefined) errors.push(`${where2}: it does not change "proposed" to "rejected" (without a correction).`);
    } else if (e.action === 'correction_recorded') {
      if (prev.status !== 'proposed' || next.status !== 'rejected' || next.correctionValue === undefined) errors.push(`${where2}: it does not record a rejection with a correction.`);
    } else if (e.action === 'decision_reopened') {
      if (prev.status === 'proposed' || next.status !== 'proposed' || next.decision || next.chosen !== undefined || next.correctionValue !== undefined) errors.push(`${where2}: it does not reopen a decided proposal.`);
    }
    if (e.action !== 'decision_reopened') {
      if (e.by !== decisionBy) errors.push(`${where2}: the name differs from the decision's.`);
      if ((e.note ?? null) !== (next.decision?.note ?? null)) errors.push(`${where2}: the note differs from the decision's.`);
    }
    state.set(p.id, key(next));
  });

  for (const p of review.proposals) {
    const where = `Proposal "${p.id}"`;
    if (pending.has(p.id)) errors.push(`${where}: the history ends with an acknowledgement or chosen alternative that has no approval.`);
    if (!state.has(p.id)) errors.push(`${where}: there is no "proposal created" entry in the history.`);
    else if (state.get(p.id) !== key(snapshot(p))) errors.push(`${where}: its current decision (${p.status}) does not match the last decision recorded in the history.`);
  }
  return errors;
}

/**
 * Every check that can be made without the original file. An empty list means the record is a
 * complete, consistent review. Nothing is changed or repaired.
 */
export function validateReviewRecord(value: unknown): string[] {
  const structure = structureProblems(value);
  const r = value as Obj | null;
  // The decision and history rules need well-formed proposals (and history); otherwise report the structure only.
  const proposalsUsable = isObject(r) && Array.isArray(r['proposals']) && !structure.some((s) => /^Proposal \d+/.test(s));
  if (!proposalsUsable) return structure;
  const rules = decisionProblems(value as SavedReview);
  const historyUsable = Array.isArray(r['history']) && r['history'].length > 0 && !structure.some((s) => /^History entry/.test(s));
  return [...structure, ...rules, ...(historyUsable ? historyProblems(value as SavedReview) : [])];
}
