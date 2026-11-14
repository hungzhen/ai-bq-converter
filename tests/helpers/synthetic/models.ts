/**
 * SYNTHETIC — NOT REAL COST DATA.
 *
 * Builders for the model tests: a synthetic project with four source files of different
 * formats and types, and a helper that produces a fully stated synthetic priced BQ row.
 * Descriptions are obviously artificial and all figures are round dummy numbers.
 */
import {
  type ConverterProject,
  type SourceDocument,
  type StagedBQRow,
  addSourceDocument,
  createProject,
  createSourceDocument,
  createStagedBQRow,
  createWorksheetReference,
  numberEvidence,
  textEvidence,
} from '../../../src/core/models/index.ts';

export const TODAY = '2000-01-01';
export const NOW = '2000-01-01T00:00:00.000Z';
export const REVIEWER = 'synthetic-reviewer';

const fakeSha = (seed: string) => seed.repeat(64).slice(0, 64);

export const SYNTHETIC_PROJECT_ID = 'proj-synthetic';

export const BQ_XLSX: SourceDocument = createSourceDocument({
  id: 'doc-bq-xlsx',
  projectId: SYNTHETIC_PROJECT_ID,
  fileName: 'SYNTHETIC_BQ.xlsx',
  fileSizeBytes: 1000,
  sha256: fakeSha('a'),
  format: 'xlsx',
  documentType: 'standard_bq',
  uploadedAt: NOW,
  uploadedBy: null,
  organizationId: null,
});

export const WORKING_XLS: SourceDocument = createSourceDocument({
  ...BQ_XLSX,
  id: 'doc-working-xls',
  fileName: 'SYNTHETIC_WORKING_FILE.xls',
  sha256: fakeSha('b'),
  format: 'xls',
  documentType: 'contractor_working_file',
});

export const BQ_CSV: SourceDocument = createSourceDocument({
  ...BQ_XLSX,
  id: 'doc-bq-csv',
  fileName: 'SYNTHETIC_BILL_2.csv',
  sha256: fakeSha('c'),
  format: 'csv',
  documentType: 'standard_bq',
});

export const CLAIM_PDF: SourceDocument = createSourceDocument({
  ...BQ_XLSX,
  id: 'doc-claim-pdf',
  fileName: 'SYNTHETIC_CLAIM_05.pdf',
  sha256: fakeSha('d'),
  format: 'pdf',
  documentType: 'progress_claim',
});

export function syntheticProject(projectYear: string | null = '2000 Q1'): ConverterProject {
  let project = createProject({ id: SYNTHETIC_PROJECT_ID, name: 'SYNTHETIC PROJECT — NOT REAL COST DATA', projectYear });
  for (const doc of [BQ_XLSX, WORKING_XLS, BQ_CSV, CLAIM_PDF]) project = addSourceDocument(project, doc);
  return project;
}

/** Reference to a cell of the synthetic BQ workbook, sheet "Bill 1". */
export const bqCell = (rowNumber: number, columnNumber?: number) =>
  createWorksheetReference(BQ_XLSX, {
    sheetName: 'Bill 1',
    sheetIndex: 0,
    rowNumber,
    ...(columnNumber !== undefined ? { columnNumber } : {}),
  });

/** Columns of the synthetic BQ sheet: A No. | B Description | C Unit | D Qty | E Rate | F Amount. */
export const COL = { itemNo: 1, description: 2, unit: 3, quantity: 4, rate: 5, amount: 6 } as const;

const fromBq = (row: number, col: number) => ({ sources: [bqCell(row, col)], method: 'spreadsheet_cell' as const });

/** A fully stated synthetic priced item on row `row` of sheet "Bill 1". */
export function syntheticPricedRow(row = 10, figures = { quantity: 10, rate: 2, amount: 20 }): StagedBQRow {
  return createStagedBQRow({
    id: `bq-row-${row}`,
    project: syntheticProject(),
    documentId: BQ_XLSX.id,
    rowClass: 'priced_item',
    sequence: row,
    sources: [bqCell(row)],
    evidence: {
      itemNo: textEvidence('A', 'A', fromBq(row, COL.itemNo)),
      description: textEvidence('SYNTHETIC TEST ITEM 001', 'SYNTHETIC TEST ITEM 001', fromBq(row, COL.description)),
      unit: textEvidence('m2', 'm2', fromBq(row, COL.unit)),
      quantity: numberEvidence(figures.quantity, figures.quantity, fromBq(row, COL.quantity)),
      rate: numberEvidence(figures.rate, figures.rate, fromBq(row, COL.rate)),
      amount: numberEvidence(figures.amount, figures.amount, fromBq(row, COL.amount)),
    },
    today: TODAY,
  });
}

export { fromBq };
