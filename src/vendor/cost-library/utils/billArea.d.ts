/**
 * ============================================================================
 * STAND-IN — NOT AN ORIGINAL COST LIBRARY FILE
 * ============================================================================
 * The copied `../types/costLibrary.ts` refers to `import('../utils/billArea').AreaUnit`
 * and `import('../utils/billArea').BillAreaSource`. This declaration file sits at that
 * path so the copy compiles without being changed.
 *
 * Kind: EXACT TRANSCRIPTION of the two type definitions only (no code).
 * Original: hungzhen/Cost-Library, src/utils/billArea.ts, lines 10 and 28,
 *           commit 00491965a20cc9b68d7a928ddbcac3b68e91ccfc
 */
export type AreaUnit = 'm2' | 'acre';

/**
 * A bill's area taken from Project Info instead of typed in (estimate.billAreaSources):
 *   'gfa'                the project's total GFA (m²)
 *   'site_acre'          the site area (acre)
 *   'zones:<id>,<id>'    one or more zones of the area breakdown, their GFA added up (m²)
 */
export type BillAreaSource = string;
