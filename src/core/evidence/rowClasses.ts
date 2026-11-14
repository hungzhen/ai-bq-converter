/**
 * The list of valid BqRowClass values, for checking provider answers at run time.
 * The compiler confirms this list is exactly the BqRowClass type (see the test).
 */
import type { BqRowClass } from '../models/stagedBQRow.ts';

export const BQ_ROW_CLASSES_FOR_CHECKS = [
  'bill_heading', 'section_heading', 'main_heading', 'subheading', 'secondary_subheading', 'priced_item',
  'continuation', 'note', 'note_label', 'subtotal', 'total', 'brought_forward', 'carried_forward',
  'collection', 'summary', 'reference', 'ignore',
] as const satisfies readonly BqRowClass[];
