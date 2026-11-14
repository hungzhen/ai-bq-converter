/**
 * Stage 2E — evidence verifier: clean, invalid and tampered evidence.
 * SYNTHETIC — NOT REAL COST DATA.
 */
import { describe, expect, it } from 'vitest';
import {
  type FieldEvidence,
  type StagedBQRow,
  createCsvReference,
  createPdfReference,
  createProgressClaimRecord,
  createSourceDocument,
  createStagedBQRow,
  createWorksheetReference,
  derivedEvidence,
  missingEvidence,
  notStatedEvidence,
  numberEvidence,
  resolveIssue,
  setReviewStatus,
  textEvidence,
  userEnteredEvidence,
} from '../../../src/core/models/index.ts';
import { type VerificationContext, verifyFieldEvidence, verifyProgressClaimRecord, verifyStagedBQRow } from '../../../src/core/evidence/index.ts';
import { parseNumberCell, parseTextCell, parseUnitCell } from '../../../src/core/parsing/index.ts';
import { BQ_CSV, BQ_XLSX, CLAIM_PDF, NOW, REVIEWER, TODAY, syntheticPricedRow, syntheticProject } from '../../helpers/synthetic/models.ts';
import { ALL_TABLES, BILL_TABLE, CLAIM_TABLE, billCell, claimCell, claimRow } from '../../helpers/synthetic/tables.ts';

const project = syntheticProject();
const bqCtx: VerificationContext = { project, documentId: BQ_XLSX.id, tables: [BILL_TABLE] };
const at = (row: number, col: number) => ({ sources: [billCell(row, col)], method: 'spreadsheet_cell' as const });
const codes = (findings: readonly { code: string }[]) => findings.map((f) => f.code);
const blocking = (findings: readonly { severity: string; code: string }[]) => findings.filter((f) => f.severity === 'blocking').map((f) => f.code);
const QTY = { valueType: 'number', kind: 'quantity' } as const;
const MONEY = { valueType: 'number', kind: 'money' } as const;

/** A staged row built by parsing the synthetic table's cells, the way Stage 3 will. */
function rowFromTable(rowNumber: number): StagedBQRow {
  const cells = BILL_TABLE.rows.find((r) => r.source.kind === 'worksheet' && r.source.rowNumber === rowNumber)!.cells;
  const raw = (col: number) => cells.find((c) => c.columnIndex === col - 1)?.raw;
  return createStagedBQRow({
    id: `row-${rowNumber}`, project, documentId: BQ_XLSX.id, rowClass: 'priced_item', sequence: rowNumber, today: TODAY,
    sources: [createWorksheetReference(BQ_XLSX, { sheetName: 'Bill 1', sheetIndex: 0, rowNumber })],
    evidence: {
      itemNo: parseTextCell(raw(1), at(rowNumber, 1)),
      description: parseTextCell(raw(2), at(rowNumber, 2)),
      unit: parseUnitCell(raw(3), at(rowNumber, 3)).evidence,
      quantity: parseNumberCell(raw(4), 'quantity', at(rowNumber, 4)).evidence,
      rate: parseNumberCell(raw(5), 'money', at(rowNumber, 5)).evidence,
      amount: parseNumberCell(raw(6), 'money', at(rowNumber, 6)).evidence,
    },
  });
}

/** A writable copy for tampering (records themselves are frozen). */
const tamper = <T>(v: T) => structuredClone(v) as { -readonly [K in keyof T]: T[K] } & Record<string, unknown>;

describe('clean evidence passes', () => {
  it('the synthetic priced row: every value traced to an unaltered cell, no blocking or warning findings', () => {
    const report = verifyStagedBQRow(syntheticPricedRow(10), bqCtx);
    expect(report.ok).toBe(true);
    expect(report.findings.filter((f) => f.severity !== 'info')).toEqual([]);
    expect(codes(report.findings)).toEqual(['USER_ENTERED']); // project year: entered by a person
  });

  it('rows built from the table pass, with their questionable values flagged — not corrected', () => {
    const lumpSum = verifyStagedBQRow(rowFromTable(11), bqCtx);
    expect(lumpSum.ok).toBe(true);
    expect(codes(lumpSum.findings)).toEqual(expect.arrayContaining(['BLANK_VALUE']));

    const negative = verifyStagedBQRow(rowFromTable(12), bqCtx);
    expect(negative.ok).toBe(true);
    expect(codes(negative.findings).filter((c) => c === 'NEGATIVE_VALUE')).toHaveLength(2);

    const ambiguous = verifyStagedBQRow(rowFromTable(13), bqCtx);
    expect(ambiguous.ok).toBe(true);
    const amb = ambiguous.findings.find((f) => f.code === 'AMBIGUOUS_VALUE')!;
    expect(amb.field).toBe('quantity');
    expect(amb.candidates?.map((c) => c.value)).toEqual([1.25]);
    expect(codes(ambiguous.findings)).toEqual(expect.arrayContaining(['UNPARSEABLE_VALUE', 'MISSING_VALUE']));
    expect(ambiguous.findings.filter((f) => f.severity === 'warning').length).toBeGreaterThanOrEqual(3);
  });

  it('a value entered by a person is reported as such, never as document data', () => {
    expect(codes(verifyFieldEvidence('projectYear', userEnteredEvidence('2000 Q1'), null, bqCtx))).toEqual(['USER_ENTERED']);
  });

  it('"not stated" is reported for information', () => {
    expect(codes(verifyFieldEvidence('rate', notStatedEvidence(), MONEY, bqCtx))).toEqual(['NOT_STATED']);
  });
});

describe('tampered evidence is caught', () => {
  it('raw text altered after reading', () => {
    const e = tamper(numberEvidence(10, 10, at(10, 4)));
    e.raw = '100';
    e.parsed = 100;
    expect(blocking(verifyFieldEvidence('quantity', e as FieldEvidence, QTY, bqCtx))).toEqual(['RAW_TEXT_ALTERED']);
  });

  it('parsed value changed while the raw value stayed the same', () => {
    const e = tamper(numberEvidence(10, 10, at(10, 4)));
    e.parsed = 11;
    expect(blocking(verifyFieldEvidence('quantity', e as FieldEvidence, QTY, bqCtx))).toEqual(['PARSED_VALUE_MISMATCH']);
  });

  it('an ambiguous cell recorded as if it were a clean number', () => {
    const e = { state: 'value', raw: '1,25', parsed: 125, sources: [billCell(13, 4)], method: 'spreadsheet_cell', verification: 'unverified' } as FieldEvidence;
    expect(blocking(verifyFieldEvidence('quantity', e, QTY, bqCtx))).toEqual(['PARSED_VALUE_MISMATCH']);
  });

  it('a blank cell recorded as zero', () => {
    const blankAsZero = { state: 'zero', raw: null, parsed: 0, sources: [billCell(11, 4)], method: 'spreadsheet_cell', verification: 'unverified' } as FieldEvidence;
    expect(blocking(verifyFieldEvidence('quantity', blankAsZero, QTY, bqCtx))).toEqual(['PARSED_VALUE_MISMATCH']);
  });

  it('a lump-sum unit turned into a quantity of 1', () => {
    const e = { state: 'value', raw: null, parsed: 1, sources: [billCell(11, 4)], method: 'spreadsheet_cell', verification: 'unverified' } as FieldEvidence;
    expect(blocking(verifyFieldEvidence('quantity', e, QTY, bqCtx))).toEqual(['PARSED_VALUE_MISMATCH']);
  });

  it('a citation to a cell that does not exist', () => {
    expect(blocking(verifyFieldEvidence('quantity', numberEvidence(10, 10, at(99, 4)), QTY, bqCtx))).toEqual(['SOURCE_CELL_NOT_FOUND']);
  });

  it('"missing" recorded for a cell that actually exists', () => {
    const e = missingEvidence<number>({ ...at(10, 4), note: 'claimed missing' });
    expect(blocking(verifyFieldEvidence('quantity', e, QTY, bqCtx))).toEqual(['CONFLICTING_EVIDENCE']);
  });

  it('a citation into a file of another project', () => {
    const foreign = createSourceDocument({ ...BQ_XLSX, id: 'doc-foreign', projectId: 'other', fileName: 'FOREIGN.xlsx', sha256: 'f'.repeat(64) });
    const ref = createWorksheetReference(foreign, { sheetName: 'Bill 1', sheetIndex: 0, rowNumber: 10, columnNumber: 4 });
    expect(blocking(verifyFieldEvidence('quantity', numberEvidence(10, 10, { sources: [ref], method: 'spreadsheet_cell' }), QTY, bqCtx))).toEqual(
      expect.arrayContaining(['SOURCE_NOT_IN_PROJECT', 'WRONG_DOCUMENT']),
    );
  });

  it('a citation into another document of the same project', () => {
    const ref = createCsvReference(BQ_CSV, { rowNumber: 10, columnNumber: 4 });
    expect(blocking(verifyFieldEvidence('quantity', numberEvidence(10, 10, { sources: [ref], method: 'csv_cell' }), QTY, bqCtx))).toEqual(
      expect.arrayContaining(['WRONG_DOCUMENT']),
    );
  });

  it('a renamed file in the citation', () => {
    const e = tamper(numberEvidence(10, 10, at(10, 4)));
    (e.sources as unknown as Record<string, unknown>[])[0]!['fileName'] = 'RENAMED.xlsx';
    expect(blocking(verifyFieldEvidence('quantity', e as FieldEvidence, QTY, bqCtx))).toEqual(expect.arrayContaining(['SOURCE_NOT_IN_PROJECT']));
  });

  it('internally inconsistent evidence (a "value" with no value)', () => {
    const e = { state: 'value', raw: '10', parsed: null, sources: [billCell(10, 4)], method: 'spreadsheet_cell', verification: 'unverified' } as FieldEvidence;
    expect(blocking(verifyFieldEvidence('quantity', e, QTY, bqCtx))).toEqual(['INCONSISTENT_EVIDENCE']);
  });

  it('evidence a person has rejected', () => {
    const e = tamper(numberEvidence(10, 10, at(10, 4)));
    e.verification = 'rejected';
    expect(blocking(verifyFieldEvidence('quantity', e as FieldEvidence, QTY, bqCtx))).toEqual(['REJECTED_EVIDENCE']);
  });
});

describe('whole rows', () => {
  it('a row whose item no longer matches its evidence fails the integrity check', () => {
    const row = tamper(syntheticPricedRow(10));
    (row.item as Record<string, unknown>)['quantity'] = 999;
    const report = verifyStagedBQRow(row as unknown as StagedBQRow, bqCtx);
    expect(report.ok).toBe(false);
    expect(blocking(report.findings)).toContain('INTEGRITY_PROBLEM');
  });

  it('a row marked approved while a blocking issue is unresolved is caught', () => {
    const row = tamper(rowFromTable(12));
    (row as Record<string, unknown>)['review'] = { status: 'approved', history: [] };
    expect(blocking(verifyStagedBQRow(row as unknown as StagedBQRow, bqCtx).findings)).toContain('APPROVED_WITH_BLOCKING_ISSUES');
  });

  it('an approved row with its negative values properly resolved passes', () => {
    let row = rowFromTable(12);
    for (const issue of row.issues.filter((i) => i.code === 'NEGATIVE_VALUE')) {
      row = resolveIssue(row, issue.id, { by: REVIEWER, at: NOW, note: 'Synthetic omission item.' });
    }
    row = setReviewStatus(row, 'approved', REVIEWER, NOW);
    expect(verifyStagedBQRow(row, bqCtx).ok).toBe(true);
  });

  it('a row checked against the wrong project or document fails', () => {
    const other = { ...bqCtx, project: { ...project, id: 'other-project' } };
    expect(blocking(verifyStagedBQRow(syntheticPricedRow(10), other).findings)).toContain('WRONG_PROJECT');
    expect(blocking(verifyStagedBQRow(syntheticPricedRow(10), { ...bqCtx, documentId: BQ_CSV.id }).findings)).toContain('WRONG_DOCUMENT');
  });

  it('a row whose source row is not in the extracted document fails', () => {
    expect(blocking(verifyStagedBQRow(syntheticPricedRow(77), bqCtx).findings)).toEqual(expect.arrayContaining(['SOURCE_ROW_NOT_FOUND', 'SOURCE_CELL_NOT_FOUND']));
  });
});

describe('PDF / OCR and derived values', () => {
  const ocrDoc = { project, documentId: CLAIM_PDF.id, tables: ALL_TABLES };

  it('flags low OCR confidence and unknown OCR confidence', () => {
    const low = createPdfReference(CLAIM_PDF, { pageNumber: 2, lineNumber: 20, extraction: 'ocr', ocrConfidence: 55 });
    const unknown = createPdfReference(CLAIM_PDF, { pageNumber: 2, lineNumber: 20, extraction: 'ocr' });
    expect(codes(verifyFieldEvidence('x', numberEvidence('5', 5, { sources: [low], method: 'pdf_ocr' }), null, ocrDoc))).toContain('LOW_OCR_CONFIDENCE');
    expect(codes(verifyFieldEvidence('x', numberEvidence('5', 5, { sources: [unknown], method: 'pdf_ocr' }), null, ocrDoc))).toContain('OCR_CONFIDENCE_UNKNOWN');
  });

  it('a derived value always needs review, and its cited cells must exist', () => {
    const d = derivedEvidence(30, { rule: 'sum_of_quantity_columns', fromFields: ['a', 'b'], explanation: 'synthetic' }, [billCell(10, 4)]);
    expect(codes(verifyFieldEvidence('quantity', d, null, bqCtx))).toEqual(['DERIVED_VALUE_NEEDS_REVIEW']);
    const bad = derivedEvidence(30, { rule: 'sum', fromFields: [], explanation: 'synthetic' }, [billCell(99, 4)]);
    expect(blocking(verifyFieldEvidence('quantity', bad, null, bqCtx))).toEqual(['SOURCE_CELL_NOT_FOUND']);
  });
});

describe('claim lines', () => {
  const pdf = (col: number) => ({ sources: [claimCell(col)], method: 'pdf_text_layer' as const });
  const n = (col: number, kind: 'quantity' | 'money') => parseNumberCell(CLAIM_TABLE.rows[0]!.cells[col]!.raw, kind, pdf(col)).evidence;
  const none = { previous: notStatedEvidence<number>(), current: notStatedEvidence<number>(), cumulative: notStatedEvidence<number>() };
  const claim = createProgressClaimRecord({
    id: 'cl-1', projectId: project.id, claimDocumentId: 'cd-1', sourceDocumentId: CLAIM_PDF.id, sequence: 1, sources: [claimRow()],
    asWritten: { itemNo: parseTextCell('A', pdf(0)), description: parseTextCell('SYNTHETIC CLAIM LINE 001', pdf(1)), unit: parseUnitCell('m2', pdf(2)).evidence },
    contractFiguresInClaim: { quantity: notStatedEvidence(), rate: notStatedEvidence(), amount: notStatedEvidence() },
    claimedQuantity: { previous: n(3, 'quantity'), current: n(4, 'quantity'), cumulative: n(5, 'quantity') },
    claimedAmount: { previous: n(6, 'money'), current: n(7, 'money'), cumulative: n(8, 'money') },
    percentComplete: none, certifiedQuantity: none, certifiedAmount: none,
  });
  const claimCtx = { project, documentId: CLAIM_PDF.id, tables: ALL_TABLES, bqRowIds: ['bq-row-10'] };

  it('a claim line read from its PDF passes', () => {
    expect(blocking(verifyProgressClaimRecord(claim, claimCtx).findings)).toEqual([]);
  });

  it('an altered claimed amount is caught', () => {
    const t = tamper(claim);
    ((t.claimedAmount as unknown as Record<string, Record<string, unknown>>)['current']!)['parsed'] = 60;
    expect(blocking(verifyProgressClaimRecord(t as unknown as typeof claim, claimCtx).findings)).toEqual(['PARSED_VALUE_MISMATCH']);
  });

  it('a link to a BQ row that does not exist is caught', () => {
    const t = tamper(claim);
    (t as Record<string, unknown>)['bqLink'] = { bqRowId: 'no-such-row', status: 'suggested', method: 'user', matchedOn: [] };
    expect(blocking(verifyProgressClaimRecord(t as unknown as typeof claim, claimCtx).findings)).toEqual(['LINKED_BQ_ROW_NOT_FOUND']);
  });
});

describe('the verifier changes nothing', () => {
  it('evidence and rows are exactly the same after verification', () => {
    const row = rowFromTable(13);
    const before = JSON.stringify(row);
    verifyStagedBQRow(row, bqCtx);
    expect(JSON.stringify(row)).toBe(before);
    expect(row.evidence.quantity.verification).toBe('unverified'); // not marked as checked or approved
    expect(row.evidence.quantity.parsed).toBeNull(); // the ambiguous value was not filled in
  });

  it('text evidence for a description passes and keeps the exact text', () => {
    const e = textEvidence('SYNTHETIC TEST ITEM 001', 'SYNTHETIC TEST ITEM 001', at(10, 2));
    expect(verifyFieldEvidence('description', e, { valueType: 'text' }, bqCtx)).toEqual([]);
  });
});
