/**
 * Stage 2B — the Cost Library target schema as the converter sees it.
 *
 * HOW THESE TESTS WORK
 * `expectTypeOf(...)` checks are checked by the TypeScript compiler, i.e. by `npm run lint`
 * (and `npm run build`). If the Cost Library copy ever changed a field's type, lint would fail.
 * The `expect(...)` checks run in `npm test` as usual.
 *
 * Any example data here is SYNTHETIC — NOT REAL COST DATA.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  BillQuantityLayout,
  BillQuantityPair,
  BQCostScopeType,
  BQImportRowClassification,
  BQRowType,
  ColumnMappingConfig,
  FullBQItem,
  ItemQuantityColumn,
  OptionPrice,
  PricingOptionsSetting,
  ProjectSettings,
  QuantityColumnMapping,
} from '../../../src/vendor/cost-library/index.ts';

/** The names of the fields that MUST be present (not optional) on a type. */
type RequiredKeys<T> = { [K in keyof T]-?: {} extends Pick<T, K> ? never : K }[keyof T];

// ---------------------------------------------------------------------------------------------
// Lists kept in step with the Cost Library unions. The compiler checks they are exactly complete.
// ---------------------------------------------------------------------------------------------
const FULL_BQ_REQUIRED_FIELDS = [
  'id', 'projectName', 'projectYear', 'description', 'unit',
  'quantity', 'rate', 'amount', 'dateCreated', 'dateUpdated',
] as const;

const BQ_ROW_TYPES = [
  'bill_heading', 'section_heading', 'subheading', 'cost_item', 'note', 'subtotal', 'total',
  'source_summary', 'reference', 'blank', 'element_definition', 'secondary_subheading',
  'project_settings', 'other',
] as const;

const BQ_COST_SCOPE_TYPES = [
  'measured', 'preliminaries', 'provisional_sum', 'prime_cost', 'lump_sum',
  'subtotal', 'total', 'contingency', 'tax', 'other',
] as const;

const BQ_IMPORT_ROW_CLASSIFICATIONS = [
  'main_heading', 'subheading', 'secondary_subheading', 'priced_item',
  'note', 'note_label', 'subtotal', 'ignore',
] as const;

const OPTION_PRICE_FIELDS = [
  'rate', 'amount', 'baseRate', 'baseAmount', 'profitPercent', 'rateAfterDiscount',
  'originalRate', 'originalAmount', 'tenderRate', 'tenderAmount', 'breakdownAmounts',
] as const;

describe('FullBQItem — required fields', () => {
  it('has exactly 10 required fields', () => {
    expectTypeOf<RequiredKeys<FullBQItem>>().toEqualTypeOf<(typeof FULL_BQ_REQUIRED_FIELDS)[number]>();
    expect(FULL_BQ_REQUIRED_FIELDS).toHaveLength(10);
  });

  it('requires text for identity and description, and numbers for quantity, rate and amount', () => {
    expectTypeOf<FullBQItem['id']>().toEqualTypeOf<string>();
    expectTypeOf<FullBQItem['projectName']>().toEqualTypeOf<string>();
    expectTypeOf<FullBQItem['projectYear']>().toEqualTypeOf<string>();
    expectTypeOf<FullBQItem['description']>().toEqualTypeOf<string>();
    expectTypeOf<FullBQItem['unit']>().toEqualTypeOf<string>();
    expectTypeOf<FullBQItem['quantity']>().toEqualTypeOf<number>();
    expectTypeOf<FullBQItem['rate']>().toEqualTypeOf<number>();
    expectTypeOf<FullBQItem['amount']>().toEqualTypeOf<number>();
    // Note for the converter: quantity / rate / amount cannot be left "empty" in FullBQItem itself.
    // "Not stated in the source" is therefore recorded in the converter's evidence (Stage 2C).
  });
});

describe('FullBQItem — original values (preserved, never overwritten)', () => {
  it('has optional originalRate and originalAmount numbers', () => {
    expectTypeOf<FullBQItem['originalRate']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<FullBQItem['originalAmount']>().toEqualTypeOf<number | undefined>();
  });

  it('has optional base / tender / profit / discount figures', () => {
    expectTypeOf<FullBQItem['baseRate']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<FullBQItem['baseAmount']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<FullBQItem['tenderRate']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<FullBQItem['tenderAmount']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<FullBQItem['profitPercent']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<FullBQItem['rateAfterDiscount']>().toEqualTypeOf<number | undefined>();
  });

  it('has the special pricing fields: rateOnly, percentageOf, quantityBreakdowns, optionPrices', () => {
    expectTypeOf<FullBQItem['rateOnly']>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<FullBQItem['percentageOf']>().toEqualTypeOf<
      { percent: number; basisIds: string[]; roundToWhole?: boolean } | undefined
    >();
    expectTypeOf<FullBQItem['quantityBreakdowns']>().toEqualTypeOf<ItemQuantityColumn[] | undefined>();
    expectTypeOf<FullBQItem['optionPrices']>().toEqualTypeOf<Record<string, OptionPrice> | undefined>();
  });

  it('has actualCost — which the converter must never fill from a BQ or a claim', () => {
    expectTypeOf<FullBQItem['actualCost']>().toEqualTypeOf<number | undefined>();
  });
});

describe('FullBQItem — hierarchy (Project → Bill → Section / Level 2 → Headings → Item)', () => {
  it('has optional text fields for bill, section, element, headings and item numbers', () => {
    expectTypeOf<FullBQItem['billNo']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<FullBQItem['billDescription']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<FullBQItem['sectionNo']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<FullBQItem['sectionDescription']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<FullBQItem['element']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<FullBQItem['elementCode']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<FullBQItem['mainHeading']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<FullBQItem['subheading']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<FullBQItem['secondarySubheading']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<FullBQItem['parentSpecDescription']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<FullBQItem['itemNo']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<FullBQItem['originalItemNo']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<FullBQItem['hierarchyLevel']>().toEqualTypeOf<1 | 2 | 3 | undefined>();
  });

  it('has optional classification fields (Trade, Cost Item) as free text', () => {
    // TradeCategory | string collapses to string: any text is accepted by the type.
    expectTypeOf<FullBQItem['tradeWork']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<FullBQItem['costItem']>().toEqualTypeOf<string | undefined>();
  });
});

describe('FullBQItem — row type and cost scope', () => {
  it('BQRowType has exactly these 14 values', () => {
    expectTypeOf<(typeof BQ_ROW_TYPES)[number]>().toEqualTypeOf<BQRowType>();
    expect(BQ_ROW_TYPES).toHaveLength(14);
  });

  it('rowType accepts a BQRowType or any text (BQRowType | string)', () => {
    // Important: the type does not stop an unknown row type, so the converter must check it itself.
    expectTypeOf<FullBQItem['rowType']>().toEqualTypeOf<string | undefined>();
  });

  it('BQCostScopeType has exactly these 10 values and is used by costScopeType', () => {
    expectTypeOf<(typeof BQ_COST_SCOPE_TYPES)[number]>().toEqualTypeOf<BQCostScopeType>();
    expectTypeOf<FullBQItem['costScopeType']>().toEqualTypeOf<BQCostScopeType | undefined>();
    expect(BQ_COST_SCOPE_TYPES).toHaveLength(10);
  });

  it('has the row flags isHeaderRow, isSubtotalOrTotal, isNonPricedReference', () => {
    expectTypeOf<FullBQItem['isHeaderRow']>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<FullBQItem['isSubtotalOrTotal']>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<FullBQItem['isNonPricedReference']>().toEqualTypeOf<boolean | undefined>();
  });

  it('BQImportRowClassification has exactly these 8 values', () => {
    expectTypeOf<(typeof BQ_IMPORT_ROW_CLASSIFICATIONS)[number]>().toEqualTypeOf<BQImportRowClassification>();
    expect(BQ_IMPORT_ROW_CLASSIFICATIONS).toHaveLength(8);
  });
});

describe('FullBQItem — provenance fields', () => {
  it('has sourceFile, sourceReference, sourceRowNumber, sourceSequence and notes', () => {
    expectTypeOf<FullBQItem['sourceFile']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<FullBQItem['sourceReference']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<FullBQItem['sourceRowNumber']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<FullBQItem['sourceSequence']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<FullBQItem['notes']>().toEqualTypeOf<string | undefined>();
  });
});

describe('multiple quantity columns', () => {
  it('ItemQuantityColumn is { id, name, quantity, amount?, baseAmount? }', () => {
    expectTypeOf<ItemQuantityColumn>().toEqualTypeOf<{
      id: string;
      name: string;
      quantity: number;
      amount?: number;
      baseAmount?: number;
    }>();
  });

  it('BillQuantityLayout and BillQuantityPair have the expected shape', () => {
    expectTypeOf<BillQuantityPair>().toEqualTypeOf<{ id: string; qtyLabel: string; amountLabel: string }>();
    expectTypeOf<BillQuantityLayout>().toEqualTypeOf<{
      additional: boolean;
      primaryQuantity: 'shown' | 'hidden';
      pairs: BillQuantityPair[];
    }>();
  });

  it('QuantityColumnMapping is { id, name, amountName?, qtyCol, amtCol? }', () => {
    expectTypeOf<QuantityColumnMapping>().toEqualTypeOf<{
      id: string;
      name: string;
      amountName?: string;
      qtyCol: number;
      amtCol?: number;
    }>();
  });
});

describe('pricing options and project settings', () => {
  it('OptionPrice has exactly these 11 optional fields', () => {
    expectTypeOf<keyof OptionPrice>().toEqualTypeOf<(typeof OPTION_PRICE_FIELDS)[number]>();
    expectTypeOf<RequiredKeys<OptionPrice>>().toEqualTypeOf<never>();
    expect(OPTION_PRICE_FIELDS).toHaveLength(11);
  });

  it('ProjectSettings holds pricing options and per-bill quantity layouts', () => {
    expectTypeOf<ProjectSettings['pricingOptions']>().toEqualTypeOf<PricingOptionsSetting | undefined>();
    expectTypeOf<ProjectSettings['quantityLayouts']>().toEqualTypeOf<Record<string, BillQuantityLayout> | undefined>();
    expectTypeOf<PricingOptionsSetting>().toEqualTypeOf<{ options: { id: string; name: string }[]; shown: string }>();
  });
});

describe('ColumnMappingConfig (shared column vocabulary)', () => {
  it('requires exactly these 9 column positions', () => {
    expectTypeOf<RequiredKeys<ColumnMappingConfig>>().toEqualTypeOf<
      'itemNoCol' | 'descCol' | 'unitCol' | 'qtyCol' | 'rateCol' | 'amtCol' | 'tradeCol' | 'sectionCol' | 'billCol'
    >();
  });

  it('has optional columns for base/tender rates, profit, discount, element and extra quantities', () => {
    expectTypeOf<ColumnMappingConfig['baseRateCol']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<ColumnMappingConfig['tenderRateCol']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<ColumnMappingConfig['profitCol']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<ColumnMappingConfig['rateAfterDiscountCol']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<ColumnMappingConfig['elementCol']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<ColumnMappingConfig['additionalQtyCols']>().toEqualTypeOf<QuantityColumnMapping[] | undefined>();
  });
});

describe('SYNTHETIC example rows compile as FullBQItem', () => {
  it('accepts a minimal priced item with only the required fields plus provenance', () => {
    const item = {
      id: 'synthetic-1',
      projectName: 'SYNTHETIC PROJECT — NOT REAL COST DATA',
      projectYear: '2000 Q1',
      description: 'SYNTHETIC TEST ITEM 001',
      unit: 'nr',
      quantity: 10,
      rate: 1,
      amount: 10,
      originalRate: 1,
      originalAmount: 10,
      rowType: 'cost_item',
      costScopeType: 'measured',
      sourceFile: 'synthetic.xlsx',
      sourceReference: 'Sheet: Synthetic | Row 3',
      sourceRowNumber: 3,
      dateCreated: '2000-01-01',
      dateUpdated: '2000-01-01',
    } satisfies FullBQItem;
    expect(item.originalAmount).toBe(10);
  });

  it('accepts an item with two quantity columns sharing one rate', () => {
    const item = {
      id: 'synthetic-2',
      projectName: 'SYNTHETIC PROJECT — NOT REAL COST DATA',
      projectYear: '2000 Q1',
      description: 'SYNTHETIC TEST ITEM 002',
      unit: 'm',
      quantity: 3,
      rate: 2,
      amount: 6,
      quantityBreakdowns: [
        { id: 'qb-primary', name: 'Quantity', quantity: 1, amount: 2 },
        { id: 'qcol-2-qty', name: '2 Qty', quantity: 2, amount: 4 },
      ],
      dateCreated: '2000-01-01',
      dateUpdated: '2000-01-01',
    } satisfies FullBQItem;
    expect(item.quantityBreakdowns).toHaveLength(2);
  });
});
