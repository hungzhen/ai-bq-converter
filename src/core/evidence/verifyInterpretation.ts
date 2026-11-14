/**
 * INTERPRETATION VERIFIER — checks every answer a provider gives, rule-based or (later) AI.
 *
 * An answer is rejected (blocking) when it:
 *   - is not a proposal (claims to be approved);
 *   - cites no cells, or cites cells / tables / documents that do not exist or are not in the
 *     project or the expected document;
 *   - cites cells that do not cover the decision (e.g. a column decision without a cell in it);
 *   - quotes text that differs from the real cell;
 *   - contains any field the decision type does not have — e.g. an invented quantity, rate,
 *     amount, unit or description;
 *   - has an invalid value (unknown row class, column role, …) or a label that looks like a figure;
 *   - has an impossible confidence, or does not match the provider that produced it.
 * Low confidence, missing reasoning and every AI answer are flagged for a person's attention.
 */
import { BQ_ROW_CLASSES_FOR_CHECKS } from './rowClasses.ts';
import { CLASSIFICATION_FIELDS } from '../models/stagedBQRow.ts';
import { type CellRef, type ExtractedTable, cellText, findCell, findRow, findTable } from '../models/extraction.ts';
import { type ConverterProject, findDocument } from '../models/project.ts';
import { SOURCE_DOCUMENT_TYPES } from '../models/source.ts';
import { normaliseSpacing, parseNumberCell } from '../parsing/numbers.ts';
import {
  COLUMN_ROLES,
  DECISION_KINDS,
  HIERARCHY_LEVELS,
  type Interpretation,
  type ProviderInfo,
  providerStamp,
} from '../../providers/types.ts';
import { type Finding, type VerificationReport, makeReport, stableKey } from './findings.ts';
import { TRADE_SUBTRADES, UNIFIED_TRADE_PACKAGES } from '../../vendor/cost-library/taxonomy.ts';

export interface InterpretationContext {
  readonly project: ConverterProject;
  readonly tables: readonly ExtractedTable[];
  /** The document the decision is about (not used for relationship / claim-match decisions). */
  readonly documentId?: string;
  /** The provider that produced the answer, to check its stamp and kind. */
  readonly provider?: ProviderInfo;
  readonly claimLineIds?: readonly string[];
  readonly bqRowIds?: readonly string[];
}

const TOP_LEVEL_FIELDS = ['decisionKind', 'value', 'confidence', 'evidence', 'quotedText', 'reasoning', 'alternatives', 'method', 'providerId', 'status'];
const ALTERNATIVE_FIELDS = ['value', 'confidence', 'reasoning'];

/** The ONLY fields each decision type may contain. Anything else (e.g. "quantity") is rejected. */
export const ALLOWED_DECISION_FIELDS: Readonly<Record<string, readonly string[]>> = {
  documentType: ['documentType'],
  tableRegion: ['tableId', 'headerRowIndexes', 'repeatedHeaderRowIndexes', 'firstDataRowIndex', 'lastDataRowIndex', 'include'],
  columnRole: ['tableId', 'columnIndex', 'role'],
  rowClass: ['tableId', 'rowIndex', 'rowClass'],
  hierarchy: ['tableId', 'rowIndex', 'level', 'parentRowIndex'],
  classificationSuggestion: ['tableId', 'rowIndex', 'field', 'label'],
  relationship: ['fromDocumentId', 'toDocumentId', 'kind'],
  claimMatch: ['claimLineId', 'bqRowId'],
};

const RELATIONSHIP_KINDS = ['claim_against', 'working_file_of', 'addendum_to', 'supersedes', 'duplicate_of'];

const isIndex = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

export function verifyInterpretation(interpretation: Interpretation, ctx: InterpretationContext): VerificationReport {
  const findings: Finding[] = [];
  const add = (code: Finding['code'], severity: Finding['severity'], message: string, cell?: CellRef) =>
    findings.push({ code, severity, message, ...(cell ? { cell } : {}) });
  const i = interpretation as unknown as Record<string, unknown>;
  const kind = String(i['decisionKind']);
  const subject = `interpretation ${kind}`;

  // ---- Shape ----------------------------------------------------------------------------
  for (const key of Object.keys(i)) {
    if (!TOP_LEVEL_FIELDS.includes(key)) add('UNEXPECTED_FIELD', 'blocking', `Unexpected field "${key}" in the answer.`);
  }
  if (!DECISION_KINDS.includes(kind as never)) {
    add('INVALID_DECISION', 'blocking', `Unknown decision kind "${kind}".`);
    return makeReport(subject, interpretation, findings);
  }
  if (i['status'] !== 'proposed') add('NOT_A_PROPOSAL', 'blocking', 'A provider answer must be a proposal; only a person can approve.');

  const value = (i['value'] ?? {}) as Record<string, unknown>;
  if (typeof i['value'] !== 'object' || i['value'] === null) add('INVALID_DECISION', 'blocking', 'The decision has no value.');
  // ---- Confidence, reasoning, provider ---------------------------------------------------
  const confidence = i['confidence'];
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    add('INVALID_CONFIDENCE', 'blocking', `Confidence must be between 0 and 1 (got ${String(confidence)}).`);
  } else if (confidence < 0.5) {
    add('LOW_CONFIDENCE', 'warning', `Low confidence (${confidence}).`);
  }
  if (typeof i['reasoning'] !== 'string' || i['reasoning'].trim() === '') add('NO_REASONING', 'warning', 'The answer gives no reason.');
  if (ctx.provider) {
    if (i['providerId'] !== providerStamp(ctx.provider) || i['method'] !== ctx.provider.kind) {
      add('PROVIDER_MISMATCH', 'blocking', `The answer is stamped "${String(i['providerId'])}" (${String(i['method'])}) but came from ${providerStamp(ctx.provider)} (${ctx.provider.kind}).`);
    }
  }
  if (i['method'] === 'ai') add('AI_PROPOSAL', 'info', 'AI interpretation: remains a proposal until a person approves it.');

  // ---- Evidence --------------------------------------------------------------------------
  const evidence = Array.isArray(i['evidence']) ? (i['evidence'] as CellRef[]) : [];
  if (evidence.length === 0) add('NO_EVIDENCE', 'blocking', 'The answer cites no cells. Every decision must be based on cited cells.');

  const crossDocument = kind === 'relationship' || kind === 'claimMatch';
  for (const ref of evidence) {
    const table = findTable(ctx.tables, ref.tableId);
    if (!table) {
      add('CITED_TABLE_NOT_FOUND', 'blocking', `Cited table "${ref.tableId}" does not exist.`, ref);
      continue;
    }
    if (!findDocument(ctx.project, table.documentId)) {
      add('CITED_DOCUMENT_NOT_IN_PROJECT', 'blocking', `Cited table "${ref.tableId}" belongs to a document outside the project.`, ref);
    }
    if (!crossDocument && ctx.documentId !== undefined && table.documentId !== ctx.documentId) {
      add('WRONG_DOCUMENT', 'blocking', `Cited table "${ref.tableId}" is in another document.`, ref);
    }
    const row = findRow(table, ref.rowIndex);
    if (!row) {
      add('CITED_CELL_NOT_FOUND', 'blocking', `Cited row ${ref.rowIndex} of table "${ref.tableId}" does not exist.`, ref);
    } else if (ref.columnIndex !== undefined && !findCell(row, ref.columnIndex)) {
      add('CITED_CELL_NOT_FOUND', 'blocking', `Cited cell (row ${ref.rowIndex}, column ${ref.columnIndex}) of table "${ref.tableId}" does not exist.`, ref);
    }
  }

  // ---- Quoted text -----------------------------------------------------------------------
  const quotes = i['quotedText'];
  if (quotes !== undefined) {
    if (!Array.isArray(quotes) || quotes.length !== evidence.length) {
      add('QUOTE_COUNT_MISMATCH', 'blocking', 'There must be exactly one quote per cited cell.');
    } else {
      quotes.forEach((quote: unknown, n) => {
        const ref = evidence[n]!;
        const table = findTable(ctx.tables, ref.tableId);
        const row = table ? findRow(table, ref.rowIndex) : undefined;
        const cell = row && ref.columnIndex !== undefined ? findCell(row, ref.columnIndex) : undefined;
        if (!cell) {
          if (row && ref.columnIndex === undefined) add('QUOTE_MISMATCH', 'blocking', 'A quote must cite a single cell, not a whole row.', ref);
          return;
        }
        const actual = cellText(cell);
        if (typeof quote !== 'string' || normaliseSpacing(quote) !== normaliseSpacing(actual)) {
          add('QUOTE_MISMATCH', 'blocking', `Quoted ${JSON.stringify(quote)} but the cell holds ${JSON.stringify(actual)}.`, ref);
        } else if (quote !== actual) {
          add('QUOTE_SPACING_DIFFERS', 'info', 'The quote matches the cell apart from spacing.', ref);
        }
      });
    }
  }

  // ---- The decision itself ---------------------------------------------------------------
  const cites = (pred: (r: CellRef) => boolean) => evidence.some(pred);
  const tableOf = (tableId: unknown) => (typeof tableId === 'string' ? findTable(ctx.tables, tableId) : undefined);

  type Add = (code: Finding['code'], severity: Finding['severity'], message: string) => void;
  /** Checks one decision value (the main answer, or an alternative). */
  const checkDecision = (value: Record<string, unknown>, addD: Add) => {
    const needRow = (tableId: unknown, rowIndex: unknown, label: string) => {
      const table = tableOf(tableId);
      if (!table) return addD('INVALID_DECISION', 'blocking', `${label}: table "${String(tableId)}" does not exist.`);
      if (!isIndex(rowIndex) || !findRow(table, rowIndex)) return addD('INVALID_DECISION', 'blocking', `${label}: row ${String(rowIndex)} does not exist.`);
      if (!cites((r) => r.tableId === tableId && r.rowIndex === rowIndex)) {
        addD('EVIDENCE_DOES_NOT_COVER_DECISION', 'blocking', `${label}: the decision is about row ${rowIndex} but that row is not cited.`);
      }
    };
    for (const key of Object.keys(value)) {
      if (!ALLOWED_DECISION_FIELDS[kind]!.includes(key)) {
        addD('UNEXPECTED_FIELD', 'blocking', `A ${kind} decision may not contain "${key}". Providers never supply figures, units or descriptions.`);
      }
    }
  switch (kind) {
    case 'documentType':
      if (!SOURCE_DOCUMENT_TYPES.includes(value['documentType'] as never)) addD('INVALID_DECISION', 'blocking', `Unknown document type "${String(value['documentType'])}".`);
      break;
    case 'tableRegion': {
      const table = tableOf(value['tableId']);
      if (!table) {
        addD('INVALID_DECISION', 'blocking', `Table "${String(value['tableId'])}" does not exist.`);
        break;
      }
      const first = value['firstDataRowIndex'];
      const last = value['lastDataRowIndex'];
      const headers = value['headerRowIndexes'];
      if (!isIndex(first) || !isIndex(last) || first > last || !findRow(table, first) || !findRow(table, last)) {
        addD('INVALID_DECISION', 'blocking', 'The data range does not fit the table.');
      }
      if (!Array.isArray(headers) || !headers.every((h) => isIndex(h) && findRow(table, h))) addD('INVALID_DECISION', 'blocking', 'Header rows must be rows of the table.');
      else if (!headers.every((h) => cites((r) => r.tableId === table.id && r.rowIndex === h))) addD('EVIDENCE_DOES_NOT_COVER_DECISION', 'blocking', 'Every header row must be cited.');
      const repeated = value['repeatedHeaderRowIndexes'];
      const lastHeader = Array.isArray(headers) && headers.length ? Math.max(...(headers as number[])) : -1;
      if (!Array.isArray(repeated) || !repeated.every((h) => isIndex(h) && findRow(table, h) && h > lastHeader)) {
        addD('INVALID_DECISION', 'blocking', 'Repeated header rows must be rows of the table after the first header.');
      } else if (!repeated.every((h) => cites((r) => r.tableId === table.id && r.rowIndex === h))) {
        addD('EVIDENCE_DOES_NOT_COVER_DECISION', 'blocking', 'Every repeated header row must be cited.');
      }
      if (typeof value['include'] !== 'boolean') addD('INVALID_DECISION', 'blocking', '"include" must be true or false.');
      break;
    }
    case 'columnRole': {
      if (!COLUMN_ROLES.includes(value['role'] as never)) addD('INVALID_DECISION', 'blocking', `Unknown column role "${String(value['role'])}".`);
      const table = tableOf(value['tableId']);
      const col = value['columnIndex'];
      if (!table || !isIndex(col) || !table.rows.some((r) => findCell(r, col))) {
        addD('INVALID_DECISION', 'blocking', 'The column does not exist in the table.');
      } else if (!cites((r) => r.tableId === table.id && r.columnIndex === col)) {
        addD('EVIDENCE_DOES_NOT_COVER_DECISION', 'blocking', `The decision is about column ${col} but no cell of that column is cited.`);
      }
      break;
    }
    case 'rowClass':
      if (!BQ_ROW_CLASSES_FOR_CHECKS.includes(value['rowClass'] as never)) addD('INVALID_DECISION', 'blocking', `Unknown row class "${String(value['rowClass'])}".`);
      needRow(value['tableId'], value['rowIndex'], 'Row class');
      break;
    case 'hierarchy': {
      if (!HIERARCHY_LEVELS.includes(value['level'] as never)) addD('INVALID_DECISION', 'blocking', `Unknown level "${String(value['level'])}".`);
      needRow(value['tableId'], value['rowIndex'], 'Hierarchy');
      const parent = value['parentRowIndex'];
      const table = tableOf(value['tableId']);
      if (parent !== null && (!isIndex(parent) || !table || !findRow(table, parent) || !isIndex(value['rowIndex']) || parent >= value['rowIndex'])) {
        addD('INVALID_DECISION', 'blocking', 'The parent must be an earlier row of the same table, or none.');
      }
      break;
    }
    case 'classificationSuggestion': {
      if (!CLASSIFICATION_FIELDS.includes(value['field'] as never)) addD('INVALID_DECISION', 'blocking', `"${String(value['field'])}" is not a classification field.`);
      const label = value['label'];
      if (typeof label !== 'string' || label.trim() === '' || label.length > 80) {
        addD('INVALID_DECISION', 'blocking', 'A classification label must be short, non-empty text.');
      } else {
        const asNumber = parseNumberCell(label, 'money', { sources: [], method: 'user_entered', verification: 'user_confirmed' });
        if (asNumber.evidence.state === 'value' || asNumber.evidence.state === 'zero' || asNumber.detail.candidates.length > 0) {
          addD('LABEL_LOOKS_LIKE_FIGURE', 'blocking', `The label "${label}" looks like a figure. Providers never supply figures.`);
        }
        if (value['field'] === 'tradeWork' && !UNIFIED_TRADE_PACKAGES.some((t) => t.id === label)) {
          addD('INVALID_DECISION', 'blocking', `"${label}" is not one of the Cost Library's trade packages.`);
        }
        if (value['field'] === 'subTrade' && !Object.values(TRADE_SUBTRADES).some((list) => list.includes(label))) {
          addD('INVALID_DECISION', 'blocking', `"${label}" is not one of the Cost Library's sub-trades.`);
        }
      }
      needRow(value['tableId'], value['rowIndex'], 'Classification');
      break;
    }
    case 'relationship': {
      const from = value['fromDocumentId'];
      const to = value['toDocumentId'];
      if (typeof from !== 'string' || !findDocument(ctx.project, from) || typeof to !== 'string' || !findDocument(ctx.project, to) || from === to) {
        addD('INVALID_DECISION', 'blocking', 'A relationship must link two different documents of the project.');
      }
      if (!RELATIONSHIP_KINDS.includes(String(value['kind']))) addD('INVALID_DECISION', 'blocking', `Unknown relationship "${String(value['kind'])}".`);
      break;
    }
    case 'claimMatch': {
      const claimId = value['claimLineId'];
      const bqId = value['bqRowId'];
      if (typeof claimId !== 'string' || typeof bqId !== 'string') {
        addD('INVALID_DECISION', 'blocking', 'A claim match needs a claim line id and a BQ row id.');
      } else if (!ctx.claimLineIds || !ctx.bqRowIds) {
        addD('CANNOT_CHECK', 'warning', 'The claim line and BQ row could not be checked (no lists given).');
      } else {
        if (!ctx.claimLineIds.includes(claimId)) addD('INVALID_DECISION', 'blocking', `Claim line "${claimId}" does not exist.`);
        if (!ctx.bqRowIds.includes(bqId)) addD('INVALID_DECISION', 'blocking', `BQ row "${bqId}" does not exist.`);
      }
      break;
    }
  }

  };

  checkDecision(value, (code, severity, message) => add(code, severity, message));

  // ---- Alternatives (ambiguous evidence) ---------------------------------------------------
  const alternatives = i['alternatives'];
  if (alternatives !== undefined) {
    if (!Array.isArray(alternatives)) {
      add('INVALID_DECISION', 'blocking', '"alternatives" must be a list.');
    } else {
      const seen = new Set<string>([stableKey(value)]);
      alternatives.forEach((alt: unknown, n) => {
        const label = `Alternative ${n + 1}`;
        const addAlt: Add = (code, severity, message) => add(code, severity, `${label}: ${message}`);
        if (typeof alt !== 'object' || alt === null) return addAlt('INVALID_DECISION', 'blocking', 'must be an object.');
        const a = alt as Record<string, unknown>;
        for (const key of Object.keys(a)) if (!ALTERNATIVE_FIELDS.includes(key)) addAlt('UNEXPECTED_FIELD', 'blocking', `unexpected field "${key}".`);
        const c = a['confidence'];
        if (typeof c !== 'number' || !Number.isFinite(c) || c < 0 || c > 1) addAlt('INVALID_CONFIDENCE', 'blocking', `confidence must be between 0 and 1 (got ${String(c)}).`);
        if (typeof a['reasoning'] !== 'string' || a['reasoning'].trim() === '') addAlt('NO_REASONING', 'warning', 'gives no reason.');
        if (typeof a['value'] !== 'object' || a['value'] === null) return addAlt('INVALID_DECISION', 'blocking', 'has no value.');
        const key = stableKey(a['value']);
        if (seen.has(key)) addAlt('INVALID_DECISION', 'blocking', 'repeats the main answer or another alternative.');
        seen.add(key);
        checkDecision(a['value'] as Record<string, unknown>, addAlt);
      });
    }
  }

  return makeReport(subject, interpretation, findings);
}
