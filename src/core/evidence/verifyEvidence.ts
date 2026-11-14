/**
 * EVIDENCE VERIFIER — checks that values are traceable and unaltered.
 *
 * For each piece of FieldEvidence it checks:
 *   1. the evidence is internally consistent (Stage 2C rules);
 *   2. every cited source belongs to this project and to the expected document;
 *   3. the cited cell really exists in the extracted tables;
 *   4. the raw value recorded is EXACTLY the value in that cell (not altered);
 *   5. re-reading the cell with the Stage 2D parser gives the same state, value and marker;
 *   6. and it flags missing, blank, ambiguous, unparseable, conflicting, negative,
 *      low-OCR-confidence and derived values for a person's attention.
 *
 * It returns a report and changes nothing. It never approves, corrects or fills in a value.
 */
import { type FieldEvidence, isNegative, validateFieldEvidence } from '../models/evidence.ts';
import { type ExtractedTable, findCellBySource, findRowBySource } from '../models/extraction.ts';
import { type ProgressClaimRecord } from '../models/progressClaim.ts';
import { type ConverterProject, checkReferencesBelongToProject, findDocument } from '../models/project.ts';
import { type StagedBQRow, checkStagedRowIntegrity, unresolvedBlockingIssues } from '../models/stagedBQRow.ts';
import { type SourceReference, describeSourceReference } from '../models/source.ts';
import { type NumericFieldKind, parseNumberCell } from '../parsing/numbers.ts';
import { parseTextCell, parseUnitCell } from '../parsing/text.ts';
import { type Finding, type VerificationReport, makeReport } from './findings.ts';

/** How a field's cell should be read when re-checking it. null = only check source and raw value. */
export type FieldExpectation = { readonly valueType: 'number'; readonly kind: NumericFieldKind } | { readonly valueType: 'text' } | { readonly valueType: 'unit' } | null;

export interface VerificationContext {
  readonly project: ConverterProject;
  /** The document the evidence must come from. */
  readonly documentId: string;
  /** The extracted tables of that document (the "original" to compare against). */
  readonly tables: readonly ExtractedTable[];
  /** OCR values below this confidence (0–100) are flagged. Default 80. */
  readonly ocrConfidenceThreshold?: number;
  /** Ids of BQ rows that exist (to check claim links). */
  readonly bqRowIds?: readonly string[];
}

const DOCUMENT_METHODS = new Set(['spreadsheet_cell', 'csv_cell', 'pdf_text_layer', 'pdf_ocr']);

const show = (v: unknown) => (typeof v === 'string' ? JSON.stringify(v) : String(v));

function reread(raw: FieldEvidence['raw'], e: FieldEvidence, expectation: NonNullable<FieldExpectation>, displayText: string | null) {
  const origin = { sources: e.sources, method: e.method };
  const options = displayText !== null ? { displayText } : {};
  if (expectation.valueType === 'number') {
    const r = parseNumberCell(raw, expectation.kind, origin, options);
    return { evidence: r.evidence as FieldEvidence, candidates: r.detail.candidates };
  }
  if (expectation.valueType === 'unit') return { evidence: parseUnitCell(raw, origin).evidence as FieldEvidence, candidates: [] };
  return { evidence: parseTextCell(raw, origin, options) as FieldEvidence, candidates: [] };
}

function checkSources(field: string, sources: readonly SourceReference[], ctx: VerificationContext): Finding[] {
  const out: Finding[] = [];
  for (const problem of checkReferencesBelongToProject(ctx.project, sources)) {
    out.push({ code: 'SOURCE_NOT_IN_PROJECT', severity: 'blocking', field, message: problem });
  }
  for (const s of sources) {
    if (s.documentId !== ctx.documentId) {
      out.push({ code: 'WRONG_DOCUMENT', severity: 'blocking', field, source: s, message: `${field}: the source is in "${s.fileName}", not in the expected document.` });
    }
    if (s.kind === 'pdf' && s.extraction === 'ocr') {
      const threshold = ctx.ocrConfidenceThreshold ?? 80;
      if (s.ocrConfidence === undefined) {
        out.push({ code: 'OCR_CONFIDENCE_UNKNOWN', severity: 'warning', field, source: s, message: `${field}: read by OCR with no confidence recorded.` });
      } else if (s.ocrConfidence < threshold) {
        out.push({ code: 'LOW_OCR_CONFIDENCE', severity: 'warning', field, source: s, message: `${field}: OCR confidence ${s.ocrConfidence}% is below ${threshold}%.` });
      }
    }
  }
  return out;
}

/** Verifies one piece of evidence. Returns findings only; changes nothing. */
export function verifyFieldEvidence(field: string, e: FieldEvidence, expectation: FieldExpectation, ctx: VerificationContext): Finding[] {
  const out: Finding[] = [];

  // 1. Internal consistency (re-check; evidence could have been altered after creation).
  const inconsistent = validateQuietly(e);
  for (const problem of inconsistent) out.push({ code: 'INCONSISTENT_EVIDENCE', severity: 'blocking', field, message: `${field}: ${problem}` });
  if (inconsistent.length) return out;

  if (e.verification === 'rejected') out.push({ code: 'REJECTED_EVIDENCE', severity: 'blocking', field, message: `${field}: a person rejected this value.` });

  // 2. Sources belong to the project and the expected document.
  out.push(...checkSources(field, e.sources, ctx));

  // 3–5. Cell exists, raw value unaltered, re-reading gives the same result.
  if (DOCUMENT_METHODS.has(e.method)) {
    if (e.sources.length > 1) {
      for (const s of e.sources) {
        if (!findCellBySource(ctx.tables, s) && !findRowBySource(ctx.tables, s)) {
          out.push({ code: 'SOURCE_CELL_NOT_FOUND', severity: 'blocking', field, source: s, message: `${field}: ${describeSourceReference(s)} does not exist in the extracted document.` });
        }
      }
      out.push({ code: 'COMBINED_VALUE', severity: 'info', field, message: `${field}: combined from ${e.sources.length} cells; each cell was checked to exist.` });
    } else {
      const source = e.sources[0]!;
      const cell = findCellBySource(ctx.tables, source);
      const where = describeSourceReference(source);
      if (e.state === 'missing') {
        if (cell?.formulaResultMissing) {
          // Correct: the cell has a formula but the file holds no result, so the value is missing.
          out.push({ code: 'FORMULA_RESULT_MISSING', severity: 'warning', field, source, message: `${field}: ${where} has the formula "=${cell.formula ?? ''}" but no calculated result in the file. Nothing is assumed.` });
        } else if (cell) {
          out.push({ code: 'CONFLICTING_EVIDENCE', severity: 'blocking', field, source, message: `${field}: recorded as missing, but ${where} exists and holds ${show(cell.raw)}.` });
        }
      } else if (cell?.formulaResultMissing) {
        out.push({ code: 'CONFLICTING_EVIDENCE', severity: 'blocking', field, source, message: `${field}: recorded as ${e.state}, but ${where} is a formula with no calculated result in the file — the value is missing, not ${e.state}.` });
      } else if (!cell) {
        out.push({ code: 'SOURCE_CELL_NOT_FOUND', severity: 'blocking', field, source, message: `${field}: ${where} does not exist in the extracted document.` });
      } else {
        if (cell.isFormula) {
          out.push({ code: 'FORMULA_RESULT', severity: 'warning', field, source, message: `${field}: ${where} is the cached result of the formula "=${cell.formula ?? ''}"; the formula was not recalculated.` });
        }
        if (!Object.is(cell.raw, e.raw)) {
          out.push({ code: 'RAW_TEXT_ALTERED', severity: 'blocking', field, source, message: `${field}: the recorded raw value ${show(e.raw)} differs from the cell's ${show(cell.raw)} at ${where}.` });
        } else if (expectation) {
          const again = reread(cell.raw, e, expectation, cell.displayText);
          const same = again.evidence.state === e.state && Object.is(again.evidence.parsed, e.parsed) && again.evidence.special === e.special;
          if (!same) {
            out.push({
              code: 'PARSED_VALUE_MISMATCH', severity: 'blocking', field, source,
              message: `${field}: recorded as ${e.state} ${show(e.parsed)}, but re-reading ${show(cell.raw)} gives ${again.evidence.state} ${show(again.evidence.parsed)}.`,
            });
          }
          if (again.candidates.length > 0) {
            out.push({ code: 'AMBIGUOUS_VALUE', severity: 'warning', field, source, candidates: again.candidates, message: `${field}: ${show(cell.raw)} is ambiguous; possible readings are listed for a person to choose.` });
          }
        }
      }
    }
  } else if (e.method === 'derived_by_rule') {
    for (const s of e.sources) {
      if (!findCellBySource(ctx.tables, s) && !findRowBySource(ctx.tables, s)) {
        out.push({ code: 'SOURCE_CELL_NOT_FOUND', severity: 'blocking', field, source: s, message: `${field}: ${describeSourceReference(s)} does not exist in the extracted document.` });
      }
    }
    out.push({ code: 'DERIVED_VALUE_NEEDS_REVIEW', severity: 'warning', field, message: `${field}: worked out by rule "${e.derivation?.rule}", not read from the document.` });
  } else if (e.method === 'user_entered') {
    out.push({ code: 'USER_ENTERED', severity: 'info', field, message: `${field}: entered or approved by a person, not read from the document.` });
  }

  // 6. Flags for a person's attention.
  if (e.state === 'missing') out.push({ code: 'MISSING_VALUE', severity: 'warning', field, message: `${field}: could not be read from the document.` });
  if (e.state === 'unparseable') out.push({ code: 'UNPARSEABLE_VALUE', severity: 'warning', field, message: `${field}: ${show(e.raw)} could not be understood.` });
  if (e.state === 'blank') out.push({ code: 'BLANK_VALUE', severity: 'info', field, message: `${field}: left blank in the document.` });
  if (e.state === 'not_stated') out.push({ code: 'NOT_STATED', severity: 'info', field, message: `${field}: not stated in the document.` });
  if (e.state === 'special') out.push({ code: 'SPECIAL_MARKER', severity: 'info', field, message: `${field}: marker ${show(e.raw)} (${e.special}), no figure.` });
  if (isNegative(e)) out.push({ code: 'NEGATIVE_VALUE', severity: 'warning', field, message: `${field}: negative value ${show(e.raw)}.` });
  return out;
}

function validateQuietly(e: FieldEvidence): string[] {
  try {
    return validateFieldEvidence(e);
  } catch {
    return ['The evidence record is malformed.'];
  }
}

// ---------------------------------------------------------------------------------------------
// Whole records
// ---------------------------------------------------------------------------------------------

const MONEY: FieldExpectation = { valueType: 'number', kind: 'money' };
const QUANTITY: FieldExpectation = { valueType: 'number', kind: 'quantity' };
const PERCENT: FieldExpectation = { valueType: 'number', kind: 'percent' };
const TEXT: FieldExpectation = { valueType: 'text' };
const UNIT: FieldExpectation = { valueType: 'unit' };

/** How each StagedBQRow evidence field is read. Fields not listed are checked for source and raw value only. */
export const STAGED_ROW_EXPECTATIONS: Readonly<Record<string, FieldExpectation>> = {
  description: TEXT, unit: UNIT, quantity: QUANTITY, rate: MONEY, amount: MONEY,
  billNo: TEXT, billDescription: TEXT, sectionNo: TEXT, sectionDescription: TEXT, itemNo: TEXT, originalItemNo: TEXT,
  mainHeading: TEXT, subheading: TEXT, secondarySubheading: TEXT, parentSpecDescription: TEXT, specification: TEXT, notes: TEXT,
  baseRate: MONEY, baseAmount: MONEY, tenderRate: MONEY, tenderAmount: MONEY, rateAfterDiscount: MONEY, profitPercent: PERCENT,
};

function documentChecks(subjectProjectId: string, documentId: string, ctx: VerificationContext): Finding[] {
  const out: Finding[] = [];
  if (subjectProjectId !== ctx.project.id) out.push({ code: 'WRONG_PROJECT', severity: 'blocking', message: `Belongs to project "${subjectProjectId}", not "${ctx.project.id}".` });
  if (!findDocument(ctx.project, documentId)) out.push({ code: 'SOURCE_NOT_IN_PROJECT', severity: 'blocking', message: `Document "${documentId}" is not in the project.` });
  if (documentId !== ctx.documentId) out.push({ code: 'WRONG_DOCUMENT', severity: 'blocking', message: `Comes from document "${documentId}", not the expected "${ctx.documentId}".` });
  return out;
}

function rowSourceChecks(sources: readonly SourceReference[], ctx: VerificationContext): Finding[] {
  const out = checkSources('row', sources, ctx);
  for (const s of sources) {
    if (!findRowBySource(ctx.tables, s) && !findCellBySource(ctx.tables, s)) {
      out.push({ code: 'SOURCE_ROW_NOT_FOUND', severity: 'blocking', source: s, message: `${describeSourceReference(s)} does not exist in the extracted document.` });
    }
  }
  return out;
}

/** Verifies a whole staged BQ row: its sources, its integrity and every piece of evidence. */
export function verifyStagedBQRow(row: StagedBQRow, ctx: VerificationContext): VerificationReport {
  const findings: Finding[] = [
    ...documentChecks(row.projectId, row.documentId, ctx),
    ...rowSourceChecks(row.sources, ctx),
    ...checkStagedRowIntegrity(row).map((p): Finding => ({ code: 'INTEGRITY_PROBLEM', severity: 'blocking', message: p })),
  ];
  if (row.review.status === 'approved' && unresolvedBlockingIssues(row).length > 0) {
    findings.push({ code: 'APPROVED_WITH_BLOCKING_ISSUES', severity: 'blocking', message: 'The row is marked approved while blocking issues are unresolved.' });
  }
  for (const [field, e] of Object.entries(row.evidence) as [string, FieldEvidence | undefined][]) {
    if (e) findings.push(...verifyFieldEvidence(field, e, STAGED_ROW_EXPECTATIONS[field] ?? null, ctx));
  }
  for (const x of row.extraColumns) findings.push(...verifyFieldEvidence(`extra:${x.columnHeader}`, x.evidence, null, ctx));
  return makeReport(`row ${row.id}`, row, findings);
}

/** Verifies a progress claim line: its sources, its link and every piece of evidence. */
export function verifyProgressClaimRecord(claim: ProgressClaimRecord, ctx: VerificationContext): VerificationReport {
  const findings: Finding[] = [...documentChecks(claim.projectId, claim.sourceDocumentId, ctx), ...rowSourceChecks(claim.sources, ctx)];
  const entries: [string, FieldEvidence, FieldExpectation][] = [
    ['asWritten.itemNo', claim.asWritten.itemNo, TEXT],
    ['asWritten.description', claim.asWritten.description, TEXT],
    ['asWritten.unit', claim.asWritten.unit, UNIT],
    ['contractFiguresInClaim.quantity', claim.contractFiguresInClaim.quantity, QUANTITY],
    ['contractFiguresInClaim.rate', claim.contractFiguresInClaim.rate, MONEY],
    ['contractFiguresInClaim.amount', claim.contractFiguresInClaim.amount, MONEY],
  ];
  const groups: [string, ProgressClaimRecord['claimedQuantity'], FieldExpectation][] = [
    ['claimedQuantity', claim.claimedQuantity, QUANTITY],
    ['claimedAmount', claim.claimedAmount, MONEY],
    ['percentComplete', claim.percentComplete, PERCENT],
    ['certifiedQuantity', claim.certifiedQuantity, QUANTITY],
    ['certifiedAmount', claim.certifiedAmount, MONEY],
  ];
  for (const [name, p, exp] of groups) {
    entries.push([`${name}.previous`, p.previous, exp], [`${name}.current`, p.current, exp], [`${name}.cumulative`, p.cumulative, exp]);
  }
  for (const [field, e, exp] of entries) findings.push(...verifyFieldEvidence(field, e, exp, ctx));

  if (claim.bqLink.bqRowId !== null) {
    if (!ctx.bqRowIds) {
      findings.push({ code: 'CANNOT_CHECK', severity: 'warning', message: 'The linked BQ row could not be checked (no BQ row list given).' });
    } else if (!ctx.bqRowIds.includes(claim.bqLink.bqRowId)) {
      findings.push({ code: 'LINKED_BQ_ROW_NOT_FOUND', severity: 'blocking', message: `The linked BQ row "${claim.bqLink.bqRowId}" does not exist.` });
    }
  }
  return makeReport(`claim line ${claim.id}`, claim, findings);
}

