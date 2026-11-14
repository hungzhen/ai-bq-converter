/**
 * EXPORT (Stage 2L) — the Cost Library upload workbook and the reconciliation workbook.
 *
 *   1. CHECKS BEFORE WRITING (planExport). Nothing is written unless:
 *      - the saved review passes its checks and the drafts trace to their source cells;
 *      - the project name and year are entered;
 *      - at least one table is READY FOR EXPORT (every draft row approved or excluded, nothing
 *        outdated). Ready tables may be exported while others are blocked; blocked tables never
 *        appear in the upload workbook and are listed in the reconciliation.
 *      - every exported row is approved (current), has no unresolved blocking issue and no
 *        negative figure, and every blank Qty / Rate / Amount is a placeholder a person
 *        CONFIRMED as not stated in the document.
 *   2. THE UPLOAD WORKBOOK — the Cost Library "BQ" template (verified read-only at commit
 *      00491965): approved rows only, in source order, headings on every row, values copied
 *      exactly (units as written, bill heading as approved or blank), confirmed placeholders as
 *      GENUINELY BLANK cells. No totals, no calculations, no formulas. Labelled
 *      NOT YET VALIDATED FOR COST LIBRARY IMPORT (file name, Instructions sheet, properties).
 *   3. THE RECONCILIATION WORKBOOK — never for upload ("NOT a Cost Library upload workbook" on
 *      every sheet): summary, line trace, coverage of every source row exactly once, excluded
 *      rows (negatives keep their sign), issues and resolutions, placeholders, expected import
 *      effects, extra columns, decision history, blocked tables. Stated totals are listed only.
 *   4. READ-BACK CHECKS — both files are read back with the converter's own extractor and
 *      compared cell by cell. If anything differs, no file is offered.
 *   5. HISTORY — the export is recorded: time, name as typed, tables, both files' SHA-256.
 *
 * Claims are never exported here. No network, no Cost Library code is run.
 */
import { sha256Hex } from '../extraction/hash.ts';
import { extractSpreadsheetFile } from '../extraction/extractSpreadsheet.ts';
import { type ExtractedTable, type FieldEvidence, type SourceDocument, cellValueForParsing, describeSourceReference, hasUsableValue, toCostLibrarySourceReference } from '../models/index.ts';
import { type ExportRecord, type SavedReview, recordExport } from '../review/reviewRecord.ts';
import { validateReviewRecord } from '../review/validate.ts';
import { type DraftResult, type RowView, type TableDrafts, type TableReadiness, figureText, tableReadiness, verifyDrafts } from '../staging/index.ts';
import { GENERAL_IMPORT_EFFECTS, IMPORT_EFFECT_BASIS, type UploadRowValues, importEffectsFor } from './importEffects.ts';
import { type Cell, writeWorkbook } from './sheets.ts';

export const NOT_VALIDATED = 'NOT YET VALIDATED FOR COST LIBRARY IMPORT';
export const RECONCILIATION_BANNER = 'NOT a Cost Library upload workbook — reconciliation record only. Never upload this file.';
export const UPLOAD_SHEET = 'BQ';
export const INSTRUCTIONS_SHEET = 'Instructions';
/** Exactly the Cost Library template's "BQ" columns (exportImport.ts buildFullBQTemplate, commit 00491965). */
export const UPLOAD_HEADERS = ['No.', 'Bill', 'Level 2 Element', 'Main Heading', 'Subheading', 'Secondary Subheading', 'Item Description', 'Unit', 'Qty', 'Rate (RM)', 'Amount (RM)'] as const;
export const RECONCILIATION_SHEETS = [
  'Summary', 'Line Trace', 'Coverage', 'Excluded Rows', 'Issues & Resolutions', 'Placeholders', 'Import Effects', 'Extra Columns', 'Decision History', 'Blocked Tables',
] as const;

// ---------------------------------------------------------------------------------------------
// 1. Checks before writing
// ---------------------------------------------------------------------------------------------

export interface ExportRow {
  /** Row number in the "BQ" sheet (the header is row 1). */
  readonly sheetRow: number;
  readonly view: RowView;
  readonly table: TableDrafts;
  readonly values: UploadRowValues;
}

export type ExportPlan =
  | { readonly ok: true; readonly rows: readonly ExportRow[]; readonly exported: readonly { table: TableDrafts; readiness: TableReadiness }[]; readonly notExported: readonly { table: TableDrafts; readiness: TableReadiness }[] }
  | { readonly ok: false; readonly errors: readonly string[] };

const text = (e: FieldEvidence | undefined): string | null => (e && hasUsableValue(e) ? String(e.parsed) : null);
const num = (e: FieldEvidence): number | null => (hasUsableValue(e) && typeof e.parsed === 'number' ? e.parsed : null);
const opt = (v: string | undefined): string | null => (v === undefined || v === '' ? null : v);

/** The cells of one upload row, copied from the approved draft row. null = genuinely blank. */
export function uploadValues(view: RowView): UploadRowValues {
  const r = view.draft.row;
  return {
    no: text(r.evidence.itemNo),
    bill: opt(r.item.billDescription),
    element: null,
    mainHeading: opt(r.item.mainHeading),
    subheading: opt(r.item.subheading),
    secondarySubheading: opt(r.item.secondarySubheading),
    description: text(r.evidence.description),
    unit: text(r.evidence.unit),
    qty: num(r.evidence.quantity),
    rate: num(r.evidence.rate),
    amount: num(r.evidence.amount),
  };
}

export function planExport(drafts: DraftResult, review: SavedReview, tables: readonly ExtractedTable[]): ExportPlan {
  const errors: string[] = [];
  const recordProblems = validateReviewRecord(review);
  if (recordProblems.length) errors.push('The saved review did not pass its checks:', ...recordProblems.slice(0, 10));
  const trace = verifyDrafts(drafts, tables);
  if (trace.length) errors.push('The draft rows did not pass the check against their source cells:', ...trace.slice(0, 10));
  for (const i of drafts.projectIssues) errors.push(i.message);
  if (drafts.documentBlockers.length) errors.push(...drafts.documentBlockers);

  const all = drafts.tables.map((table) => ({ table, readiness: tableReadiness(table, review, drafts.projectIssues) }));
  const exported = all.filter((x) => x.readiness.readyForExport && x.table.drafts.length > 0);
  const notExported = all.filter((x) => !exported.includes(x));
  if (exported.length === 0) errors.push('No table is ready for export: every draft row of a table must be approved or excluded, with nothing outdated.');

  const rows: ExportRow[] = [];
  for (const { table, readiness } of exported) {
    for (const view of readiness.views) {
      if (view.effective === 'excluded') continue;
      const where = view.draft.row.item.sourceReference;
      if (view.effective !== 'approved') errors.push(`${where}: not approved.`);
      if (view.unresolvedBlocking.length) errors.push(`${where}: ${view.unresolvedBlocking.length} unresolved blocking issue(s).`);
      const values = uploadValues(view);
      for (const [field, v] of [['Qty', values.qty], ['Rate', values.rate], ['Amount', values.amount]] as const) {
        if (v !== null && v < 0) errors.push(`${where}: ${field} is negative (${v}). A negative row can only be excluded; it is never exported.`);
      }
      for (const field of ['quantity', 'rate', 'amount'] as const) {
        if (hasUsableValue(view.draft.row.evidence[field])) continue;
        const confirmed = view.blocking.some((b) => b.issue.field === field && b.issue.code === 'REQUIRED_FIELD_NOT_IN_SOURCE' && b.resolution?.kind === 'confirmed_not_stated' && !b.outdated);
        if (!confirmed) errors.push(`${where}: ${field} would be blank but was not confirmed as "not stated in the document".`);
      }
      rows.push({ sheetRow: rows.length + 2, view, table, values });
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, rows, exported, notExported };
}

// ---------------------------------------------------------------------------------------------
// 2. The upload workbook
// ---------------------------------------------------------------------------------------------

export const rowCells = (v: UploadRowValues): Cell[] => [v.no, v.bill, v.element, v.mainHeading, v.subheading, v.secondarySubheading, v.description, v.unit, v.qty, v.rate, v.amount];

export function buildUploadWorkbook(rows: readonly ExportRow[], meta: { readonly sourceFile: string; readonly at: string }): Uint8Array {
  const instructions: Cell[][] = [
    [NOT_VALIDATED],
    ['This workbook has NOT been checked against the Cost Library import. Do not upload it until the separate compatibility test has been completed and approved.'],
    ['The Cost Library importer may apply defaults or calculations to blank cells (see the "Import Effects" sheet of the reconciliation workbook).'],
    [''],
    ['Made by the AI BQ Converter from', meta.sourceFile],
    ['Made at', meta.at],
    ['Rows', `${rows.length} approved draft row(s), in source order. Excluded rows and blocked tables are not included.`],
    ['Values', 'Copied exactly from the source cells. Nothing is calculated. A blank Qty / Rate / Amount means the document does not state it (confirmed by a reviewer); it is not zero.'],
    ['Project name and year', 'Not in this workbook: the Cost Library asks for them when importing.'],
  ];
  return writeWorkbook(
    [
      { name: INSTRUCTIONS_SHEET, rows: instructions, widths: [28, 120] },
      { name: UPLOAD_SHEET, rows: [[...UPLOAD_HEADERS], ...rows.map((r) => rowCells(r.values))], widths: [8, 34, 24, 28, 40, 24, 70, 8, 12, 14, 16] },
    ],
    { title: NOT_VALIDATED, subject: 'Cost Library BQ upload workbook (draft) — AI BQ Converter', comments: 'Not yet validated for Cost Library import. Do not upload until the compatibility test is approved.' },
  );
}

// ---------------------------------------------------------------------------------------------
// 3. The reconciliation workbook
// ---------------------------------------------------------------------------------------------

const rawText = (e: FieldEvidence | undefined): string => (e === undefined || e.raw === null ? '' : String(e.raw));
const refsOf = (v: RowView) => v.draft.row.sources.map(toCostLibrarySourceReference).join('; ');
const sheetWith = (headers: string[], rows: Cell[][]): Cell[][] => [[RECONCILIATION_BANNER], headers, ...rows];

export function buildReconciliationWorkbook(
  plan: Extract<ExportPlan, { ok: true }>,
  drafts: DraftResult,
  review: SavedReview,
  document: SourceDocument,
  upload: { readonly fileName: string; readonly sha256: string; readonly at: string; readonly by: string | null },
): Uint8Array {
  const pd = review.projectDetails;
  const exportedRowOf = new Map(plan.rows.map((r) => [r.view.draft.row.id, r.sheetRow]));
  const exportedTables = new Set(plan.exported.map((x) => x.table.tableId));
  const allViews = [...plan.exported, ...plan.notExported].flatMap((x) => x.readiness.views);
  const viewOf = new Map(allViews.map((v) => [v.draft.row.id, v]));

  // Summary
  const summary: Cell[][] = [
    ['Project name', pd?.name ?? 'not entered'],
    ['Project year', pd?.year ?? 'not entered'],
    ['Project reference', pd?.projectRef ?? 'not entered'],
    ['Location', pd?.location ?? 'not entered'],
    ['Source file', document.fileName],
    ['Source file SHA-256', document.sha256],
    ['Exported at', upload.at],
    ['Exported by (typed in, not verified)', upload.by ?? 'not recorded'],
    ['Upload workbook', upload.fileName],
    ['Upload workbook SHA-256', upload.sha256],
    ['Upload workbook status', NOT_VALIDATED],
    [''],
    ['Table', 'Status', 'In upload workbook', 'Rows exported', 'Rows excluded', 'Source rows'],
    ...[...plan.exported, ...plan.notExported].map(({ table, readiness }): Cell[] => [
      table.name,
      table.status,
      exportedTables.has(table.tableId) ? 'yes' : 'no',
      plan.rows.filter((r) => r.table.tableId === table.tableId).length,
      readiness.counts.excluded,
      table.sourceRowCount,
    ]),
    [''],
    ['Totals stated in the source document (listed only — the converter calculates no totals)'],
    ['Table', 'Source reference', 'Label', 'Amount as written'],
    ...drafts.tables.flatMap((t) => t.statedTotals.map((s): Cell[] => [t.name, s.reference, s.label, s.amountText])),
  ];

  // Line Trace
  const trace = plan.rows.map((r): Cell[] => {
    const e = r.view.draft.row.evidence;
    const d = r.view.decision?.record;
    return [
      r.sheetRow, r.table.name, r.view.draft.row.id, refsOf(r.view),
      r.view.draft.descriptionParts.map((p) => (p.source.kind === 'pdf' ? '' : (p.source.cellAddress ?? ''))).join('; '),
      r.values.no, r.values.description, r.values.unit,
      rawText(e.quantity), rawText(e.rate), rawText(e.amount),
      d?.by ?? 'not recorded', d?.at ?? '', d?.note ?? '', d?.acknowledgedWarnings.length ?? 0,
    ];
  });

  // Coverage: every source row of every table, exactly once
  const coverage = drafts.tables.flatMap((t) =>
    t.accounts.map((a): Cell[] => {
      let outcome: string;
      const view = a.draftId ? viewOf.get(a.draftId) : undefined;
      const sheetRow = a.draftId ? exportedRowOf.get(a.draftId) : undefined;
      if (!a.draftId) outcome = 'Not an item row: not exported.';
      else if (sheetRow !== undefined) outcome = a.category === 'continuation' ? `Part of upload workbook row ${sheetRow}.` : `Exported as upload workbook row ${sheetRow}.`;
      else if (view?.effective === 'excluded') outcome = `Excluded from the upload: “${view.decision?.record.note ?? ''}”.`;
      else outcome = 'Not exported: its table is not ready for export.';
      return [t.name, a.reference, a.category, a.rowClass ?? '', a.detail, a.draftId ?? '', outcome];
    }),
  );

  // Excluded Rows: original values kept (negatives keep their sign)
  const excluded = allViews
    .filter((v) => v.effective === 'excluded')
    .map((v): Cell[] => {
      const e = v.draft.row.evidence;
      const n = (f: FieldEvidence) => (hasUsableValue(f) && typeof f.parsed === 'number' ? f.parsed : null);
      const hist = review.history.filter((h) => h.draftRow?.draftId === v.draft.row.id).map((h) => `${h.at} ${h.by ?? 'not recorded'}: ${h.summary}${h.note ? ` “${h.note}”` : ''}`).join(' | ');
      return [refsOf(v), text(e.itemNo), text(e.description), text(e.unit), n(e.quantity), rawText(e.quantity), n(e.rate), rawText(e.rate), n(e.amount), rawText(e.amount), v.decision!.record.note, v.decision!.record.by ?? 'not recorded', v.decision!.record.at, hist];
    });

  // Issues & Resolutions
  const issues = allViews.flatMap((v) =>
    v.draft.row.issues.map((i): Cell[] => {
      const b = v.blocking.find((x) => x.issue.id === i.id);
      const status =
        i.severity !== 'blocking'
          ? v.decision?.record.acknowledgedWarnings.includes(i.id) && !v.decision.outdated ? `Acknowledged at approval: “${v.decision.record.note ?? ''}”` : 'Not acknowledged'
          : b?.resolution && !b.outdated ? `Resolved (${b.resolution.kind}) by ${b.resolution.by ?? 'not recorded'} at ${b.resolution.at}: “${b.resolution.note}”`
          : v.effective === 'excluded' ? 'Unresolved — row excluded from the upload'
          : 'Unresolved';
      return [v.draft.row.item.sourceReference ?? '', v.draft.row.id, i.code, i.severity, i.field ?? '', i.message, status];
    }),
  );

  // Placeholders confirmed as not stated (exported rows)
  const placeholders = plan.rows.flatMap((r) =>
    r.view.blocking
      .filter((b) => b.issue.code === 'REQUIRED_FIELD_NOT_IN_SOURCE' && b.resolution && !b.outdated)
      .map((b): Cell[] => [r.sheetRow, refsOf(r.view), b.issue.field ?? '', figureText(r.view.draft.row.evidence[b.issue.field as 'quantity' | 'rate' | 'amount']), b.resolution!.note, b.resolution!.by ?? 'not recorded', b.resolution!.at, 'Genuinely blank in the upload workbook (not zero, not calculated).']),
  );

  // Import Effects (expected; not confirmed)
  const effects: Cell[][] = [
    ...GENERAL_IMPORT_EFFECTS.map((g): Cell[] => ['(all rows)', '', g.field, g.effect, IMPORT_EFFECT_BASIS]),
    ...plan.rows.flatMap((r) =>
      importEffectsFor(r.values, {
        rateOnlyInDocument: [r.view.draft.row.evidence.quantity, r.view.draft.row.evidence.amount].some((e) => e.special === 'RATE_ONLY'),
        sectionDescription: opt(r.view.draft.row.item.sectionDescription),
      }).map((x): Cell[] => [r.sheetRow, refsOf(r.view), x.field, x.effect, IMPORT_EFFECT_BASIS]),
    ),
  ];

  // Extra Columns
  const extra = allViews.flatMap((v) => v.draft.row.extraColumns.map((x): Cell[] => [refsOf(v), x.columnHeader, rawText(x.evidence), x.evidence.state, exportedRowOf.has(v.draft.row.id) ? 'exported row (column not uploaded)' : v.effective]));

  // Decision History (the whole review history)
  const history = review.history.map((h): Cell[] => [h.sequence, h.at, h.by ?? 'not recorded', h.action, h.proposalId ?? h.draftRow?.draftId ?? '', h.summary, h.note ?? '']);

  // Blocked Tables (not in the upload workbook)
  const blocked = plan.notExported.map(({ table, readiness }): Cell[] => [table.name, table.status, [...table.reasons, ...readiness.notReadyBecause].join(' ') || 'No draft rows.', table.sourceRowCount]);

  const historyNote: Cell[][] = [['Reviewer names are typed in and are not verified identities. The history is append-only through the app but is not tamper-proof.']];
  return writeWorkbook(
    [
      { name: 'Summary', rows: [[RECONCILIATION_BANNER], ...summary], widths: [36, 70, 16, 14, 14, 12] },
      { name: 'Line Trace', rows: sheetWith(['Upload row', 'Table', 'Draft row', 'Source rows', 'Description cells', 'No.', 'Item Description', 'Unit as written', 'Qty as written', 'Rate as written', 'Amount as written', 'Approved by (typed)', 'Approved at', 'Approval note', 'Warnings acknowledged'], trace) },
      { name: 'Coverage', rows: sheetWith(['Table', 'Source row', 'What happened', 'Row type', 'Detail', 'Draft row', 'Outcome'], coverage) },
      { name: 'Excluded Rows', rows: sheetWith(['Source rows', 'No.', 'Item Description', 'Unit as written', 'Qty', 'Qty as written', 'Rate', 'Rate as written', 'Amount', 'Amount as written', 'Reason', 'Excluded by (typed)', 'Excluded at', 'Decision history'], excluded) },
      { name: 'Issues & Resolutions', rows: sheetWith(['Source', 'Draft row', 'Issue', 'Severity', 'Field', 'Message', 'Resolution'], issues) },
      { name: 'Placeholders', rows: sheetWith(['Upload row', 'Source rows', 'Field', 'Document shows', 'Confirmation note', 'Confirmed by (typed)', 'Confirmed at', 'In the upload workbook'], placeholders) },
      { name: 'Import Effects', rows: sheetWith(['Upload row', 'Source rows', 'Field', 'Expected effect of the Cost Library importer', 'Basis'], effects) },
      { name: 'Extra Columns', rows: sheetWith(['Source rows', 'Column', 'Value as written', 'State', 'Row'], extra) },
      { name: 'Decision History', rows: [...sheetWith(['#', 'At', 'By (typed)', 'Action', 'Proposal / draft row', 'Summary', 'Note'], history), [], ...historyNote] },
      { name: 'Blocked Tables', rows: sheetWith(['Table', 'Status', 'Why it is not in the upload workbook', 'Source rows'], blocked) },
    ],
    { title: 'Reconciliation — NOT a Cost Library upload workbook', subject: 'AI BQ Converter reconciliation record', comments: RECONCILIATION_BANNER },
  );
}

// ---------------------------------------------------------------------------------------------
// 4. Read-back checks
// ---------------------------------------------------------------------------------------------

async function readBack(bytes: Uint8Array, fileName: string) {
  return extractSpreadsheetFile({ bytes, fileName, projectId: 'export-check', documentId: 'export-check', uploadedAt: '2000-01-01T00:00:00.000Z', uploadedBy: null, organizationId: null });
}

const cellAt = (table: ExtractedTable, r: number, c: number) => table.rows.find((x) => x.rowIndex === r)?.cells.find((x) => x.columnIndex === c);

/** Reads the upload workbook back and compares every cell with what was meant to be written. */
export async function checkUploadWorkbook(bytes: Uint8Array, rows: readonly ExportRow[]): Promise<string[]> {
  const problems: string[] = [];
  const back = await readBack(bytes, 'upload-check.xlsx');
  const names = back.tables.map((t) => (t.origin.kind === 'worksheet' ? t.origin.sheetName : ''));
  if (names.join('|') !== `${INSTRUCTIONS_SHEET}|${UPLOAD_SHEET}`) problems.push(`Sheets are ${JSON.stringify(names)}, expected ["${INSTRUCTIONS_SHEET}","${UPLOAD_SHEET}"].`);
  for (const t of back.tables) for (const r of t.rows) for (const c of r.cells) if (c.isFormula) problems.push(`A formula was found at ${describeSourceReference(c.source)}.`);
  const instructions = back.tables[0];
  if (!instructions || cellAt(instructions, 0, 0)?.raw !== NOT_VALIDATED) problems.push(`The "${NOT_VALIDATED}" label is missing.`);
  const bq = back.tables[1];
  if (!bq) return [...problems, 'The BQ sheet is missing.'];
  const expected: Cell[][] = [[...UPLOAD_HEADERS], ...rows.map((r) => rowCells(r.values))];
  const lastRow = Math.max(-1, ...bq.rows.filter((r) => r.cells.some((c) => c.raw !== null)).map((r) => r.rowIndex));
  if (lastRow + 1 !== expected.length) problems.push(`The BQ sheet has ${lastRow + 1} rows, expected ${expected.length}.`);
  expected.forEach((row, r) => {
    for (let c = 0; c < UPLOAD_HEADERS.length; c++) {
      const want = row[c] ?? null;
      const cell = cellAt(bq, r, c);
      const got = cell ? cellValueForParsing(cell) : null;
      const where = `BQ row ${r + 1}, column "${UPLOAD_HEADERS[c]}"`;
      if (want === null) {
        if (got !== null && got !== undefined) problems.push(`${where}: should be blank but holds ${JSON.stringify(got)}.`);
      } else if (got !== want) problems.push(`${where}: expected ${JSON.stringify(want)}, found ${JSON.stringify(got ?? null)}.`);
      else if (typeof want === 'string' && cell?.cellType !== 'text') problems.push(`${where}: should be a text cell.`);
    }
    const beyond = bq.rows.find((x) => x.rowIndex === r)?.cells.filter((c) => c.columnIndex >= UPLOAD_HEADERS.length && c.raw !== null) ?? [];
    if (beyond.length) problems.push(`BQ row ${r + 1}: unexpected cells beyond the template columns.`);
  });
  return problems;
}

/** Reads the reconciliation workbook back: every sheet labelled, every source row covered once. */
export async function checkReconciliationWorkbook(bytes: Uint8Array, drafts: DraftResult, exportedRows: number): Promise<string[]> {
  const problems: string[] = [];
  const back = await readBack(bytes, 'reconciliation-check.xlsx');
  const byName = new Map(back.tables.map((t) => [t.origin.kind === 'worksheet' ? t.origin.sheetName : '', t]));
  for (const name of RECONCILIATION_SHEETS) {
    const t = byName.get(name);
    if (!t) problems.push(`Sheet "${name}" is missing.`);
    else if (cellAt(t, 0, 0)?.raw !== RECONCILIATION_BANNER) problems.push(`Sheet "${name}" is not labelled "${RECONCILIATION_BANNER}".`);
  }
  for (const t of back.tables) for (const r of t.rows) for (const c of r.cells) if (c.isFormula) problems.push(`A formula was found at ${describeSourceReference(c.source)}.`);
  const dataRows = (name: string) => (byName.get(name)?.rows.filter((r) => r.rowIndex >= 2 && r.cells.some((c) => c.raw !== null)).length ?? -1);
  const sourceRows = drafts.tables.reduce((n, t) => n + t.sourceRowCount, 0);
  if (dataRows('Coverage') !== sourceRows) problems.push(`Coverage lists ${dataRows('Coverage')} source rows; the source has ${sourceRows}.`);
  const coverage = byName.get('Coverage');
  if (coverage) {
    const keys = coverage.rows.filter((r) => r.rowIndex >= 2).map((r) => `${String(cellAt(coverage, r.rowIndex, 0)?.raw)}|${String(cellAt(coverage, r.rowIndex, 1)?.raw)}`);
    if (new Set(keys).size !== keys.length) problems.push('A source row is listed more than once in Coverage.');
  }
  if (dataRows('Line Trace') !== exportedRows) problems.push(`Line Trace lists ${dataRows('Line Trace')} rows; ${exportedRows} were exported.`);
  return problems;
}

// ---------------------------------------------------------------------------------------------
// 5. The whole export
// ---------------------------------------------------------------------------------------------

export interface ExportFile {
  readonly kind: 'upload' | 'reconciliation';
  readonly fileName: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
}

export type ExportResult =
  | { readonly ok: true; readonly files: readonly [ExportFile, ExportFile]; readonly review: SavedReview; readonly record: ExportRecord }
  | { readonly ok: false; readonly errors: readonly string[] };

export function exportFileNames(sourceFileName: string): { upload: string; reconciliation: string } {
  const base = sourceFileName.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_');
  return { upload: `NOT-VALIDATED_${base}.cost-library-upload.xlsx`, reconciliation: `${base}.reconciliation.xlsx` };
}

/**
 * Checks, writes both workbooks, reads them back and records the export. Any failed check
 * means NO file is produced. Nothing is uploaded anywhere: the caller offers the files as
 * downloads in this browser.
 */
export async function createExport(input: {
  readonly review: SavedReview;
  readonly drafts: DraftResult;
  readonly tables: readonly ExtractedTable[];
  readonly document: SourceDocument;
  readonly at: string;
  readonly by: string | null;
}): Promise<ExportResult> {
  const plan = planExport(input.drafts, input.review, input.tables);
  if (!plan.ok) return plan;
  const names = exportFileNames(input.document.fileName);

  let uploadBytes: Uint8Array;
  try {
    uploadBytes = buildUploadWorkbook(plan.rows, { sourceFile: input.document.fileName, at: input.at });
  } catch (e) {
    return { ok: false, errors: [`The upload workbook could not be written: ${e instanceof Error ? e.message : String(e)}`] };
  }
  const uploadProblems = await checkUploadWorkbook(uploadBytes, plan.rows);
  if (uploadProblems.length) return { ok: false, errors: ['The upload workbook did not match when read back; no file was produced:', ...uploadProblems.slice(0, 20)] };
  const upload: ExportFile = { kind: 'upload', fileName: names.upload, bytes: uploadBytes, sha256: await sha256Hex(uploadBytes) };

  let reconBytes: Uint8Array;
  try {
    reconBytes = buildReconciliationWorkbook(plan, input.drafts, input.review, input.document, { fileName: upload.fileName, sha256: upload.sha256, at: input.at, by: input.by });
  } catch (e) {
    return { ok: false, errors: [`The reconciliation workbook could not be written: ${e instanceof Error ? e.message : String(e)}`] };
  }
  const reconProblems = await checkReconciliationWorkbook(reconBytes, input.drafts, plan.rows.length);
  if (reconProblems.length) return { ok: false, errors: ['The reconciliation workbook did not pass its read-back check; no file was produced:', ...reconProblems.slice(0, 20)] };
  const reconciliation: ExportFile = { kind: 'reconciliation', fileName: names.reconciliation, bytes: reconBytes, sha256: await sha256Hex(reconBytes) };

  const record: ExportRecord = {
    tables: plan.exported.map(({ table }) => ({ tableId: table.tableId, name: table.name, rows: plan.rows.filter((r) => r.table.tableId === table.tableId).length })),
    files: [upload, reconciliation].map((f) => ({ kind: f.kind, fileName: f.fileName, sha256: f.sha256, bytes: f.bytes.length })),
  };
  return { ok: true, files: [upload, reconciliation], review: recordExport(input.review, record, input.at, input.by), record };
}
