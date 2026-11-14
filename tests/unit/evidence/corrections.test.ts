/**
 * Stage 2H — identity "not recorded" and corrections recorded separately.
 * SYNTHETIC — NOT REAL COST DATA.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ProposalError, approveProposal, correctProposal, createVerifiedProposals, decidedValues, rejectProposal, reviewState } from '../../../src/core/evidence/index.ts';
import { RULE_BASED_INFO } from '../../../src/providers/rule-based/index.ts';
import { runAll, tableNamed } from '../../helpers/runProvider.ts';
import * as L from '../../helpers/synthetic/bqLayouts.ts';
import { NOW } from '../../helpers/synthetic/models.ts';

let loaded: L.Loaded;
let run: Awaited<ReturnType<typeof runAll>>;
let ctx: { project: L.Loaded['project']; tables: L.Loaded['ctx']['tables']; documentId: string; provider: typeof RULE_BASED_INFO };
beforeAll(async () => {
  loaded = await L.load(L.conventionalBq(), 'SYNTHETIC_BQ.xlsx');
  run = await runAll(loaded);
  ctx = { project: loaded.project, tables: loaded.ctx.tables, documentId: loaded.ctx.document.id, provider: RULE_BASED_INFO };
});
const rowProposal = (excelRow: number) => {
  const answer = run.rows.find((r) => r.value.tableId === tableNamed(loaded, 'Bill 2').id && r.value.rowIndex === L.R(excelRow))!;
  return createVerifiedProposals(`r${excelRow}`, [answer], ctx)[0]!;
};

describe('who decided', () => {
  it('a missing name is recorded as null ("not recorded"), never invented', () => {
    const approved = approveProposal(rowProposal(22), { by: null, at: NOW });
    expect(approved.decision?.by).toBeNull();
  });

  it('a name that is given must not be blank', () => {
    expect(() => rejectProposal(rowProposal(22), { by: '   ', at: NOW })).toThrow(ProposalError);
  });
});

describe('corrections', () => {
  it('are stored as a rejection with the person\'s own value, verified against the same cells', () => {
    const corrected = correctProposal(rowProposal(25), { by: null, at: NOW, note: 'A heading in the original.' }, { tableId: tableNamed(loaded, 'Bill 2').id, rowIndex: L.R(25), rowClass: 'main_heading' }, ctx);
    expect(reviewState(corrected)).toBe('rejected');
    expect(corrected.correction?.value).toMatchObject({ rowClass: 'main_heading' });
    expect(corrected.correction?.verification.ok).toBe(true);
    expect(corrected.interpretation.value).toMatchObject({ rowClass: 'description_only_item' }); // the proposal itself is unchanged
    expect(decidedValues([corrected])).toEqual([{ proposalId: corrected.id, value: corrected.correction!.value, source: 'correction' }]);
  });

  it('need a note', () => {
    expect(() => correctProposal(rowProposal(25), { by: null, at: NOW }, { tableId: tableNamed(loaded, 'Bill 2').id, rowIndex: L.R(25), rowClass: 'main_heading' }, ctx)).toThrow(/note/);
  });

  it('are refused when they do not fit the cited cells (e.g. a different row) or are not valid', () => {
    const p = rowProposal(25);
    expect(() => correctProposal(p, { by: null, at: NOW, note: 'x' }, { tableId: tableNamed(loaded, 'Bill 2').id, rowIndex: L.R(6), rowClass: 'main_heading' }, ctx)).toThrow(/EVIDENCE_DOES_NOT_COVER_DECISION/);
    expect(() => correctProposal(p, { by: null, at: NOW, note: 'x' }, { tableId: tableNamed(loaded, 'Bill 2').id, rowIndex: L.R(25), rowClass: 'invented' as never }, ctx)).toThrow(/INVALID_DECISION/);
  });
});
