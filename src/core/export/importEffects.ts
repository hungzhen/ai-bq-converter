/**
 * COST LIBRARY IMPORT EFFECTS — what the Cost Library's importer is expected to do with a row of
 * the upload workbook, as found by READING its code (read-only, with the owner's permission) at
 * commit 00491965:
 *   src/utils/exportImport.ts      buildFullBQTemplate — the "BQ" sheet and its columns
 *   src/utils/bqImportAnalyzer.ts  parseBQWorkbookWithCustomConfig — blanks become 0; a blank
 *                                  amount is worked out as rate × qty and a blank rate as
 *                                  amount ÷ qty; a row with no unit and no figures is a heading;
 *                                  parseCleanRate turns negatives positive
 *   src/utils/bqSheetScan.ts       isExampleRow — rows marked "EXAMPLE" are skipped
 *
 * These are EXPECTATIONS, not confirmed behaviour: every effect is labelled "not yet confirmed
 * by the compatibility test". The converter never applies any of them; it only reports them.
 * No figure is calculated here — an effect says WHAT the importer would calculate, never the result.
 */
import { costLibraryUnitSpelling } from '../../vendor/cost-library/units.ts';

export const IMPORT_EFFECT_BASIS = 'Read from the Cost Library code at commit 00491965 (read-only). NOT YET CONFIRMED by the compatibility test.';

/** One upload-workbook row as written (null = a genuinely blank cell). */
export interface UploadRowValues {
  readonly no: string | null;
  readonly bill: string | null;
  readonly element: string | null;
  readonly mainHeading: string | null;
  readonly subheading: string | null;
  readonly secondarySubheading: string | null;
  readonly description: string | null;
  readonly unit: string | null;
  readonly qty: number | null;
  readonly rate: number | null;
  readonly amount: number | null;
}

export interface ImportEffect {
  readonly field: string;
  readonly effect: string;
}

const zeroOrBlank = (v: number | null) => v === null || v === 0;
const TOTAL_WORDING = /^\s*(grand\s+|sub-?\s?)?total\b|^\s*(carried|brought)\s+forward|^\s*to\s+(the\s+)?(collection|summary)/i;

/** Expected effects of the importer on one row. `context` adds facts the row's cells do not show. */
export function importEffectsFor(v: UploadRowValues, context: { readonly rateOnlyInDocument: boolean; readonly sectionDescription: string | null }): ImportEffect[] {
  const out: ImportEffect[] = [];
  if (v.unit !== null) {
    const spelling = costLibraryUnitSpelling(v.unit);
    if (spelling !== v.unit) out.push({ field: 'Unit', effect: `Written "${v.unit}" (exactly as in the document); the Cost Library is expected to store "${spelling}".` });
  }
  if (v.qty === null) out.push({ field: 'Qty', effect: 'Blank: the importer is expected to store 0.' });
  if (v.rate === null) {
    out.push({
      field: 'Rate (RM)',
      effect: v.amount !== null && v.amount > 0 && v.qty !== null && v.qty > 0
        ? 'Blank: the importer is expected to CALCULATE a rate as Amount ÷ Qty (the converter does not).'
        : 'Blank: the importer is expected to store 0.',
    });
  }
  if (v.amount === null) {
    out.push({
      field: 'Amount (RM)',
      effect: v.rate !== null && v.rate > 0 && v.qty !== null && v.qty > 0
        ? 'Blank: the importer is expected to CALCULATE an amount as Rate × Qty (the converter does not).'
        : 'Blank: the importer is expected to store 0.',
    });
  }
  if ((v.unit === null || v.unit.trim() === '' || /^[-–—]$/.test(v.unit.trim())) && zeroOrBlank(v.qty) && zeroOrBlank(v.rate) && zeroOrBlank(v.amount)) {
    out.push({ field: 'Row', effect: 'No unit and no figures: the importer is expected to read this row as a HEADING, not an item.' });
  }
  const cells = [v.no, v.bill, v.element, v.mainHeading, v.subheading, v.secondarySubheading, v.description, v.unit];
  if (cells.some((c) => c !== null && (c.trim() === 'EXAMPLE' || /^EXAMPLE ONLY\b/.test(c.trim())))) {
    out.push({ field: 'Row', effect: 'Marked "EXAMPLE": the importer is expected to SKIP this row entirely.' });
  }
  if (v.description !== null && TOTAL_WORDING.test(v.description)) out.push({ field: 'Item Description', effect: 'Worded like a total: the importer may read it as a total, not an item.' });
  if (v.unit !== null && v.unit.trim() === '%') out.push({ field: 'Row', effect: 'Unit "%": the importer may treat it as a percentage item whose amount it works out from a sum above.' });
  if (context.rateOnlyInDocument) out.push({ field: 'Qty', effect: 'The document says "Rate Only"; the cell is blank in the upload, so the importer will not mark the item rate-only.' });
  if (context.sectionDescription) out.push({ field: 'Section', effect: `The section heading "${context.sectionDescription}" has no column in the template and is not carried into the upload.` });
  if (v.bill === null) out.push({ field: 'Bill', effect: 'Blank (no bill heading was approved): how the importer assigns the bill is not known.' });
  return out;
}

/** Effects that apply to the whole upload workbook. */
export const GENERAL_IMPORT_EFFECTS: readonly ImportEffect[] = [
  { field: 'Project', effect: 'The project name and year are not in the workbook: the Cost Library takes them from its import dialog.' },
  { field: 'Level 2 Element', effect: 'Left blank: Element columns are not yet supported by the converter.' },
  { field: 'Negative values', effect: 'The importer is expected to turn negative figures positive. No negative figure is in the upload workbook: such rows can only be excluded.' },
  { field: 'Sheets', effect: 'The workbook has an "Instructions" sheet (as the official template does) and a "BQ" sheet. How the importer treats the Instructions sheet is not yet confirmed.' },
];
