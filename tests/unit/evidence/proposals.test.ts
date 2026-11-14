/**
 * Stage 2E — answers stay proposals until a person approves them.
 * SYNTHETIC — NOT REAL COST DATA.
 */
import { describe, expect, it } from 'vitest';
import {
  ProposalError,
  approveProposal,
  approvedDecisions,
  createProposal,
  rejectProposal,
  verifyInterpretation,
} from '../../../src/core/evidence/index.ts';
import type { Interpretation } from '../../../src/providers/types.ts';
import { misbehavingAnswers } from '../../helpers/providers.ts';
import { BQ_XLSX, NOW, REVIEWER, syntheticProject } from '../../helpers/synthetic/models.ts';
import { ALL_TABLES } from '../../helpers/synthetic/tables.ts';

const T = 't-bill-1';
const ctx = { project: syntheticProject(), tables: ALL_TABLES, documentId: BQ_XLSX.id };

const clean: Interpretation<'rowClass'> = {
  decisionKind: 'rowClass', value: { tableId: T, rowIndex: 2, rowClass: 'priced_item' }, confidence: 0.9,
  evidence: [{ tableId: T, rowIndex: 2 }], reasoning: 'synthetic', method: 'ai', providerId: 'imaginary-ai@1', status: 'proposed',
};
const lowConfidence: Interpretation<'rowClass'> = { ...clean, confidence: 0.3 };

const proposalFor = (id: string, i: Interpretation<'rowClass'>) => createProposal(id, i, verifyInterpretation(i, ctx));

describe('a verified answer is still only a proposal', () => {
  it('passing the verifier does not approve it', () => {
    const p = proposalFor('p1', clean);
    expect(p.verification.ok).toBe(true);
    expect(p.status).toBe('proposed');
    expect(approvedDecisions([p])).toEqual([]);
  });

  it('a person approves it, and only then is it usable', () => {
    const approved = approveProposal(proposalFor('p1', clean), { by: REVIEWER, at: NOW });
    expect(approved.status).toBe('approved');
    expect(approved.decision?.by).toBe(REVIEWER);
    expect(approvedDecisions([approved])).toEqual([{ tableId: T, rowIndex: 2, rowClass: 'priced_item' }]);
  });

  it('a person rejects it, and it is never used', () => {
    const rejected = rejectProposal(proposalFor('p1', clean), { by: REVIEWER, at: NOW, note: 'It is a heading.' });
    expect(rejected.status).toBe('rejected');
    expect(approvedDecisions([rejected])).toEqual([]);
  });

  it('a decision cannot be made twice', () => {
    const approved = approveProposal(proposalFor('p1', clean), { by: REVIEWER, at: NOW });
    expect(() => approveProposal(approved, { by: REVIEWER, at: NOW })).toThrow(ProposalError);
    expect(() => rejectProposal(approved, { by: REVIEWER, at: NOW })).toThrow(ProposalError);
  });

  it('approval must name the person', () => {
    expect(() => approveProposal(proposalFor('p1', clean), { by: ' ', at: NOW })).toThrow(ProposalError);
  });
});

describe('questionable answers are not approved silently', () => {
  it('an answer with warnings needs a note acknowledging them', () => {
    const p = proposalFor('p2', lowConfidence);
    expect(() => approveProposal(p, { by: REVIEWER, at: NOW })).toThrow(/needs a note/);
    expect(approveProposal(p, { by: REVIEWER, at: NOW, note: 'Checked against the drawing.' }).status).toBe('approved');
  });

  it('an answer with a blocking finding can never be approved, even with a note', () => {
    const invented = misbehavingAnswers(T)['inventsQuantity'] as Interpretation<'rowClass'>;
    const p = createProposal('p3', invented, verifyInterpretation(invented, ctx));
    expect(() => approveProposal(p, { by: REVIEWER, at: NOW, note: 'Looks fine to me.' })).toThrow(/UNEXPECTED_FIELD/);
  });

  it('an answer that claims to be approved cannot even become a proposal', () => {
    const claims = misbehavingAnswers(T)['claimsApproval'] as unknown as Interpretation<'rowClass'>;
    expect(() => createProposal('p4', claims, verifyInterpretation(claims, ctx))).toThrow(ProposalError);
  });
});

describe('a report only covers the exact answer it verified', () => {
  it('a clean report cannot be attached to a different answer', () => {
    const report = verifyInterpretation(clean, ctx);
    const swapped: Interpretation<'rowClass'> = { ...clean, value: { tableId: T, rowIndex: 3, rowClass: 'priced_item' } };
    expect(() => createProposal('p5', swapped, report)).toThrow(/different/);
  });

  it('proposals are frozen', () => {
    const p = proposalFor('p6', clean);
    expect(() => {
      (p as { status: string }).status = 'approved';
    }).toThrow(TypeError);
  });
});
