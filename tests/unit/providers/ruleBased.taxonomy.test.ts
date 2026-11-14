/**
 * Stage 2G — the Cost Library taxonomy is a reference list only, and the provider's keyword
 * table only points at labels that really exist in it.
 */
import { describe, expect, it } from 'vitest';
import * as taxonomy from '../../../src/vendor/cost-library/taxonomy.ts';
import { TRADE_SUBTRADES, UNIFIED_TRADE_PACKAGES } from '../../../src/vendor/cost-library/taxonomy.ts';
import { TRADE_KEYWORDS } from '../../../src/providers/rule-based/vocabulary.ts';

describe('taxonomy entry point', () => {
  it('exposes exactly the two reference lists — no Cost Library functions', () => {
    expect(Object.keys(taxonomy).sort()).toEqual(['TRADE_SUBTRADES', 'UNIFIED_TRADE_PACKAGES']);
    expect(UNIFIED_TRADE_PACKAGES).toHaveLength(19);
  });
});

describe('trade keyword table', () => {
  it.each(TRADE_KEYWORDS.map((k) => [k.keyword, k]))('"%s" points at a real trade (and sub-trade)', (_name, k) => {
    expect(UNIFIED_TRADE_PACKAGES.map((t) => t.id)).toContain(k.trade);
    if (k.subTrade) expect(TRADE_SUBTRADES[k.trade]).toContain(k.subTrade);
  });
});
