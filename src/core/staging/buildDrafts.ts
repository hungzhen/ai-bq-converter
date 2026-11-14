/**
 * DRAFT ROWS (Stage 2J) — turns APPROVED review decisions into draft Cost Library rows
 * (StagedBQRow, which wraps the Cost Library's own FullBQItem). Draft rows only: nothing is
 * exported, uploaded or saved here. They are rebuilt from the saved decisions whenever needed, so
 * they can never drift from those decisions.
 *
 * WHAT IS USED
 *   - Only decisions a person APPROVED (the chosen reading) or CORRECTED (the recorded
 *     correction). Undecided proposals block their table; rejected ones are never used.
 *   - Values come only from the cited source cells, read one cell at a time by the Stage 2D
 *     parsers (D-011, D-012). Nothing is calculated: no quantity × rate, no totals, no figure
 *     filled in from another cell.
 *
 * SAFEGUARDS (Stage 2J decisions)
 *   1. A required quantity / rate / amount the document does not give is held as 0 ONLY as an
 *      internal placeholder: its evidence says what was found (blank, "-", "Rate Only" …), it is
 *      listed in `placeholders`, and it raises a BLOCKING issue. A genuine "0" in the document
 *      has evidence state "zero" and no placeholder — the two are never confused.
 *   2. A lump sum keeps its quantity "not stated". Quantity 1 is never assumed.
 *   3. Draft rows appear before the project year is entered; the missing year (and name) is a
 *      BLOCKING issue. Neither is ever inferred.
 *   4. Units are kept exactly as written. The Cost Library's spelling is shown separately.
 *   5. Rows whose type is unknown (or whose proposal was rejected without a correction) are not
 *      drafted and are listed in the reconciliation. Their type is never guessed.
 *   6. Every approved table is processed on its own. A blocked table never stops another, ready
 *      table from producing its drafts.
 *   - Negative values keep their sign and a BLOCKING issue (D-004).
 *   - Item numbers and descriptions are copied exactly. Continuation rows are joined to their
 *     item with one space, and every contributing cell is kept (`descriptionParts`) so the
 *     joined text can be checked against its sources (verifyDrafts).
 *   - Every source row of every table is accounted for in `accounts` (none silently omitted).
 *   - Progress-claim data never becomes BQ rows.
 */
import { frozenCopy } from '../../lib/immutable.ts';
import { costLibraryUnitSpelling } from '../../vendor/cost-library/units.ts';
import type { ColumnRole, DecisionKind, DecisionTypes, HierarchyLevel } from '../../providers/types.ts';
import type { Proposal } from '../evidence/proposals.ts';
import {
  type BqRowClass,
  type CellRef,
  type EvidenceNumberField,
  type EvidenceTextField,
  type ExtractedRow,
  type ExtractedTable,
  type ExtraColumnValue,
  type FieldEvidence,
  type SourceDocumentType,
  type SourceReference,
  type StagedBQRow,
  type ValidationIssue,
  approveClassificationProposal,
  cellText,
  cellValueForParsing,
  checkStagedRowIntegrity,
  columnLetter,
  createStagedBQRow,
  findCell,
  hasUsableValue,
  notStatedEvidence,
  rejectClassificationProposal,
  toCostLibrarySourceReference,
  validateFieldEvidence,
} from '../models/index.ts';
import { type NumericFieldKind, parseNumberCell, parseTextCell, parseUnitCell } from '../parsing/index.ts';
import type { ProjectDetails } from '../review/reviewRecord.ts';

// ---------------------------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------------------------

/** What happened to one source row. Every row of every table gets exactly one. */
export type RowCategory =
  | 'draft_item' // became a draft row
  | 'blocked_item' // an item row of a BLOCKED table: not drafted until the table is ready
  | 'continuation' // joined to an item's description
  | 'header' // column-heading row
  | 'heading' // bill / section / heading text, used as context for items below it
  | 'note' // notes and preambles (kept for the reconciliation; D-007)
  | 'total_or_carried' // totals, subtotals, carried / brought forward, collections, summaries
  | 'reference_or_title' // titles, page references
  | 'blank'
  | 'ignored' // a person decided "ignore"
  | 'unclassified' // type unknown, rejected without a correction, or never proposed — not guessed
  | 'outside_table_area' // above or below the approved table area
  | 'undecided' // its row type is still undecided (the table is blocked)
  | 'table_not_converted'; // the whole table is excluded (a person's decision, a claim, an empty sheet)

export const ROW_CATEGORIES: readonly RowCategory[] = [
  'draft_item', 'blocked_item', 'continuation', 'header', 'heading', 'note', 'total_or_carried', 'reference_or_title',
  'blank', 'ignored', 'unclassified', 'outside_table_area', 'undecided', 'table_not_converted',
];

export interface RowAccount {
  readonly rowIndex: number;
  /** As a person reads it, e.g. "Sheet: Bill 2 | Row 7". */
  readonly reference: string;
  readonly category: RowCategory;
  readonly rowClass: BqRowClass | null;
  readonly detail: string;
  /** The draft row it went into (items and their continuation rows). */
  readonly draftId?: string;
}

/** One cell that contributed to a draft's description, in order. */
export interface DescriptionPart {
  readonly rowIndex: number;
  readonly columnIndex: number;
  /** The cell's text exactly as read (Stage 2D text parser). */
  readonly text: string;
  readonly source: SourceReference;
}

export interface UnitDisplay {
  /** Exactly as written in the document; null when no unit is written. */
  readonly asWritten: string | null;
  /** What the Cost Library would store for it (shown only; never applied). */
  readonly costLibrarySpelling: string | null;
  readonly differs: boolean;
  readonly meaning: 'lump_sum' | 'percentage' | null;
}

export interface DraftRow {
  readonly row: StagedBQRow;
  readonly tableId: string;
  readonly itemRowIndex: number;
  readonly continuationRowIndexes: readonly number[];
  /** Joined with DESCRIPTION_SEPARATOR to give the description (when there is one). */
  readonly descriptionParts: readonly DescriptionPart[];
  readonly unit: UnitDisplay;
  /** Cells behind each field, for "show me where this came from". */
  readonly cells: Readonly<Record<string, readonly CellRef[]>>;
}

export type TableStatus = 'ready' | 'blocked' | 'not_converted';

export interface StatedTotal {
  readonly rowIndex: number;
  readonly reference: string;
  readonly label: string;
  /** Raw text of the amount cell, exactly as written. Not compared or recalculated in Stage 2J. */
  readonly amountText: string | null;
}

export interface TableDrafts {
  readonly tableId: string;
  readonly name: string;
  readonly status: TableStatus;
  /** Why the table is blocked or not converted (empty when ready). */
  readonly reasons: readonly string[];
  readonly drafts: readonly DraftRow[];
  readonly accounts: readonly RowAccount[];
  readonly counts: Readonly<Record<RowCategory, number>>;
  readonly sourceRowCount: number;
  readonly statedTotals: readonly StatedTotal[];
}

export interface ProjectIssue {
  readonly code: 'PROJECT_NAME_NOT_ENTERED' | 'PROJECT_YEAR_NOT_ENTERED';
  readonly message: string;
}

export interface DraftResult {
  readonly documentType: SourceDocumentType | null;
  /** Problems that stop every table (e.g. the document type is undecided). */
  readonly documentBlockers: readonly string[];
  /** Missing project name / year: BLOCKING on every draft row as well. */
  readonly projectIssues: readonly ProjectIssue[];
  readonly tables: readonly TableDrafts[];
}

export interface BuildDraftsInput {
  readonly proposals: readonly Proposal[];
  readonly tables: readonly ExtractedTable[];
  readonly documentId: string;
  readonly projectDetails: ProjectDetails;
  /** YYYY-MM-DD, for dateCreated / dateUpdated. */
  readonly today: string;
}

export const DESCRIPTION_SEPARATOR = ' ';

// ---------------------------------------------------------------------------------------------
// Decisions as a person left them
// ---------------------------------------------------------------------------------------------

type Decided<K extends DecisionKind> =
  | { readonly state: 'approved' | 'corrected'; readonly value: DecisionTypes[K]; readonly proposal: Proposal<K> }
  | { readonly state: 'pending' | 'rejected'; readonly proposal: Proposal<K> };

/** The approved reading (or the recorded correction). Never the provider's answer on its own. */
export function decisionOf<K extends DecisionKind>(p: Proposal<K>): Decided<K> {
  if (p.status === 'approved') {
    const value = p.chosen === undefined || p.chosen === 'primary' ? p.interpretation.value : p.interpretation.alternatives![p.chosen]!.value;
    return { state: 'approved', value, proposal: p };
  }
  if (p.status === 'rejected') return p.correction ? { state: 'corrected', value: p.correction.value, proposal: p } : { state: 'rejected', proposal: p };
  return { state: 'pending', proposal: p };
}

const isUsed = <K extends DecisionKind>(d: Decided<K> | undefined): d is Decided<K> & { value: DecisionTypes[K] } =>
  d !== undefined && (d.state === 'approved' || d.state === 'corrected');

/** The table and row a decision is about. Decisions are keyed by the ORIGINAL proposal's cells. */
function byKind<K extends DecisionKind>(proposals: readonly Proposal[], kind: K): Decided<K>[] {
  return proposals.filter((p) => p.interpretation.decisionKind === kind).map((p) => decisionOf(p as Proposal<K>));
}
const subject = <K extends DecisionKind>(d: Decided<K>) => d.proposal.interpretation.value as unknown as Record<string, unknown>;

// ---------------------------------------------------------------------------------------------
// Row classes and column roles
// ---------------------------------------------------------------------------------------------

const ITEM_CLASSES: readonly BqRowClass[] = ['priced_item', 'description_only_item', 'provisional_sum', 'prime_cost_sum', 'percentage_item'];
const HEADING_CLASS_LEVEL: Partial<Record<BqRowClass, HierarchyLevel>> = {
  bill_heading: 'bill', section_heading: 'section', main_heading: 'main_heading', subheading: 'subheading', secondary_subheading: 'secondary_subheading',
};
const CATEGORY_OF_CLASS: Record<BqRowClass, RowCategory> = {
  priced_item: 'draft_item', description_only_item: 'draft_item', provisional_sum: 'draft_item', prime_cost_sum: 'draft_item', percentage_item: 'draft_item',
  continuation: 'continuation',
  bill_heading: 'heading', section_heading: 'heading', main_heading: 'heading', subheading: 'heading', secondary_subheading: 'heading',
  note: 'note', note_label: 'note',
  subtotal: 'total_or_carried', total: 'total_or_carried', brought_forward: 'total_or_carried', carried_forward: 'total_or_carried', collection: 'total_or_carried', summary: 'total_or_carried',
  title: 'reference_or_title', reference: 'reference_or_title', column_header: 'header',
  blank: 'blank', ignore: 'ignored', unknown: 'unclassified',
};

/** Heading levels → the FullBQItem field they fill. */
const LEVEL_FIELD: Partial<Record<HierarchyLevel, EvidenceTextField>> = {
  bill: 'billDescription', section: 'sectionDescription', main_heading: 'mainHeading', subheading: 'subheading', secondary_subheading: 'secondarySubheading',
};

/** Column roles Stage 2J reads, and the field each fills. */
const TEXT_ROLES: Partial<Record<ColumnRole, EvidenceTextField>> = {
  billNo: 'billNo', billTitle: 'billDescription', section: 'sectionDescription',
  mainHeading: 'mainHeading', subheading: 'subheading', secondarySubheading: 'secondarySubheading', remarks: 'notes',
};
const NUMBER_ROLES: Partial<Record<ColumnRole, { field: 'quantity' | 'rate' | 'amount' | EvidenceNumberField; kind: NumericFieldKind }>> = {
  quantity: { field: 'quantity', kind: 'quantity' }, rate: { field: 'rate', kind: 'money' }, amount: { field: 'amount', kind: 'money' },
  baseRate: { field: 'baseRate', kind: 'money' }, baseAmount: { field: 'baseAmount', kind: 'money' },
  tenderRate: { field: 'tenderRate', kind: 'money' }, tenderAmount: { field: 'tenderAmount', kind: 'money' },
  rateAfterDiscount: { field: 'rateAfterDiscount', kind: 'money' }, profitPercent: { field: 'profitPercent', kind: 'percent' },
};
const CLAIM_ROLES: readonly ColumnRole[] = [
  'claimPreviousQuantity', 'claimCurrentQuantity', 'claimCumulativeQuantity', 'claimPreviousAmount',
  'claimCurrentAmount', 'claimCumulativeAmount', 'claimPercentComplete', 'certifiedAmount',
];
const NOT_YET_SUPPORTED: Partial<Record<ColumnRole, string>> = {
  additionalQuantity: 'additional quantity columns (several quantity columns) are not yet supported',
  additionalAmount: 'additional amount columns (pricing options) are not yet supported',
  percentage: 'a percentage column of undetermined purpose is not yet supported',
  element: 'an Element column is not yet supported (it needs the approval workflow of D-008)',
  trade: 'a Trade column is not yet supported (it needs the approval workflow of D-008)',
  costItem: 'a Cost Item column is not yet supported (it needs the approval workflow of D-008)',
};

const letter = (columnIndex: number) => columnLetter(columnIndex + 1);

// ---------------------------------------------------------------------------------------------
// Reading cells (one at a time, never calculated)
// ---------------------------------------------------------------------------------------------

/** The source reference of a cell — also for a cell that is not present in the extracted row. */
function cellSource(row: ExtractedRow, columnIndex: number): SourceReference {
  const cell = findCell(row, columnIndex);
  if (cell) return cell.source;
  const base = row.source;
  if (base.kind === 'pdf') return base;
  return { ...base, columnNumber: columnIndex + 1, cellAddress: `${letter(columnIndex)}${base.rowNumber}` };
}

const methodFor = (ref: SourceReference) => (ref.kind === 'csv' ? 'csv_cell' : ref.kind === 'pdf' ? 'pdf_text_layer' : 'spreadsheet_cell') as 'csv_cell' | 'spreadsheet_cell' | 'pdf_text_layer';

function readText(row: ExtractedRow, columnIndex: number): FieldEvidence<string> {
  const cell = findCell(row, columnIndex);
  const source = cellSource(row, columnIndex);
  return parseTextCell(cell ? cellValueForParsing(cell) : undefined, { sources: [source], method: methodFor(source) }, cell?.displayText ? { displayText: cell.displayText } : {});
}

function readNumber(row: ExtractedRow, columnIndex: number, kind: NumericFieldKind): FieldEvidence<number> {
  const cell = findCell(row, columnIndex);
  const source = cellSource(row, columnIndex);
  return parseNumberCell(cell ? cellValueForParsing(cell) : undefined, kind, { sources: [source], method: methodFor(source) }, cell?.displayText ? { displayText: cell.displayText } : {}).evidence;
}

const isEmptyCell = (row: ExtractedRow, columnIndex: number) => {
  const cell = findCell(row, columnIndex);
  return !cell || cell.raw === null || (typeof cell.raw === 'string' && cell.raw.trim() === '');
};

// ---------------------------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------------------------

const emptyCounts = (): Record<RowCategory, number> => Object.fromEntries(ROW_CATEGORIES.map((c) => [c, 0])) as Record<RowCategory, number>;

function tableName(table: ExtractedTable): string {
  return table.origin.kind === 'worksheet' ? table.origin.sheetName : table.origin.kind === 'csv' ? 'CSV' : table.id;
}

export function buildDrafts(input: BuildDraftsInput): DraftResult {
  const { proposals, tables, documentId, projectDetails, today } = input;

  // ---- The project (typed in by a person; never inferred) --------------------------------
  const projectIssues: ProjectIssue[] = [];
  if (projectDetails.name === null) projectIssues.push({ code: 'PROJECT_NAME_NOT_ENTERED', message: 'The project name has not been entered. It is never taken from the file name or assumed.' });
  if (projectDetails.year === null) projectIssues.push({ code: 'PROJECT_YEAR_NOT_ENTERED', message: 'The project year (e.g. "2024 Q1") has not been entered. It is never assumed.' });
  const project = {
    id: 'local-review',
    name: projectDetails.name ?? '',
    projectYear: projectDetails.year,
    ...(projectDetails.projectRef ? { projectRef: projectDetails.projectRef } : {}),
    ...(projectDetails.location ? { location: projectDetails.location } : {}),
  };

  // ---- The document type -----------------------------------------------------------------
  const documentBlockers: string[] = [];
  let notConvertedReason: string | null = null;
  const docDecisions = byKind(proposals, 'documentType');
  const doc = docDecisions[0];
  let documentType: SourceDocumentType | null = null;
  if (!doc) documentBlockers.push('No document type was proposed for this file.');
  else if (doc.state === 'pending') documentBlockers.push('The document type has not been decided yet.');
  else if (!isUsed(doc)) documentBlockers.push('The proposed document type was rejected and no correction was recorded.');
  else {
    documentType = doc.value.documentType;
    if (documentType === 'progress_claim') notConvertedReason = 'This document is a progress claim. Claim data is never turned into BQ rows.';
    else if (documentType === 'summary_only') notConvertedReason = 'This document is a summary only; it has no item rows to draft.';
    else if (documentType === 'unknown') documentBlockers.push('The document type is "unknown". Decide whether it is a BQ or a contractor working file first.');
  }

  const regions = byKind(proposals, 'tableRegion');
  const columns = byKind(proposals, 'columnRole');
  const rowClasses = byKind(proposals, 'rowClass');
  const hierarchies = byKind(proposals, 'hierarchy');
  const suggestions = byKind(proposals, 'classificationSuggestion');

  let sequence = 0;
  const out: TableDrafts[] = [];

  for (const table of tables) {
    const name = tableName(table);
    const ref = (rowIndex: number) => {
      const row = table.rows.find((r) => r.rowIndex === rowIndex);
      return row ? toCostLibrarySourceReference(row.source) : `${name} row ${rowIndex + 1}`;
    };
    const counts = emptyCounts();
    const accounts: RowAccount[] = [];
    const account = (a: RowAccount) => {
      accounts.push(a);
      counts[a.category]++;
    };
    const finish = (status: TableStatus, reasons: string[], drafts: DraftRow[] = [], statedTotals: StatedTotal[] = []) =>
      out.push(frozenCopy<TableDrafts>({ tableId: table.id, name, status, reasons, drafts, accounts, counts, sourceRowCount: table.rows.length, statedTotals }));
    const notConverted = (reason: string) => {
      for (const r of table.rows) account({ rowIndex: r.rowIndex, reference: ref(r.rowIndex), category: 'table_not_converted', rowClass: null, detail: reason });
      finish('not_converted', [reason]);
    };

    if (notConvertedReason) {
      notConverted(notConvertedReason);
      continue;
    }

    // ---- Table area ----------------------------------------------------------------------
    const region = regions.find((d) => subject(d)['tableId'] === table.id);
    if (!region) {
      if (table.rows.length === 0) notConverted('The worksheet is empty.');
      else {
        for (const r of table.rows) account({ rowIndex: r.rowIndex, reference: ref(r.rowIndex), category: 'undecided', rowClass: null, detail: 'No table area was proposed for this worksheet.' });
        finish('blocked', ['No table area was proposed for this worksheet, so nothing can be drafted from it.', ...documentBlockers]);
      }
      continue;
    }
    if (!isUsed(region)) {
      for (const r of table.rows) account({ rowIndex: r.rowIndex, reference: ref(r.rowIndex), category: 'undecided', rowClass: null, detail: 'The table area is not decided.' });
      finish('blocked', [region.state === 'pending' ? 'The table area has not been decided yet.' : 'The proposed table area was rejected and no correction was recorded.', ...documentBlockers]);
      continue;
    }
    const area = region.value;
    if (!area.include) {
      notConverted('You decided to exclude this worksheet (for example a cover or summary sheet).');
      continue;
    }
    const reasons: string[] = [...documentBlockers];
    const headerRows = new Set([...area.headerRowIndexes, ...area.repeatedHeaderRowIndexes]);

    // ---- Columns -------------------------------------------------------------------------
    const roleOf = new Map<number, ColumnRole>();
    for (const d of columns.filter((c) => subject(c)['tableId'] === table.id)) {
      const col = subject(d)['columnIndex'] as number;
      if (d.state === 'pending') reasons.push(`Column ${letter(col)}: its meaning has not been decided yet.`);
      else if (!isUsed(d)) reasons.push(`Column ${letter(col)}: the proposed meaning was rejected and no correction was recorded.`);
      else roleOf.set(d.value.columnIndex, d.value.role);
    }
    const columnFor = new Map<ColumnRole, number>();
    for (const [col, role] of [...roleOf.entries()].sort((a, b) => a[0] - b[0])) {
      if (role === 'unknown') reasons.push(`Column ${letter(col)}: its meaning is "unknown". Decide it (or mark it "ignore") so its values are not lost.`);
      else if (CLAIM_ROLES.includes(role)) reasons.push(`Column ${letter(col)} holds progress-claim figures. Claim data is never mixed into BQ rows.`);
      else if (NOT_YET_SUPPORTED[role]) reasons.push(`Column ${letter(col)}: ${NOT_YET_SUPPORTED[role]} in Stage 2J.`);
      else if (role !== 'other' && role !== 'ignore') {
        if (columnFor.has(role)) reasons.push(`Columns ${letter(columnFor.get(role)!)} and ${letter(col)} are both "${role}". Only one column may hold it.`);
        else columnFor.set(role, col);
      }
    }
    if (!columnFor.has('description')) reasons.push('No column is approved as the Description column.');

    // ---- Row types and heading levels ----------------------------------------------------
    const classDecision = new Map<number, Decided<'rowClass'>>();
    for (const d of rowClasses.filter((c) => subject(c)['tableId'] === table.id)) classDecision.set(subject(d)['rowIndex'] as number, d);
    const levelDecision = new Map<number, Decided<'hierarchy'>>();
    for (const d of hierarchies.filter((c) => subject(c)['tableId'] === table.id)) levelDecision.set(subject(d)['rowIndex'] as number, d);
    const classOf = (rowIndex: number): BqRowClass | null => {
      const d = classDecision.get(rowIndex);
      return isUsed(d) ? d.value.rowClass : null;
    };

    const inArea = (i: number) => i >= area.firstDataRowIndex && i <= area.lastDataRowIndex;
    const undecidedRows: string[] = [];
    const itemRows: number[] = [];
    const continuationRows: number[] = [];
    const rowAccount = new Map<number, Omit<RowAccount, 'draftId'>>();
    for (const r of table.rows) {
      const i = r.rowIndex;
      const base = { rowIndex: i, reference: ref(i) };
      const d = classDecision.get(i);
      const cls = isUsed(d) ? d.value.rowClass : null;
      let a: Omit<RowAccount, 'draftId'>;
      if (headerRows.has(i)) a = { ...base, category: 'header', rowClass: cls, detail: 'Column-heading row of the approved table area.' };
      else if (!inArea(i)) a = { ...base, category: 'outside_table_area', rowClass: cls, detail: 'Outside the approved table area.' };
      else if (!d) a = { ...base, category: 'unclassified', rowClass: null, detail: 'No row type was proposed for this row. Not drafted; its type is not guessed.' };
      else if (d.state === 'pending') {
        a = { ...base, category: 'undecided', rowClass: null, detail: 'Its row type has not been decided yet.' };
        undecidedRows.push(ref(i));
      } else if (d.state === 'rejected') a = { ...base, category: 'unclassified', rowClass: null, detail: 'The proposed row type was rejected without a correction. Not drafted; its type is not guessed.' };
      else {
        const category = CATEGORY_OF_CLASS[cls!];
        const hasContent = r.cells.some((c) => !isEmptyCell(r, c.columnIndex));
        const detail =
          category === 'unclassified' ? 'Its row type is "unknown". Not drafted; its type is not guessed.'
          : category === 'blank' && hasContent ? 'Decided as blank, although the row has content.'
          : category === 'note' ? 'Note / preamble: kept for the reconciliation, not drafted (D-007).'
          : category === 'total_or_carried' ? 'Total or carried figure: not drafted and not recalculated.'
          : category === 'heading' ? 'Heading: its text is used as context for the items below it.'
          : category === 'reference_or_title' ? 'Title or page reference: not drafted.'
          : category === 'header' ? 'Repeated column headings: not drafted.'
          : category === 'blank' ? 'Blank row.'
          : category === 'ignored' ? 'You decided to ignore this row.'
          : '';
        a = { ...base, category, rowClass: cls, detail };
        if (category === 'draft_item') itemRows.push(i);
        if (category === 'continuation') continuationRows.push(i);
      }
      rowAccount.set(i, a);
    }
    if (undecidedRows.length) reasons.push(`${undecidedRows.length} row(s) whose row type has not been decided yet: ${undecidedRows.slice(0, 8).join('; ')}${undecidedRows.length > 8 ? ' …' : ''}.`);
    const pendingLevels = [...levelDecision.values()].filter((d) => d.state === 'pending').map((d) => ref(subject(d)['rowIndex'] as number));
    if (pendingLevels.length) reasons.push(`${pendingLevels.length} heading-level decision(s) have not been decided yet: ${pendingLevels.slice(0, 8).join('; ')}${pendingLevels.length > 8 ? ' …' : ''}.`);

    // ---- Continuation rows: which item each belongs to (a person's decision, never guessed)
    const continuationsOf = new Map<number, number[]>();
    for (const c of continuationRows) {
      const h = levelDecision.get(c);
      const parent = isUsed(h) ? h.value.parentRowIndex : null;
      if (!isUsed(h) || h.value.level !== 'continuation' || parent === null) {
        reasons.push(`${ref(c)} is a continuation row, but which item it belongs to has not been decided.`);
      } else if (!itemRows.includes(parent)) {
        reasons.push(`${ref(c)} is a continuation of ${ref(parent)}, which is not an item row.`);
      } else continuationsOf.set(parent, [...(continuationsOf.get(parent) ?? []), c].sort((a, b) => a - b));
    }

    const statedTotals: StatedTotal[] = [];
    const amountCol = columnFor.get('amount');
    const descCol = columnFor.get('description');
    for (const [i, a] of rowAccount) {
      if (a.category !== 'total_or_carried') continue;
      const row = table.rows.find((r) => r.rowIndex === i)!;
      const label = descCol !== undefined ? cellTextOrEmpty(row, descCol) : '';
      const amountText = amountCol !== undefined && !isEmptyCell(row, amountCol) ? cellText(findCell(row, amountCol)!) : null;
      statedTotals.push({ rowIndex: i, reference: a.reference, label, amountText });
    }

    if (reasons.length) {
      for (const r of table.rows) {
        const a = rowAccount.get(r.rowIndex)!;
        account(a.category === 'draft_item' ? { ...a, category: 'blocked_item', detail: 'An item row. Not drafted while this table is blocked.' } : a);
      }
      finish('blocked', reasons, [], statedTotals);
      continue;
    }

    // ---- Build each item -----------------------------------------------------------------
    const drafts: DraftRow[] = [];
    const draftOfRow = new Map<number, string>();
    for (const itemIndex of itemRows) {
      const row = table.rows.find((r) => r.rowIndex === itemIndex)!;
      const conts = (continuationsOf.get(itemIndex) ?? []).map((ci) => table.rows.find((r) => r.rowIndex === ci)!);
      const id = `draft:${table.id}:${itemIndex}`;
      const cells: Record<string, CellRef[]> = {};
      const cite = (field: string, rowIndex: number, columnIndex: number) => (cells[field] = [...(cells[field] ?? []), { tableId: table.id, rowIndex, columnIndex }]);
      const extraIssues: ValidationIssue[] = [];

      // Description: the item's cell, then each continuation row's cell, joined with one space.
      const parts: DescriptionPart[] = [];
      const partEvidence: FieldEvidence<string>[] = [];
      for (const r of [row, ...conts]) {
        const e = readText(r, descCol!);
        cite('description', r.rowIndex, descCol!);
        partEvidence.push(e);
        if (hasUsableValue(e)) parts.push({ rowIndex: r.rowIndex, columnIndex: descCol!, text: e.parsed, source: e.sources[0]! });
      }
      let description: FieldEvidence<string>;
      if (parts.length <= 1 && conts.length === 0) description = partEvidence[0]!;
      else if (parts.length === 0) description = partEvidence[0]!;
      else if (parts.length === 1) description = partEvidence.find(hasUsableValue)!;
      else {
        const text = parts.map((p) => p.text).join(DESCRIPTION_SEPARATOR);
        description = joinedTextEvidence(text, parts);
      }

      // Values on a continuation row outside the description column are NOT used: flag them.
      for (const c of conts) {
        const used = c.cells.filter((cell) => cell.columnIndex !== descCol && roleOf.get(cell.columnIndex) !== 'ignore' && !isEmptyCell(c, cell.columnIndex));
        if (used.length) {
          extraIssues.push({
            id: `${id}:CONTINUATION_VALUES_NOT_USED:${c.rowIndex}`,
            code: 'CONTINUATION_VALUES_NOT_USED',
            severity: 'blocking',
            message: `${ref(c.rowIndex)} (a continuation row) has values outside the description column (${used.map((x) => `${letter(x.columnIndex)}: "${cellText(x)}"`).join(', ')}). They were NOT used; a person must decide where they belong.`,
            field: 'description',
            sources: used.map((x) => x.source),
          });
        }
      }

      const textAt = (role: ColumnRole, field: string) => {
        const col = columnFor.get(role);
        if (col === undefined) return undefined;
        cite(field, itemIndex, col);
        return readText(row, col);
      };
      const itemNo = textAt('itemNo', 'itemNo');

      // Unit: exactly as written; Cost Library spelling shown separately.
      const unitCol = columnFor.get('unit');
      let unitEvidence: FieldEvidence<string> = notStatedEvidence<string>('The approved columns of this table include no Unit column.');
      let unit: UnitDisplay = { asWritten: null, costLibrarySpelling: null, differs: false, meaning: null };
      if (unitCol !== undefined) {
        cite('unit', itemIndex, unitCol);
        const cell = findCell(row, unitCol);
        const source = cellSource(row, unitCol);
        const parsed = parseUnitCell(cell ? cellValueForParsing(cell) : undefined, { sources: [source], method: methodFor(source) });
        unitEvidence = parsed.evidence;
        if (hasUsableValue(parsed.evidence)) {
          const spelling = costLibraryUnitSpelling(parsed.evidence.parsed);
          unit = { asWritten: parsed.evidence.parsed, costLibrarySpelling: spelling, differs: spelling !== parsed.evidence.parsed, meaning: parsed.meaning };
        }
      }

      const numberAt = (role: ColumnRole): FieldEvidence<number> => {
        const spec = NUMBER_ROLES[role]!;
        const col = columnFor.get(role);
        if (col === undefined) return notStatedEvidence<number>(`The approved columns of this table include no ${role} column.`);
        cite(spec.field, itemIndex, col);
        return readNumber(row, col, spec.kind);
      };
      const quantity = numberAt('quantity');
      if (unit.meaning === 'lump_sum' && !hasUsableValue(quantity)) {
        extraIssues.push({
          id: `${id}:LUMP_SUM_QUANTITY_NOT_STATED:quantity`,
          code: 'LUMP_SUM_QUANTITY_NOT_STATED',
          severity: 'info',
          message: `The unit is a lump sum ("${unit.asWritten}") and the document gives no quantity. The quantity stays "not stated"; it is NOT assumed to be 1.`,
          field: 'quantity',
          sources: quantity.sources,
        });
      }

      const evidence: Record<string, FieldEvidence> = {
        description,
        unit: unitEvidence,
        quantity,
        rate: numberAt('rate'),
        amount: numberAt('amount'),
      };
      if (itemNo) {
        evidence['itemNo'] = itemNo;
        evidence['originalItemNo'] = itemNo;
        cells['originalItemNo'] = cells['itemNo'] ?? [];
      }
      for (const [role, field] of Object.entries(TEXT_ROLES) as [ColumnRole, EvidenceTextField][]) {
        const e = textAt(role, field);
        if (e) evidence[field] = e;
      }
      for (const role of ['baseRate', 'baseAmount', 'tenderRate', 'tenderAmount', 'rateAfterDiscount', 'profitPercent'] as const) {
        if (columnFor.has(role)) evidence[NUMBER_ROLES[role]!.field] = numberAt(role);
      }

      // Heading context: follow the APPROVED heading levels upwards (nearest heading wins).
      const levelOf = (i: number): HierarchyLevel | null => {
        const h = levelDecision.get(i);
        if (isUsed(h)) return h.value.level;
        const cls = classOf(i);
        return cls ? (HEADING_CLASS_LEVEL[cls] ?? null) : null;
      };
      const parentOf = (i: number): number | null => {
        const h = levelDecision.get(i);
        return isUsed(h) ? h.value.parentRowIndex : null;
      };
      const seen = new Set<number>([itemIndex]);
      for (let p = parentOf(itemIndex); p !== null && !seen.has(p); p = parentOf(p)) {
        seen.add(p);
        const field = LEVEL_FIELD[levelOf(p) ?? 'item'];
        if (!field || evidence[field]) continue;
        const headingRow = table.rows.find((r) => r.rowIndex === p);
        if (!headingRow) continue;
        const col = headingTextColumn(headingRow, descCol!);
        if (col === null) {
          extraIssues.push({
            id: `${id}:HEADING_TEXT_NOT_FOUND:${p}`,
            code: 'HEADING_TEXT_NOT_FOUND',
            severity: 'warning',
            message: `The heading at ${ref(p)} has text in more than one cell outside the description column; which text is the heading was not guessed, so ${field} is left blank.`,
            field,
            sources: [headingRow.source],
          });
          continue;
        }
        cite(field, p, col);
        evidence[field] = readText(headingRow, col);
      }

      const staged = createStagedBQRow({
        id,
        project,
        documentId,
        rowClass: classOf(itemIndex)!,
        sequence: ++sequence,
        sources: [row.source, ...conts.map((c) => c.source)],
        evidence: evidence as never,
        extraColumns: [...roleOf.entries()].filter(([, role]) => role === 'other').sort((a, b) => a[0] - b[0]).map(([col]): ExtraColumnValue => {
          cite(`extra:${letter(col)}`, itemIndex, col);
          return { columnHeader: headerText(table, area.headerRowIndexes, col), evidence: readText(row, col) };
        }),
        proposals: [],
        today,
        extraIssues,
      });

      // Trade / Sub-trade / Cost Item / Element: ONLY approved suggestions enter the row (D-008).
      let withClassification = staged;
      for (const s of suggestions.filter((x) => subject(x)['tableId'] === table.id && subject(x)['rowIndex'] === itemIndex)) {
        const v = isUsed(s) ? s.value : (s.proposal.interpretation.value as DecisionTypes['classificationSuggestion']);
        const proposal = {
          id: s.proposal.id,
          field: v.field,
          value: v.label,
          method: 'rule-based' as const,
          providerId: s.proposal.interpretation.providerId,
          reason: s.proposal.interpretation.reasoning,
          sources: s.proposal.interpretation.evidence.map((c) => cellSource(table.rows.find((r) => r.rowIndex === c.rowIndex) ?? row, c.columnIndex ?? 0)),
          status: 'pending' as const,
        };
        withClassification = frozenCopy({ ...withClassification, proposals: [...withClassification.proposals, proposal] });
        const by = s.proposal.decision?.by ?? 'not recorded';
        const at = s.proposal.decision?.at ?? today;
        // A second approved label for a field already filled stays pending (shown, not applied).
        if (isUsed(s) && withClassification.item[v.field] === undefined) withClassification = approveClassificationProposal(withClassification, s.proposal.id, by, at);
        else if (s.state === 'rejected') withClassification = rejectClassificationProposal(withClassification, s.proposal.id, by, at);
      }

      draftOfRow.set(itemIndex, id);
      for (const c of conts) draftOfRow.set(c.rowIndex, id);
      drafts.push(frozenCopy<DraftRow>({ row: withClassification, tableId: table.id, itemRowIndex: itemIndex, continuationRowIndexes: conts.map((c) => c.rowIndex), descriptionParts: parts, unit, cells }));
    }

    for (const r of table.rows) {
      const a = rowAccount.get(r.rowIndex)!;
      const draftId = draftOfRow.get(r.rowIndex);
      account(draftId ? { ...a, draftId, detail: a.category === 'continuation' ? `Joined to the description of the item at ${ref(Number(draftId.split(':').at(-1)))}.` : a.detail } : a);
    }
    finish('ready', [], drafts, statedTotals);
  }

  return frozenCopy<DraftResult>({ documentType, documentBlockers, projectIssues, tables: out });
}

function cellTextOrEmpty(row: ExtractedRow, col: number): string {
  const cell = findCell(row, col);
  return cell ? cellText(cell) : '';
}

/** The heading's text cell: the description column, or the only non-empty cell. Otherwise not guessed. */
function headingTextColumn(row: ExtractedRow, descCol: number): number | null {
  if (!isEmptyCell(row, descCol)) return descCol;
  const filled = row.cells.filter((c) => !isEmptyCell(row, c.columnIndex));
  return filled.length === 1 ? filled[0]!.columnIndex : null;
}

function headerText(table: ExtractedTable, headerRows: readonly number[], col: number): string {
  for (const i of headerRows) {
    const row = table.rows.find((r) => r.rowIndex === i);
    const t = row ? cellTextOrEmpty(row, col).trim() : '';
    if (t) return t;
  }
  return `Column ${letter(col)}`;
}

/** Evidence for a description joined from several cells. Every contributing cell is a source. */
function joinedTextEvidence(text: string, parts: readonly DescriptionPart[]): FieldEvidence<string> {
  const e: FieldEvidence<string> = {
    state: 'value',
    raw: text,
    parsed: text,
    sources: parts.map((p) => p.source),
    method: 'derived_by_rule',
    verification: 'auto_checked',
    derivation: {
      rule: 'join_continuation_rows',
      fromFields: parts.map((p) => (p.source.kind === 'pdf' ? `page ${p.source.pageNumber}` : (p.source.cellAddress ?? `row ${p.source.rowNumber}`))),
      explanation: `The item's description followed by its continuation row(s), each cell's text exactly as written, joined with one space (${parts.length} cells).`,
    },
    note: 'Joined description. Each contributing cell is listed in the draft row\'s description parts.',
  };
  const problems = validateFieldEvidence(e);
  if (problems.length) throw new Error(`Joined description evidence is inconsistent: ${problems.join(' ')}`);
  return frozenCopy(e);
}

/**
 * Checks every draft against the source cells again: each FullBQItem value matches its evidence
 * (checkStagedRowIntegrity), each description part matches its cell exactly, the joined
 * description equals its parts, and every source row is accounted for exactly once.
 * Returns plain-English problems; an empty list means every draft traces to its sources.
 */
export function verifyDrafts(result: DraftResult, tables: readonly ExtractedTable[]): string[] {
  const problems: string[] = [];
  for (const t of result.tables) {
    const table = tables.find((x) => x.id === t.tableId);
    if (!table) {
      problems.push(`${t.name}: the table is not in the extracted source.`);
      continue;
    }
    const total = ROW_CATEGORIES.reduce((n, c) => n + t.counts[c], 0);
    if (total !== table.rows.length || t.accounts.length !== table.rows.length) problems.push(`${t.name}: ${table.rows.length} source rows but ${t.accounts.length} accounted for.`);
    const accounted = new Set(t.accounts.map((a) => a.rowIndex));
    for (const r of table.rows) if (!accounted.has(r.rowIndex)) problems.push(`${t.name}: ${toCostLibrarySourceReference(r.source)} is not accounted for.`);

    for (const d of t.drafts) {
      for (const p of checkStagedRowIntegrity(d.row)) problems.push(`${d.row.id}: ${p}`);
      for (const part of d.descriptionParts) {
        const row = table.rows.find((r) => r.rowIndex === part.rowIndex);
        const again = row ? readText(row, part.columnIndex) : undefined;
        if (!again || !hasUsableValue(again) || again.parsed !== part.text) problems.push(`${d.row.id}: description part at ${letter(part.columnIndex)}${part.rowIndex + 1} does not match the cell.`);
      }
      const e = d.row.evidence.description;
      if (d.descriptionParts.length > 0) {
        const joined = d.descriptionParts.map((p) => p.text).join(DESCRIPTION_SEPARATOR);
        if (d.row.item.description !== joined || !hasUsableValue(e) || e.parsed !== joined) problems.push(`${d.row.id}: the description is not exactly its source parts joined.`);
        if (e.sources.length !== d.descriptionParts.length) problems.push(`${d.row.id}: the description's evidence does not list every contributing cell.`);
      }
    }
  }
  return problems;
}
