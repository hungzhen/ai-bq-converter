/**
 * The list of valid BqRowClass values, for checking provider answers at run time.
 * The compiler confirms this list is exactly the BqRowClass type (see the test).
 */
import type { BqRowClass } from '../models/stagedBQRow.ts';

export const BQ_ROW_CLASSES_FOR_CHECKS = [
  'title', 'column_header', 'bill_heading', 'section_heading', 'main_heading', 'subheading', 'secondary_subheading',
  'priced_item', 'description_only_item', 'provisional_sum', 'prime_cost_sum', 'percentage_item',
  'continuation', 'note', 'note_label', 'subtotal', 'total', 'brought_forward', 'carried_forward',
  'collection', 'summary', 'reference', 'blank', 'unknown', 'ignore',
] as const satisfies readonly BqRowClass[];
