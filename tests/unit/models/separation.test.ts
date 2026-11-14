/**
 * Stage 2C — claim data can never change original BQ data.
 * SYNTHETIC — NOT REAL COST DATA.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FullBQItem } from '../../../src/vendor/cost-library/index.ts';
import {
  type ClaimDocumentRecord,
  type ProgressClaimRecord,
  checkStagedRowIntegrity,
  confirmBqLink,
  createPdfReference,
  createProgressClaimRecord,
  notStatedEvidence,
  numberEvidence,
  suggestBqLink,
  textEvidence,
  withContractFigureIssues,
} from '../../../src/core/models/index.ts';
import { CLAIM_PDF, NOW, REVIEWER, syntheticPricedRow } from '../../helpers/synthetic/models.ts';

const at = { sources: [createPdfReference(CLAIM_PDF, { pageNumber: 1, lineNumber: 9, extraction: 'ocr', ocrConfidence: 95 })], method: 'pdf_ocr' as const };
const n = (v: number) => numberEvidence(String(v), v, at);
const NONE = { previous: notStatedEvidence<number>(), current: notStatedEvidence<number>(), cumulative: notStatedEvidence<number>() };

function syntheticClaimLine(): ProgressClaimRecord {
  return createProgressClaimRecord({
    id: 'claim-line-sep',
    projectId: 'proj-synthetic',
    claimDocumentId: 'claim-doc',
    sourceDocumentId: CLAIM_PDF.id,
    sequence: 1,
    asWritten: { itemNo: textEvidence('A', 'A', at), description: textEvidence('SYNTHETIC CLAIM TEXT', 'SYNTHETIC CLAIM TEXT', at), unit: textEvidence('m2', 'm2', at) },
    contractFiguresInClaim: { quantity: n(99), rate: n(99), amount: n(9801) },
    claimedQuantity: { previous: n(1), current: n(2), cumulative: n(3) },
    claimedAmount: { previous: n(2), current: n(4), cumulative: n(6) },
    percentComplete: NONE,
    certifiedQuantity: NONE,
    certifiedAmount: NONE,
    sources: at.sources,
  });
}

/** Every object and array inside a value. */
function allObjects(value: unknown, seen = new Set<object>()): Set<object> {
  if (value !== null && typeof value === 'object' && !seen.has(value)) {
    seen.add(value);
    for (const v of Object.values(value)) allObjects(v, seen);
  }
  return seen;
}

describe('claim records are a separate data structure', () => {
  it('a claim line shares no fields with FullBQItem except its own id and project id', () => {
    expectTypeOf<Extract<keyof ProgressClaimRecord, keyof FullBQItem>>().toEqualTypeOf<'id' | 'projectId'>();
    expectTypeOf<Extract<keyof ClaimDocumentRecord, keyof FullBQItem>>().toEqualTypeOf<'id' | 'projectId'>();
    const line = syntheticClaimLine();
    for (const pricingField of ['quantity', 'rate', 'amount', 'originalRate', 'originalAmount', 'actualCost', 'baseRate', 'tenderRate']) {
      expect(Object.keys(line)).not.toContain(pricingField);
    }
  });

  it('the claim model file does not import FullBQItem or the BQ row model', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../../../src/core/models/progressClaim.ts'), 'utf8');
    const imports = source.split('\n').filter((l) => l.startsWith('import'));
    expect(imports.join('\n')).not.toMatch(/vendor\/cost-library|stagedBQRow/);
  });
});

describe('modifying a claim cannot change the original BQ item', () => {
  it('linking, confirming, comparing and editing claims leave the BQ row exactly as it was', () => {
    const bqRow = syntheticPricedRow(10, { quantity: 10, rate: 2, amount: 20 });
    const snapshot = JSON.stringify(bqRow);

    // 1. Link, confirm and compare — the BQ row is only read.
    let claim = suggestBqLink(syntheticClaimLine(), bqRow, 'item_no_and_description', ['item no "A"']);
    claim = confirmBqLink(claim, REVIEWER, NOW);
    claim = withContractFigureIssues(claim, bqRow);
    expect(claim.issues.filter((i) => i.code === 'CLAIM_CONTRACT_FIGURE_DIFFERS')).toHaveLength(3);

    // 2. The claim shares no object with the BQ row, so changing one cannot reach the other.
    const bqObjects = allObjects(bqRow);
    expect([...allObjects(claim)].filter((o) => bqObjects.has(o))).toEqual([]);

    // 3. The claim record itself cannot be changed in place…
    expect(() => {
      (claim.claimedAmount.current as { parsed: number }).parsed = 1000;
    }).toThrow(TypeError);
    expect(() => {
      (claim.contractFiguresInClaim.quantity as { parsed: number }).parsed = 1000;
    }).toThrow(TypeError);

    // 4. …and an editable copy of the claim can be changed freely without any effect on the BQ.
    const editable = structuredClone(claim) as unknown as {
      claimedAmount: { current: { parsed: number } };
      contractFiguresInClaim: { rate: { parsed: number } };
      bqLink: { bqRowId: string };
    };
    editable.claimedAmount.current.parsed = 123456;
    editable.contractFiguresInClaim.rate.parsed = 777;
    editable.bqLink.bqRowId = 'something-else';

    // 5. Nothing in the BQ row changed.
    expect(JSON.stringify(bqRow)).toBe(snapshot);
    expect(bqRow.item).toMatchObject({ quantity: 10, rate: 2, amount: 20, originalRate: 2, originalAmount: 20 });
    expect(bqRow.item.actualCost).toBeUndefined();
    expect(checkStagedRowIntegrity(bqRow)).toEqual([]);
  });

  it('the BQ row cannot be changed through anything a claim holds', () => {
    const bqRow = syntheticPricedRow();
    const claim = suggestBqLink(syntheticClaimLine(), bqRow, 'user', []);
    // The only thing the claim knows about the BQ row is its id (a piece of text).
    expect(typeof claim.bqLink.bqRowId).toBe('string');
    // Even with direct access, the BQ row is frozen.
    expect(() => {
      (bqRow.item as { rate: number }).rate = 0;
    }).toThrow(TypeError);
    expect(bqRow.item.rate).toBe(2);
  });
});
