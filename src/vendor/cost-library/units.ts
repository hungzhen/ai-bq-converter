/**
 * The Cost Library's unit spelling, used ONLY to SHOW what the Cost Library would store for a
 * unit (Stage 2J decision 4). The converter never changes the unit text from the document: the
 * draft row keeps the unit exactly as written, and this spelling is displayed beside it.
 *
 * Re-exports one read-only function from the exact copy of costLibrary.ts — nothing else. It is
 * only called for a unit that is actually written in the document (never for a blank cell, where
 * the Cost Library would fall back to "item").
 */
export { normalizeUnit as costLibraryUnitSpelling } from './types/costLibrary.ts';
