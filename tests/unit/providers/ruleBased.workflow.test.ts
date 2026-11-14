/**
 * Stage 2G — proposed / verified / approved / rejected. Nothing is approved automatically.
 * SYNTHETIC — NOT REAL COST DATA.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ProposalError,
  approveProposal,
  approvedDecisions,
  bulkApprove,
  createProposal,
  createVerifiedProposals,
  rejectProposal,
  reviewState,
  verifyInterpretation,
} from '../../../src/core/evidence/index.ts';
import { RULE_BASED_INFO } from '../../../src/providers/rule-based/index.ts';
import { runAll, tableNamed } from '../../helpers/runProvider.ts';
import * as L from '../../helpers/synthetic/bqLayouts.ts';
import { NOW, REVIEWER } from '../../helpers/synthetic/models.ts';

let loaded: L.Loaded;
let run: Awaited<ReturnType<typeof runAll>>;
let ctx: Parameters<typeof verifyInterpretation>[1];
beforeAll(async () => {
  loaded = await L.load(L.conventionalBq(), 'SYNTHETIC_BQ.xlsx');
  run = await runAll(loaded);
  ctx = { project: loaded.project, tables: loaded.ctx.tables, documentId: loaded.ctx.document.id, provider: RULE_BASED_INFO };
});

describe('nothing is approved automatically', () => {
  it('every answer becomes a "verified" proposal awaiting review — none approved', () => {
    const proposals = createVerifiedProposals('p', run.all, ctx);
    expect(proposals.length).toBe(run.all.length);
    expect(new Set(proposals.map(reviewState))).toEqual(new Set(['verified']));
    expect(new Set(proposals.map((p) => p.status))).toEqual(new Set(['proposed']));
    expect(approvedDecisions(proposals)).toEqual([]);
  });

  it('high confidence does not approve anything', () => {
    const confident = createVerifiedProposals('c', run.columns.filter((c) => c.confidence >= 0.9), ctx);
    expect(confident.length).toBeGreaterThan(0);
    expect(confident.every((p) => p.status === 'proposed')).toBe(true);
  });
});

describe('a person approves or rejects, and the decision is recorded', () => {
  it('approve: who, when, note and which reading', () => {
    const [p] = createVerifiedProposals('a', [run.columns.find((c) => c.value.role === 'description')!], ctx);
    const approved = approveProposal(p!, { by: REVIEWER, at: NOW, note: 'Checked.' });
    expect(reviewState(approved)).toBe('approved');
    expect(approved).toMatchObject({ decision: { by: REVIEWER, at: NOW, note: 'Checked.' }, chosen: 'primary' });
    expect(approvedDecisions([approved])).toEqual([approved.interpretation.value]);
  });

  it('reject: who, when and why', () => {
    const [p] = createVerifiedProposals('r', [run.documentType[0]!], ctx);
    const rejected = rejectProposal(p!, { by: REVIEWER, at: NOW, note: 'It is a tender BQ copy.' });
    expect(reviewState(rejected)).toBe('rejected');
    expect(approvedDecisions([rejected])).toEqual([]);
  });

  it('an answer with alternatives needs an explicit choice; the chosen reading is what counts', () => {
    const ambiguous = run.rows.find((r) => r.value.tableId === tableNamed(loaded, 'Bill 2').id && r.value.rowIndex === L.R(5))!;
    const [p] = createVerifiedProposals('x', [ambiguous], ctx);
    const note = { by: REVIEWER, at: NOW, note: 'Third-level heading in the drawing schedule.' };
    expect(() => approveProposal(p!, note)).toThrow(/choose/);
    const chosen = approveProposal(p!, note, 0);
    expect(chosen.chosen).toBe(0);
    expect(approvedDecisions([chosen])).toEqual([{ tableId: ambiguous.value.tableId, rowIndex: L.R(5), rowClass: 'secondary_subheading' }]);
    expect(() => approveProposal(p!, note, 7)).toThrow(ProposalError);
  });

  it('an answer that fails verification shows "failed_verification" and can never be approved', () => {
    const bad = structuredClone(run.columns[0]!) as unknown as Record<string, unknown> & { quotedText: string[] };
    bad.quotedText[0] = 'Something else';
    const p = createProposal('bad', bad as never, verifyInterpretation(bad as never, ctx));
    expect(reviewState(p)).toBe('failed_verification');
    expect(() => approveProposal(p, { by: REVIEWER, at: NOW, note: 'ok' })).toThrow(/QUOTE_MISMATCH/);
  });
});

describe('bulk approval is limited to straightforward proposals', () => {
  it('approves clear column and row proposals; skips ambiguous, low-confidence and other kinds with a reason', () => {
    const proposals = createVerifiedProposals('b', run.all, ctx);
    const { approved, skipped } = bulkApprove(proposals, { by: REVIEWER, at: NOW });
    expect(approved.length).toBeGreaterThan(0);
    for (const p of approved) {
      expect(['tableRegion', 'columnRole', 'rowClass']).toContain(p.interpretation.decisionKind);
      expect(p.interpretation.alternatives ?? []).toEqual([]);
      expect(p.verification.findings.filter((f) => f.severity === 'warning')).toEqual([]);
      expect(p.decision?.by).toBe(REVIEWER);
    }
    const reasons = new Set(skipped.map((s) => s.reason));
    expect(reasons).toContain('has alternative readings');
    expect(reasons).toContain('has warnings');
    expect(reasons).toContain('"documentType" decisions are reviewed individually');
    expect(reasons).toContain('"classificationSuggestion" decisions are reviewed individually');
    expect(approved.length + skipped.length).toBe(proposals.length);
  });

  it('bulk approval must name the person', () => {
    expect(() => bulkApprove(createVerifiedProposals('n', run.columns, ctx), { by: '', at: NOW })).toThrow(ProposalError);
  });
});
