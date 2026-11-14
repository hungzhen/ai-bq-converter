/**
 * The Cost Library's trade taxonomy, used ONLY as a reference list for suggestions and checks.
 *
 * Re-exports two read-only data lists from the exact copy of costLibrary.ts — nothing else.
 * No Cost Library functions (e.g. normalizeTradeCategory, which falls back to "01-preliminaries"
 * when it finds nothing, or parseCleanRate) are used by the converter. A test checks that this
 * file exports exactly these two lists.
 */
export { TRADE_SUBTRADES, UNIFIED_TRADE_PACKAGES } from './types/costLibrary.ts';
export type { UnifiedTradeCategory, UnifiedTradePackage } from './types/costLibrary.ts';
