/**
 * The converter's ONLY entry point to the Cost Library definitions.
 *
 * It re-exports TYPES ONLY from the exact, read-only copy in ./types/costLibrary.ts.
 * No Cost Library functions are exported from here. In particular `parseCleanRate`
 * (which removes minus signs with Math.abs — see docs/DECISIONS.md D-004) must never be
 * used by the converter. A test checks that this module exports no runtime values.
 *
 * Converter code imports from here, e.g.:
 *   import type { FullBQItem } from '../vendor/cost-library/index.ts';
 */
export type {
  // Target schema for standard BQ output
  FullBQItem,
  ItemQuantityColumn,
  BQRowType,
  BQCostScopeType,
  MaterialCategory,
  StructuralElementType,
  TradeCategory,
  UnifiedTradeCategory,
  UnitType,
  ProjectType,
  // Import vocabulary shared with the Cost Library
  ColumnMappingConfig,
  QuantityColumnMapping,
  BQImportRowClassification,
  BQImportSummary,
  WorksheetAnalysis,
  WorkbookAnalysis,
  DetectedBillSummary,
  // Project-level settings, quantity layouts and pricing options
  ProjectSettings,
  BillQuantityLayout,
  BillQuantityPair,
  OptionPrice,
  PricingOptionsSetting,
  FinalRateRoundingMode,
} from './types/costLibrary.ts';
